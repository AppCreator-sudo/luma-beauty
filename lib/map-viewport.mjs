import {reviewRatings} from './review-ratings.mjs';
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {rateLimit} from 'express-rate-limit';

const MAX_MARKERS=300,MAX_ZOOM=20,CELL_PIXELS=72,MERCATOR_LAT=85.05112878,MINUTE=60000;
const lexical=(a,b)=>a===b?0:a<b?-1:1;
const boundsOf=rows=>{
  if(!rows.length)return null;const result=[180,90,-180,-90];
  for(const p of rows){result[0]=Math.min(result[0],p.longitude);result[1]=Math.min(result[1],p.latitude);result[2]=Math.max(result[2],p.longitude);result[3]=Math.max(result[3],p.latitude)}
  return result;
};
const masterSource=`SELECT 'master' kind,p.user_id target_id,p.latitude,p.longitude FROM profiles p
  JOIN performers person ON person.id=p.user_id JOIN workspaces workspace ON workspace.id=person.workspace_id
  WHERE p.published=1 AND p.is_demo=0 AND person.active=1 AND workspace.kind='solo' AND workspace.owner_user_id IS NOT NULL
  AND typeof(p.latitude) IN ('real','integer') AND p.latitude BETWEEN -90 AND 90
  AND typeof(p.longitude) IN ('real','integer') AND p.longitude BETWEEN -180 AND 180`;
const salonSource=`SELECT 'salon' kind,w.id target_id,w.latitude,w.longitude FROM workspaces w
  WHERE w.kind='salon' AND w.published=1 AND w.owner_user_id IS NOT NULL
  AND typeof(w.latitude) IN ('real','integer') AND w.latitude BETWEEN -90 AND 90
  AND typeof(w.longitude) IN ('real','integer') AND w.longitude BETWEEN -180 AND 180`;
const staffCategories=`SELECT DISTINCT pc.category FROM performers staff JOIN profiles profile ON profile.user_id=staff.id
  JOIN profile_categories pc ON pc.user_id=staff.id WHERE staff.workspace_id=w.id AND staff.active=1 AND staff.bookable=1 AND profile.is_demo=0`;
const categoryList=`CASE WHEN l.kind='master' THEN (SELECT json_group_array(category) FROM
  (SELECT category FROM profile_categories WHERE user_id=p.user_id ORDER BY rowid)) ELSE
  (SELECT json_group_array(category) FROM (${staffCategories} ORDER BY pc.category)) END`;
const joined=`FROM map_locations l LEFT JOIN profiles p ON l.kind='master' AND p.user_id=l.target_id
  LEFT JOIN workspaces w ON l.kind='salon' AND w.id=l.target_id`;

// A derived, public-only projection. The source records remain authoritative;
// ordinary writes (including writes from other database connections) refresh it.
function migrate(db,backupDir){
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('map-viewport-v1'))return;
  if(backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const file=path.join(backupDir,'before-map-viewport-'+Date.now()+'-'+randomUUID()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);
  }
  const refreshMaster=condition=>`INSERT INTO map_locations(kind,target_id,latitude,longitude) ${masterSource} AND ${condition}
    ON CONFLICT(kind,target_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude;
    DELETE FROM map_locations WHERE kind='master' AND target_id IN (SELECT p.user_id FROM profiles p WHERE ${condition})
    AND target_id NOT IN (SELECT target_id FROM (${masterSource} AND ${condition}));`;
  const refreshSalon=condition=>`INSERT INTO map_locations(kind,target_id,latitude,longitude) ${salonSource} AND ${condition}
    ON CONFLICT(kind,target_id) DO UPDATE SET latitude=excluded.latitude,longitude=excluded.longitude;
    DELETE FROM map_locations WHERE kind='salon' AND target_id IN (SELECT w.id FROM workspaces w WHERE ${condition})
    AND target_id NOT IN (SELECT target_id FROM (${salonSource} AND ${condition}));`;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE map_locations(id INTEGER PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('master','salon')),
      target_id TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,UNIQUE(kind,target_id));
      CREATE VIRTUAL TABLE map_spatial USING rtree(id,min_longitude,max_longitude,min_latitude,max_latitude);
      CREATE TRIGGER map_locations_insert AFTER INSERT ON map_locations BEGIN
        INSERT INTO map_spatial VALUES(NEW.id,NEW.longitude,NEW.longitude,NEW.latitude,NEW.latitude); END;
      CREATE TRIGGER map_locations_update AFTER UPDATE OF latitude,longitude ON map_locations BEGIN
        UPDATE map_spatial SET min_longitude=NEW.longitude,max_longitude=NEW.longitude,min_latitude=NEW.latitude,max_latitude=NEW.latitude WHERE id=NEW.id; END;
      CREATE TRIGGER map_locations_delete AFTER DELETE ON map_locations BEGIN DELETE FROM map_spatial WHERE id=OLD.id; END;
      CREATE TRIGGER map_profile_insert AFTER INSERT ON profiles BEGIN ${refreshMaster('p.user_id=NEW.user_id')} END;
      CREATE TRIGGER map_profile_update AFTER UPDATE ON profiles BEGIN ${refreshMaster('p.user_id=NEW.user_id')} END;
      CREATE TRIGGER map_profile_delete AFTER DELETE ON profiles BEGIN DELETE FROM map_locations WHERE kind='master' AND target_id=OLD.user_id; END;
      CREATE TRIGGER map_performer_insert AFTER INSERT ON performers BEGIN ${refreshMaster('p.user_id=NEW.id')} END;
      CREATE TRIGGER map_performer_update AFTER UPDATE ON performers BEGIN
        DELETE FROM map_locations WHERE kind='master' AND target_id=OLD.id AND OLD.id<>NEW.id;
        ${refreshMaster('p.user_id=NEW.id')} END;
      CREATE TRIGGER map_performer_delete AFTER DELETE ON performers BEGIN DELETE FROM map_locations WHERE kind='master' AND target_id=OLD.id; END;
      CREATE TRIGGER map_workspace_insert AFTER INSERT ON workspaces BEGIN ${refreshSalon('w.id=NEW.id')}
        ${refreshMaster('p.user_id IN (SELECT id FROM performers WHERE workspace_id=NEW.id)')} END;
      CREATE TRIGGER map_workspace_update AFTER UPDATE ON workspaces BEGIN ${refreshSalon('w.id=NEW.id')}
        ${refreshMaster('p.user_id IN (SELECT id FROM performers WHERE workspace_id=NEW.id OR workspace_id=OLD.id)')} END;
      CREATE TRIGGER map_workspace_delete AFTER DELETE ON workspaces BEGIN
        DELETE FROM map_locations WHERE kind='salon' AND target_id=OLD.id;
        DELETE FROM map_locations WHERE kind='master' AND target_id IN (SELECT id FROM performers WHERE workspace_id=OLD.id); END;
      INSERT INTO map_locations(kind,target_id,latitude,longitude) ${masterSource};
      INSERT INTO map_locations(kind,target_id,latitude,longitude) ${salonSource};`);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('map-viewport-v1',Date.now());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}

function cell(row,zoom){
  const scale=256*2**zoom/CELL_PIXELS,latitude=Math.max(-MERCATOR_LAT,Math.min(MERCATOR_LAT,row.latitude));
  const sine=Math.sin(latitude*Math.PI/180),x=Math.floor(((row.longitude+180)%360)/360*scale);
  const y=Math.floor((0.5-Math.log((1+sine)/(1-sine))/(4*Math.PI))*scale);
  return `${zoom}:${x}:${y}`;
}

export function mapViewport({app,db,fail,promotionControl,schedule,backupDir,secret=randomBytes(32),now=Date.now}){
  migrate(db,backupDir);
  const getAll=(sql,...args)=>db.prepare(sql).all(...args);
  const visualColumns=new Set(getAll('PRAGMA table_info(workspaces)').map(column=>column.name));
  const salonLogo=visualColumns.has('logo')?"COALESCE(w.logo,'')":"''",salonCover=visualColumns.has('cover')?"COALESCE(w.cover,'')":"''";
  const salonTeaches=visualColumns.has('teaches')?'COALESCE(w.teaches,0)':`EXISTS(SELECT 1 FROM performers staff JOIN profiles profile ON profile.user_id=staff.id WHERE staff.workspace_id=w.id AND staff.active=1 AND staff.bookable=1 AND profile.is_demo=0 AND profile.teaches=1)`;
  const masterCover=getAll('PRAGMA table_info(profiles)').some(column=>column.name==='cover')?"COALESCE(p.cover,'')":"''";
  const invalid=(message='Обновите карту и повторите поиск',status=400)=>fail(message,status);
  function scalar(query,key,max){
    const value=query[key];if(value===undefined)return '';
    if(typeof value!=='string'||value.length>max)invalid('Некорректные параметры карты');return value.trim();
  }
  function token(payload){
    const body=Buffer.from(JSON.stringify({...payload,expires:(Math.floor(now()/3600000)+2)*3600000})).toString('base64url');
    return body+'.'+createHmac('sha256',secret).update(body).digest('base64url');
  }
  function untoken(value,kind,scope){
    if(value.length>2048||!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value))invalid();
    const [body,raw]=value.split('.'),signature=Buffer.from(raw,'base64url'),expected=createHmac('sha256',secret).update(body).digest();
    if(signature.length!==expected.length||!timingSafeEqual(signature,expected))invalid();
    let decoded;try{decoded=JSON.parse(Buffer.from(body,'base64url').toString())}catch{invalid()}
    if(decoded.type!==kind||decoded.scope!==scope||!Number.isSafeInteger(decoded.expires)||decoded.expires<=now())invalid('Результаты карты изменились. Повторите поиск',409);
    return decoded;
  }
  function parameters(query){
    const q=scalar(query,'q',100).toLocaleLowerCase('ru-RU'),category=scalar(query,'category',80),bboxRaw=scalar(query,'bbox',150),zoomRaw=scalar(query,'zoom',4),limitRaw=scalar(query,'limit',3),soonRaw=scalar(query,'soon',5);
    if(!['','true','false'].includes(soonRaw))invalid('Некорректный фильтр свободного времени');
    const zoom=zoomRaw===''?0:Number(zoomRaw),limit=limitRaw===''?24:Number(limitRaw);
    if(!Number.isInteger(zoom)||zoom<0||zoom>MAX_ZOOM||!Number.isInteger(limit)||limit<1||limit>48)invalid('Некорректные параметры карты');
    let bbox=null;
    if(bboxRaw){
      const parts=bboxRaw.split(',');if(parts.length!==4||parts.some(p=>!p.trim()||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(p)))invalid('Некорректная область карты');
      bbox=parts.map(Number);const [w,s,e,n]=bbox;
      if(bbox.some(v=>!Number.isFinite(v))||Math.abs(w)>180||Math.abs(e)>180||Math.abs(s)>90||Math.abs(n)>90||s>n)invalid('Некорректная область карты');
    }
    return {q,category,bbox,zoom,limit,soon:soonRaw==='true',cursor:scalar(query,'cursor',2048),cluster:scalar(query,'cluster',2048)};
  }
  function positionQuery({q,category,bbox}){
    let where='1=1',params=[];
    if(bbox){
      const [w,s,e,n]=bbox,ranges=w<=e?[[w,e]]:[[w,180],[-180,e]];
      const spatial=ranges.map(([left,right])=>{
        params.push(right,left,n,s,left,right,s,n);
        return `SELECT l.id FROM map_spatial r CROSS JOIN map_locations l ON l.id=r.id
          WHERE r.min_longitude<=? AND r.max_longitude>=? AND r.min_latitude<=? AND r.max_latitude>=?
          AND l.longitude>=? AND l.longitude<=? AND l.latitude>=? AND l.latitude<=?`;
      }).join(' UNION ');
      where=`l.id IN (${spatial})`;
    }
    if(category){
      where+=` AND ((l.kind='master' AND EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.user_id=p.user_id AND pc.category=?))
        OR (l.kind='salon' AND EXISTS(${staffCategories} AND pc.category=?)))`;
      params.push(category,category);
    }
    const search=q?`,COALESCE(p.name,w.name)||' '||COALESCE(p.city,w.city)||' '||COALESCE(p.address,w.address)||' '||${categoryList} search_text`:'';
    return {sql:`SELECT l.id,l.kind,l.target_id,l.latitude,l.longitude,COALESCE(p.slug,w.slug) slug${search} ${joined} WHERE ${where}`,params};
  }
  function cards(rows,promoted){
    if(!rows.length)return [];
    const ids=[...new Set(rows.map(row=>row.id))],cards=getAll(`SELECT l.id,l.kind,l.target_id user_id,COALESCE(p.slug,w.slug) slug,
      COALESCE(p.name,w.name) name,COALESCE(p.city,w.city) city,COALESCE(p.address,w.address) address,l.latitude,l.longitude,
      CASE WHEN l.kind='salon' THEN ${salonLogo} ELSE COALESCE(p.avatar,'') END avatar,
      CASE WHEN l.kind='salon' THEN ${salonLogo} ELSE '' END logo,CASE WHEN l.kind='salon' THEN ${salonCover} ELSE ${masterCover} END cover,${categoryList} categories,
      CASE WHEN l.kind='master' THEN p.teaches ELSE ${salonTeaches} END teaches
      ${joined} WHERE l.id IN (${ids.map(()=>'?').join(',')})`,...ids).map(({id,categories,logo,cover,...card})=>{
        const selected=JSON.parse(categories);return {id,...card,...(card.kind==='salon'?{logo,cover}:cover?{cover}:{}),category:selected[0]||'',categories:selected};
      });
    const scores=reviewRatings(db,cards),byId=new Map(cards.map(({id,...card})=>[id,promotionControl.decorate({...card,...scores.get(card.kind+':'+card.user_id)},promoted)]));
    return rows.map(row=>byId.get(row.id)).filter(Boolean);
  }
  // The shortest real service is sufficient to establish the earliest feasible
  // start on the shared booking grid. Each performer needs one bounded calendar
  // scan, rather than one scan per service or a 90-day catalog calculation.
  function nextAvailability(rows,time,windowEnd){
    const found=new Map();if(!rows.length)return found;
    if(!schedule)invalid('Поиск свободного времени временно недоступен',503);
    for(let offset=0;offset<rows.length;offset+=250){
      const ids=rows.slice(offset,offset+250).map(row=>row.id),holders=ids.map(()=>'?').join(',');
      const offers=getAll(`SELECT * FROM (SELECT offer.*,ROW_NUMBER() OVER
        (PARTITION BY location_id,performer_id ORDER BY duration,price,title,service_id) ordinal FROM (
        SELECT l.id location_id,l.kind,l.target_id,person.id performer_id,person.name performer_name,
          service.id service_id,service.name title,service.price,service.duration,NULL venue_offset
        FROM map_locations l JOIN performers person ON l.kind='master' AND person.id=l.target_id AND person.active=1
          JOIN profiles profile ON profile.user_id=person.id AND profile.is_demo=0
          JOIN services service ON service.user_id=person.id
        WHERE l.id IN (${holders}) AND typeof(service.duration)='integer' AND service.duration BETWEEN 5 AND 720
          AND typeof(service.price)='integer' AND service.price BETWEEN 0 AND 1000000
        UNION ALL
        SELECT l.id location_id,l.kind,l.target_id,person.id performer_id,person.name performer_name,
          service.id service_id,service.name title,service.price,service.duration,venue.utc_offset venue_offset
        FROM map_locations l JOIN performers person ON l.kind='salon' AND person.workspace_id=l.target_id AND person.active=1 AND person.bookable=1
          JOIN workspaces venue ON venue.id=l.target_id
          JOIN profiles profile ON profile.user_id=person.id AND profile.is_demo=0
          JOIN services service ON service.user_id=person.id
        WHERE l.id IN (${holders}) AND typeof(service.duration)='integer' AND service.duration BETWEEN 5 AND 720
          AND typeof(service.price)='integer' AND service.price BETWEEN 0 AND 1000000
        ) offer) WHERE ordinal=1`,...ids,...ids);
      const maxDuration=offers.reduce((value,offer)=>Math.max(value,offer.duration),0);
      const calendar=offers.length&&schedule.prepareAvailability?schedule.prepareAvailability(offers.map(offer=>offer.performer_id),time,{from:time,to:windowEnd+maxDuration*MINUTE+1}):schedule;
      for(const offer of offers){
        // Include busy appointments starting after the requested start window:
        // a service may finish later than that window and must still fit fully.
        const slot=calendar.availability(offer.performer_id,time,{from:time,to:windowEnd+offer.duration*MINUTE+1,duration:offer.duration})
          .find(candidate=>candidate.start>time&&candidate.start<=windowEnd);
        if(!slot)continue;
        const previous=found.get(offer.location_id);
        if(previous&&(previous.start<slot.start||previous.start===slot.start&&(
          previous.service.price<offer.price||previous.service.price===offer.price&&previous.service.duration<offer.duration||
          previous.service.price===offer.price&&previous.service.duration===offer.duration&&lexical(previous.performer?.id||'',offer.kind==='salon'?offer.performer_id:'')<=0)))continue;
        const serviceId=offer.kind==='salon'?createHash('sha256').update(JSON.stringify([
          offer.title.toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim(),offer.price,offer.duration])).digest('hex'):offer.service_id;
        found.set(offer.location_id,{start:slot.start,end:slot.start+offer.duration*MINUTE,utc_offset:offer.kind==='salon'?offer.venue_offset:calendar.config(offer.performer_id).utc_offset,
          service:{id:serviceId,title:offer.title,price:offer.price,duration:offer.duration},
          performer:offer.kind==='salon'?{id:offer.performer_id,name:offer.performer_name}:null});
      }
    }
    return found;
  }
  function read(query){
    const p=parameters(query),time=now(),promoted=promotionControl.active('map',p.category),ranks=new Map([...promoted.keys()].map((key,index)=>[key,index]));
    const request=positionQuery(p);let positions=getAll(request.sql,...request.params).filter(row=>!p.q||row.search_text.toLowerCase().includes(p.q));
    const available=p.soon?nextAvailability(positions,time,time+60*MINUTE):new Map();
    if(p.soon)positions=positions.filter(row=>available.has(row.id));
    const scope=createHash('sha256').update(JSON.stringify([p.bbox,p.zoom,p.q,p.category,p.soon,p.soon?Math.floor(time/MINUTE):null,
      p.soon?positions.map(row=>[row.id,available.get(row.id)]):null,[...ranks]])).digest('base64url');
    const rank=row=>ranks.get(row.kind+':'+row.target_id)??Number.MAX_SAFE_INTEGER;
    const compare=(a,b)=>(ranks.size?rank(a)-rank(b):0)||lexical(a.slug,b.slug)||lexical(a.kind,b.kind)||lexical(a.target_id,b.target_id);
    positions.sort(compare);
    let gridZoom=p.zoom,groups;
    do{
      groups=new Map();for(const row of positions){const key=cell(row,gridZoom);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row)}
      if(groups.size<=MAX_MARKERS||gridZoom===0)break;gridZoom--;
    }while(true);
    let list=positions,selectedCluster=null;
    if(p.cluster){
      const selection=untoken(p.cluster,'cluster',scope);
      if(selection.gridZoom!==gridZoom||typeof selection.cell!=='string'||!groups.has(selection.cell))invalid('Группа на карте изменилась. Повторите поиск',409);
      list=groups.get(selection.cell);selectedCluster=p.cluster;
    }
    const listTotal=list.length;
    if(p.cursor){
      const cursor=untoken(p.cursor,'cursor',scope);
      if(cursor.cluster!==p.cluster||cursor.limit!==p.limit||typeof cursor.slug!=='string'||typeof cursor.kind!=='string'||typeof cursor.target_id!=='string'||!Number.isSafeInteger(cursor.rank))invalid();
      list=list.filter(row=>rank(row)>cursor.rank||rank(row)===cursor.rank&&(
        lexical(row.slug,cursor.slug)>0||row.slug===cursor.slug&&(lexical(row.kind,cursor.kind)>0||row.kind===cursor.kind&&lexical(row.target_id,cursor.target_id)>0)));
    }
    const page=list.slice(0,p.limit),last=page.at(-1);
    const next=list.length>p.limit?token({type:'cursor',scope,cluster:p.cluster,limit:p.limit,rank:rank(last),slug:last.slug,kind:last.kind,target_id:last.target_id}):null;
    const singletons=[],clusters=[];
    for(const [key,rows] of groups){
      if(rows.length===1){singletons.push(rows[0]);continue}
      const clusterBounds=boundsOf(rows),longitude=rows.reduce((sum,row)=>sum+row.longitude,0)/rows.length;
      clusters.push({id:token({type:'cluster',scope,cell:key,gridZoom}),count:rows.length,
        promotedCount:rows.filter(row=>promoted.has(row.kind+':'+row.target_id)).length,
        latitude:rows.reduce((sum,row)=>sum+row.latitude,0)/rows.length,
        longitude:clusterBounds[2]-clusterBounds[0]>180?rows[0].longitude:longitude,bounds:clusterBounds});
    }
    const hydrated=cards([...singletons,...page],promoted),byKey=new Map(hydrated.map(card=>[card.kind+':'+card.user_id,card]));
    const materialize=rows=>rows.map(row=>{
      const card=byKey.get(row.kind+':'+row.target_id),availability=available.get(row.id);
      return card&&availability?{...card,next_available:availability.start,availability}:card;
    }).filter(Boolean);
    let nextExpiry=Infinity;
    for(const row of positions){const until=promoted.get(row.kind+':'+row.target_id)?.until;if(Number.isSafeInteger(until)&&until>now())nextExpiry=Math.min(nextExpiry,until)}
    return {total:positions.length,points:materialize(singletons),clusters,items:materialize(page),next,bounds:boundsOf(positions),listTotal,selectedCluster,
      nextPromotionExpiry:Number.isFinite(nextExpiry)?new Date(nextExpiry).toISOString():null,
      checked_at:time,refresh_at:p.soon?(Math.floor(time/MINUTE)+1)*MINUTE+10:null};
  }
  function details(query){
    const kind=scalar(query,'kind',10),id=scalar(query,'id',100),category=scalar(query,'category',80);
    if(!['master','salon'].includes(kind)||!id||!/^[A-Za-z0-9:_-]+$/.test(id))invalid('Проверьте выбранную страницу');
    const row=db.prepare('SELECT * FROM map_locations WHERE kind=? AND target_id=?').get(kind,id);
    if(!row)invalid('Страница больше недоступна на карте',404);
    const time=now(),profile=cards([row],promotionControl.active('map',category))[0],availability=nextAvailability([row],time,time+7*86400000).get(row.id)||null;
    const bio=db.prepare(kind==='master'?'SELECT bio FROM profiles WHERE user_id=?':'SELECT bio FROM workspaces WHERE id=?').get(id)?.bio||'';
    const coverRow=db.prepare(kind==='master'?`SELECT image FROM works WHERE user_id=? ORDER BY pinned DESC,position DESC,created DESC,id DESC LIMIT 1`:
      `SELECT work.image FROM works work JOIN performers person ON person.id=work.user_id JOIN profiles profile ON profile.user_id=person.id
       WHERE person.workspace_id=? AND person.active=1 AND person.bookable=1 AND profile.published=1 AND profile.is_demo=0
       ORDER BY work.pinned DESC,work.position DESC,work.created DESC,work.id DESC LIMIT 1`).get(id);
    const publicImage=value=>typeof value==='string'&&/^\/(?:uploads|assets|images)\/[A-Za-z0-9/_-]+\.(?:webp|png|jpe?g)$/i.test(value)?value:null;
    return {profile,bio,cover:publicImage(profile.cover)||publicImage(coverRow?.image)||publicImage(profile.avatar),next_available:availability?.start??null,availability,checked_at:time,
      refresh_at:(Math.floor(time/MINUTE)+1)*MINUTE+10};
  }
  // One read snapshot prevents a second process publishing/depublishing midway
  // through position selection and public-card hydration.
  function snapshot(query,reader=read){db.exec('BEGIN');try{const result=reader(query);db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}
  if(app){
    const availabilityLimit=rateLimit({windowMs:60000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много поисков свободного времени. Подождите минуту.'}});
    app.get('/api/map/viewport',(req,res,next)=>req.query.soon==='true'?availabilityLimit(req,res,next):next(),(req,res)=>res.set('Cache-Control','no-store').json(snapshot(req.query)));
    app.get('/api/map/details',availabilityLimit,(req,res)=>res.set('Cache-Control','no-store').json(snapshot(req.query,details)));
  }
  return {read:snapshot,details:query=>snapshot(query,details),queryPlan:query=>{const {sql,params}=positionQuery(parameters(query));return getAll('EXPLAIN QUERY PLAN '+sql,...params)}};
}
