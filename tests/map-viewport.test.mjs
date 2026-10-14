import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {mapViewport} from '../lib/map-viewport.mjs';
import {mapFixture} from '../scripts/benchmark-map.mjs';
import {schedules} from '../lib/schedule.mjs';
import {workspaceAccess} from '../lib/workspaces.mjs';

const complete=result=>{
  assert.equal(result.points.length+result.clusters.reduce((n,c)=>n+c.count,0),result.total,'Every visible location occurs once');
  assert.ok(result.points.length+result.clusters.length<=300,'Markers are bounded without losing counts');
  assert.ok(result.items.length<=48);return result;
};

test('indexed map: complete counts, bounded markers, all sidebar pages, filters and safe tokens',()=>{
  const fixture=mapFixture(1100),map=mapViewport(fixture),query={bbox:'82.8,54.9,83.1,55.1',zoom:'18',limit:'48'};
  try{
    const first=complete(map.read(query));assert.equal(first.total,1100);assert.equal(first.listTotal,1100);assert.ok(first.clusters.length);assert.ok(first.next);
    const seen=new Set();let page=first;
    do{for(const item of page.items){assert.ok(!seen.has(item.user_id));seen.add(item.user_id)}page=page.next?complete(map.read({...query,cursor:page.next})):null}while(page);
    assert.equal(seen.size,1100,'Sidebar reaches every master after the former 1,000 cap');
    assert.deepEqual(map.read({}).bounds,[82.86,54.96,82.868,55.0392]);
    assert.equal(map.read({...query,q:'НОВОСИБИРСК'}).total,1100,'Russian search is case insensitive');
    assert.equal(map.read({...query,q:'маникюр'}).total,1100,'Search includes categories');
    assert.equal(map.read({...query,q:'<script>alert(1)</script>'}).total,0);
    assert.equal(map.read({...query,category:'Татуировки'}).total,0);
    assert.equal(map.read({...query,bbox:'82.86,54.96,82.86,54.96'}).total,1,'Exact coordinate bounds ignore expanded RTree float bounds');
    assert.ok(map.queryPlan(query).some(row=>/VIRTUAL TABLE INDEX.*B.*D/.test(row.detail)),JSON.stringify(map.queryPlan(query)));
    const cluster=first.clusters[0],selected=complete(map.read({...query,cluster:cluster.id}));assert.equal(selected.total,1100);assert.equal(selected.listTotal,cluster.count);assert.equal(selected.selectedCluster,cluster.id);
    assert.throws(()=>map.read({...query,q:'другой',cursor:first.next}),error=>error.status===409);
    assert.throws(()=>map.read({...query,bbox:'82.85,54.9,83.1,55.1',cluster:cluster.id}),error=>error.status===409);
    assert.throws(()=>map.read({...query,limit:'24',cursor:first.next}));
    assert.throws(()=>map.read({...query,cursor:first.next.slice(0,-1)+'!'}));
    for(const malformed of [{bbox:'0,0,1'},{bbox:'0,91,1,92'},{bbox:'Infinity,0,1,1'},{bbox:'0,1,1,0'},{bbox:'181,0,1,1'},{bbox:'0,,1,1'},{bbox:['0,0,1,1']},{zoom:'21'},{zoom:'-1'},{zoom:'NaN'},{limit:'49'},{limit:'0'},{q:['Москва']},{category:{foo:'bar'}},{cursor:'x'.repeat(2049)}])assert.throws(()=>map.read(malformed));
    const publicText=JSON.stringify(first);assert.ok(!publicText.includes('private_note')&&!publicText.includes('Private operator')&&!publicText.includes('bio'));
    assert.deepEqual(Object.keys(first.items[0]).sort(),['address','avatar','categories','category','city','kind','latitude','longitude','name','rating','review_count','slug','teaches','user_id'].sort());
  }finally{fixture.db.close()}
});

test('publication lifecycle, salon categories, coincident points, promotions and antimeridian',()=>{
  const fixture=mapFixture(),{db,master}=fixture;let promotions=new Map([['master:one',{label:'Реклама',until:Date.now()+10000,advertiser:'Объявление',erid:'demo'}]]);
  fixture.promotionControl={active:()=>promotions,decorate:(card,active)=>active.has(card.kind+':'+card.user_id)?{...card,promotion:active.get(card.kind+':'+card.user_id)}:card};
  const map=mapViewport(fixture),query={bbox:'82,54,84,56',zoom:'20'};
  try{
    master('one');master('two');master('three');
    let result=complete(map.read(query));assert.equal(result.total,3);assert.equal(result.points.length,0);assert.equal(result.clusters[0].count,3);assert.equal(result.clusters[0].promotedCount,1);
    assert.equal(result.nextPromotionExpiry,new Date(promotions.get('master:one').until).toISOString());
    const selected=map.read({...query,cluster:result.clusters[0].id});assert.equal(selected.listTotal,3);assert.equal(selected.items[0].user_id,'one');assert.ok(selected.items[0].promotion);assert.ok(!('priority' in selected.items[0].promotion));
    db.prepare("UPDATE profiles SET latitude=55.5,longitude=83.5 WHERE user_id='two'").run();assert.equal(map.read({bbox:'82.9,55,82.9,55',zoom:'20'}).total,2);
    db.prepare("UPDATE profiles SET published=0 WHERE user_id='one'").run();assert.equal(map.read(query).total,2);
    db.prepare("UPDATE profiles SET published=1,is_demo=1 WHERE user_id='one'").run();assert.equal(map.read(query).total,2);
    db.prepare("UPDATE profiles SET is_demo=0 WHERE user_id='one'").run();assert.equal(map.read(query).total,3);
    db.prepare("UPDATE performers SET active=0 WHERE id='one'").run();assert.equal(map.read(query).total,2);
    db.prepare("UPDATE performers SET active=1 WHERE id='one'").run();assert.equal(map.read(query).total,3);
    db.prepare("UPDATE workspaces SET owner_user_id=NULL WHERE id='solo:one'").run();assert.equal(map.read(query).total,2);
    db.prepare("UPDATE workspaces SET owner_user_id='one' WHERE id='solo:one'").run();assert.equal(map.read(query).total,3);
    master('bad',Infinity,82.9);master('far',55,179.9);master('west',55,-179.9);master('south',-90,-180);master('north',90,180);
    assert.equal(map.read({bbox:'179,54,-179,56',zoom:'10'}).total,2,'A crossing viewport includes both sides of the date line');
    assert.equal(map.read({bbox:'-180,-90,180,90'}).total,7,'Finite polar coordinates remain valid; Infinity excluded');
    db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,name,city,slug,address,latitude,longitude,published) VALUES('salon','salon','owner','Салон Тату','Новосибирск','salon-page','ул Салонная, д 5',55,82.9,1)").run();
    master('staff',55,82.9,{category:'Татуировки',name:'Скрытое имя сотрудника'});
    db.prepare("UPDATE performers SET workspace_id='salon',bookable=1 WHERE id='staff'").run();db.prepare("UPDATE profiles SET published=0,teaches=1 WHERE user_id='staff'").run();
    result=complete(map.read({...query,category:'Татуировки'}));assert.equal(result.total,1);assert.equal(result.items[0].kind,'salon');assert.deepEqual(result.items[0].categories,['Татуировки']);assert.equal(result.items[0].teaches,1);assert.ok(!JSON.stringify(result).includes('Скрытое имя сотрудника'));
    assert.equal(map.read({...query,q:'САЛОННАЯ'}).total,1);assert.equal(map.read({...query,q:'ТАТУИРОВКИ'}).total,1);
    db.prepare("INSERT INTO profile_categories VALUES('staff','Маникюр')").run();assert.equal(map.read({...query,category:'Маникюр'}).total,4,'Categories update without rebuilding projection');
    db.prepare("UPDATE performers SET bookable=0 WHERE id='staff'").run();assert.equal(map.read({...query,category:'Татуировки'}).total,0);
    db.prepare("UPDATE workspaces SET published=0 WHERE id='salon'").run();assert.equal(map.read(query).total,3);
    db.prepare("DELETE FROM profiles WHERE user_id='three'").run();assert.equal(map.read(query).total,2);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM map_locations').get().n,db.prepare('SELECT COUNT(*) n FROM map_spatial').get().n);
    const first=map.read({...query,limit:'1'});promotions=new Map();assert.equal(map.read(query).nextPromotionExpiry,null);assert.throws(()=>map.read({...query,limit:'1',cursor:first.next}),error=>error.status===409,'Promotion changes reset pagination');
  }finally{db.close()}
});

test('migration backup is closed and private; external writes refresh RTree; restart is idempotent',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelie-map-')),file=path.join(dir,'test.sqlite'),fixture=mapFixture(1);
  let db,other;
  try{
    fixture.db.prepare('VACUUM INTO ?').run(file);fixture.db.close();db=new DatabaseSync(file);const backupDir=path.join(dir,'backups');
    const options={...fixture,db,backupDir};const map=mapViewport(options),backups=fs.readdirSync(backupDir);assert.equal(backups.length,1);
    const backup=new DatabaseSync(path.join(backupDir,backups[0]),{readOnly:true});assert.equal(backup.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='map_locations'").get().n,0);assert.equal(backup.prepare('PRAGMA quick_check').get().quick_check,'ok');backup.close();
    other=new DatabaseSync(file);other.prepare("UPDATE profiles SET latitude=60,longitude=30 WHERE user_id='000000'").run();assert.equal(map.read({bbox:'29,59,31,61'}).total,1);assert.equal(map.read({bbox:'82,54,84,56'}).total,0);
    other.prepare("UPDATE profiles SET published=0 WHERE user_id='000000'").run();assert.equal(map.read({}).total,0);
    mapViewport(options);assert.equal(fs.readdirSync(backupDir).length,1);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
  }finally{other?.close();db?.close();fs.rmSync(dir,{recursive:true,force:true})}
});

test('public HTTP viewport on full app schema keeps legacy route and validates filters/cursors',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelie-map-http-')),origin='http://localhost:3229';
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3229',DATA_DIR:dir,APP_ORIGIN:origin,NODE_ENV:'test',DADATA_API_KEY:'',PROMOTIONS_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
  let logs='',db;child.stdout.on('data',buffer=>logs+=buffer);child.stderr.on('data',buffer=>logs+=buffer);
  t.after(async()=>{db?.close();const exited=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve();child.kill();await exited;fs.rmSync(dir,{recursive:true,force:true})});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}assert.ok(ready,logs);
  const client=()=>({cookie:'',async request(url,body,method='GET'){
    const response=await fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:this.cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  }});
  const anonymous=client(),masters=[];
  for(const suffix of ['first','second']){
    const account=client();assert.equal((await account.request('/auth/register',{login:'map-http-'+suffix,password:'MapHttpTestPassword123',account_type:'master'},'POST')).status,201);
    const created=await account.request('/profile',{slug:'map-http-'+suffix,name:'Мастер '+suffix,city:'Новосибирск',categories:['Маникюр'],address:'Громова 21',latitude:55,longitude:82.9,published:true,theme:'green'},'PUT');assert.equal(created.status,200);masters.push(created.data.user_id);
  }
  const owner=client();assert.equal((await owner.request('/auth/register',{login:'map-http-salon',password:'MapHttpTestPassword123',account_type:'salon'},'POST')).status,201);
  const salon=(await owner.request('/salons',{name:'Салон татуировок',city:'Новосибирск'},'POST')).data.id;
  const staff=(await owner.request('/salons/'+salon+'/staff',{name:'Непубличное имя сотрудника',categories:['Татуировки']},'POST')).data.id;
  db=new DatabaseSync(path.join(dir,'atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.prepare('UPDATE performers SET bookable=1 WHERE id=?').run(staff);
  db.prepare("UPDATE workspaces SET slug='map-http-salon-page',address='Громова 21',latitude=55,longitude=82.9,published=1 WHERE id=?").run(salon);
  const first=await anonymous.request('/map/viewport?bbox=82,54,84,56&zoom=18&limit=1');assert.equal(first.status,200);complete(first.data);assert.equal(first.data.total,3);assert.equal(first.data.items.length,1);assert.ok(first.data.next);assert.equal(first.data.nextPromotionExpiry,null);
  const second=await anonymous.request('/map/viewport?bbox=82,54,84,56&zoom=18&limit=1&cursor='+encodeURIComponent(first.data.next));assert.equal(second.status,200);assert.notEqual(second.data.items[0].user_id,first.data.items[0].user_id);
  const selected=await anonymous.request('/map/viewport?bbox=82,54,84,56&zoom=18&cluster='+encodeURIComponent(first.data.clusters[0].id));assert.equal(selected.status,200);assert.equal(selected.data.listTotal,3);
  const filtered=await anonymous.request('/map/viewport?q='+encodeURIComponent('ТАТУИРОВКИ')+'&category='+encodeURIComponent('Татуировки'));assert.equal(filtered.status,200);assert.equal(filtered.data.total,1);assert.equal(filtered.data.items[0].kind,'salon');
  for(const suffix of ['bbox=0,91,1,92','zoom=99','limit=49','q=x&q=y','cursor=malicious'])assert.equal((await anonymous.request('/map/viewport?'+suffix)).status,400);
  assert.equal((await anonymous.request('/map/viewport?bbox=82,54,84,56&zoom=18&limit=1&q=changed&cursor='+encodeURIComponent(first.data.next))).status,409);
  const encoded=JSON.stringify(first.data);for(const field of ['password','recovery','session','login','Непубличное имя сотрудника','private_note','bio'])assert.ok(!encoded.includes(field));
  const legacy=await anonymous.request('/map/masters');assert.equal(legacy.status,200);assert.ok(Array.isArray(legacy.data));assert.ok(legacy.data.some(item=>item.user_id===masters[0]));
  db.prepare('UPDATE profiles SET published=0 WHERE user_id=?').run(masters[0]);assert.equal((await anonymous.request('/map/viewport')).data.total,2,'External connection depublishing visible immediately');
  db.prepare('INSERT INTO services VALUES(?,?,?,?,?)').run('map-http-service',masters[1],'Публичная услуга',1500,30);
  db.prepare('INSERT INTO master_schedules VALUES(?,?,?,?,?)').run(masters[1],0,1440,420,'[0,1,2,3,4,5,6]');
  const soon=await anonymous.request('/map/viewport?soon=true');assert.equal(soon.status,200);assert.equal(soon.data.total,1);assert.ok(soon.data.items[0].availability.start>soon.data.checked_at);
  assert.equal(soon.data.items[0].availability.service.id,'map-http-service');assert.equal(soon.data.items[0].availability.performer,null);
  const detailResponse=await fetch(origin+'/api/map/details?kind=master&id='+encodeURIComponent(masters[1]));assert.equal(detailResponse.status,200);assert.equal(detailResponse.headers.get('cache-control'),'no-store');
  const detail=await detailResponse.json();assert.equal(detail.profile.user_id,masters[1]);assert.equal(detail.availability.service.title,'Публичная услуга');assert.equal(detail.cover,null);assert.ok(detail.refresh_at>detail.checked_at);
  assert.equal((await anonymous.request('/map/details?kind=master&id='+encodeURIComponent(masters[0]))).status,404);
  assert.equal((await anonymous.request('/map/viewport?soon=1')).status,400);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');
});

test('soon map shares full-service and related-calendar rules; ads never bypass availability; details stay public',()=>{
  const fixture=mapFixture(),{db,master,fail}=fixture;
  let clock=Date.UTC(2026,9,3,7,10),calendarCalls=0;
  db.exec(`CREATE TABLE services(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,price INTEGER,duration INTEGER);
    ALTER TABLE workspaces ADD COLUMN utc_offset INTEGER NOT NULL DEFAULT 180;
    CREATE TABLE master_schedules(master_id TEXT PRIMARY KEY,opening INTEGER,closing INTEGER,utc_offset INTEGER,weekdays TEXT);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,master_id TEXT,start INTEGER,end INTEGER,status TEXT,notes TEXT);
    CREATE INDEX appointment_time ON appointments(master_id,start,end,status);
    CREATE TABLE works(id TEXT PRIMARY KEY,user_id TEXT,image TEXT,pinned INTEGER,position INTEGER,created INTEGER);`);
  const access=workspaceAccess(db),booking=schedules({db,fail,relatedMasters:id=>access.relatedIds(id)});
  const schedule={...booking,availability:(...args)=>{calendarCalls++;return booking.availability(...args)},prepareAvailability:(...args)=>{const prepared=booking.prepareAvailability(...args);return {...prepared,availability:(...values)=>{calendarCalls++;return prepared.availability(...values)}}}};
  const promoted=new Map([['master:available',{label:'Реклама',until:clock+86400000,advertiser:'Тестовый рекламодатель',erid:'onlyPublicToken'}],
    ['master:busy',{label:'Реклама',until:clock+86400000,advertiser:'Тестовый рекламодатель',erid:'onlyPublicToken'}]]);
  fixture.promotionControl={active:()=>promoted,decorate:(card,active)=>active.has(card.kind+':'+card.user_id)?{...card,promotion:active.get(card.kind+':'+card.user_id)}:card};
  const map=mapViewport({...fixture,schedule,now:()=>clock}),query={bbox:'82,54,84,56',zoom:'18',soon:'true'};
  function person(id,{duration=30,price=1500,name='Услуга',city='Новосибирск'}={}){
    master(id,55,82.9,{city});db.prepare('INSERT INTO services VALUES(?,?,?,?,?)').run('service-'+id,id,name,price,duration);
    booking.save(id,{opening:0,closing:1440,utc_offset:420,weekdays:[0,1,2,3,4,5,6]});
  }
  function busy(id,start,end,status='confirmed'){
    db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?,?)').run('appointment-'+id+'-'+start,id,start,end,status,'PRIVATE client phone and notes');
  }
  try{
    person('available');person('ordinary');person('busy');person('future-busy',{duration:60});person('no-service');db.prepare("DELETE FROM services WHERE user_id='no-service'").run();
    person('demo');db.prepare("UPDATE profiles SET is_demo=1 WHERE user_id='demo'").run();
    busy('busy',clock-10*60000,clock+90*60000);
    // An appointment beginning beyond the one-hour start filter still prevents
    // a 60-minute service at 07:30 or 08:00 from finishing without overlap.
    busy('future-busy',Date.UTC(2026,9,3,8,15),Date.UTC(2026,9,3,9,15));
    busy('ordinary',clock,clock+60*60000,'cancelled');
    db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,name,city,slug,address,latitude,longitude,published) VALUES('soon-salon','salon','owner','Салон','Новосибирск','soon-salon-page','Громова 21',55,82.9,1)").run();
    person('staff-linked');person('staff-free');
    db.prepare("UPDATE performers SET workspace_id='soon-salon',bookable=1,user_id='available' WHERE id='staff-linked'").run();
    db.prepare("UPDATE performers SET workspace_id='soon-salon',bookable=1,user_id=NULL WHERE id='staff-free'").run();
    db.prepare("UPDATE profiles SET published=0 WHERE user_id LIKE 'staff-%'").run();
    busy('staff-linked',clock+20*60000,clock+60*60000);
    // The salon booking above blocks the same account's personal master too.
    let result=complete(map.read(query));assert.equal(result.total,2);assert.deepEqual(new Set(result.items.map(p=>p.user_id)),new Set(['ordinary','soon-salon']));
    const salon=result.items.find(p=>p.kind==='salon');assert.equal(salon.availability.performer.id,'staff-free');assert.equal(salon.availability.service.duration,30);assert.equal(salon.availability.end-salon.availability.start,30*60000);
    assert.equal(salon.availability.start,Date.UTC(2026,9,3,7,30));assert.equal(salon.availability.utc_offset,180,'Salon displays venue timezone even when the performer calendar uses another offset');
    const groupId=createSalonGroupId('Услуга',1500,30);assert.equal(salon.availability.service.id,groupId);
    assert.ok(!result.items.some(p=>p.user_id==='busy'),'Paid occupied profile is excluded just like ordinary occupied profile');
    assert.ok(!result.items.some(p=>p.user_id==='future-busy'),'Full service remains free after the start-window cutoff');
    const callsBefore=calendarCalls,ordinaryMap=map.read({...query,soon:'false'});assert.equal(calendarCalls,callsBefore,'Without soon filter there are no calendar calculations');assert.equal(ordinaryMap.total,6);assert.ok(ordinaryMap.items.some(p=>p.user_id==='busy'&&p.promotion),'Occupied advertisements remain visible on ordinary map');
    db.prepare("DELETE FROM appointments WHERE master_id='staff-linked'").run();
    result=complete(map.read(query));assert.equal(result.total,3);assert.ok(result.items.some(p=>p.user_id==='available'&&p.promotion),'Available advertisement passes the same filter');
    const first=map.read({...query,limit:'1'});assert.ok(first.next);
    const second=map.read({...query,limit:'1',cursor:first.next});assert.equal(second.items.length,1,'Immediate cursor paging uses a stable minute snapshot');
    busy('ordinary',clock+10*60000,clock+90*60000);
    assert.throws(()=>map.read({...query,limit:'1',cursor:first.next}),error=>error.status===409,'New busy calendar invalidates availability cursor immediately');
    const fresh=map.read({...query,limit:'1'});clock+=60000;assert.throws(()=>map.read({...query,limit:'1',cursor:fresh.next}),error=>error.status===409,'Clock minute changes invalidate availability cursor');
    assert.throws(()=>map.read({...query,soon:'false',limit:'1',cursor:fresh.next}),error=>error.status===409,'Availability cursor cannot be reused on unfiltered map');
    db.prepare("INSERT INTO works VALUES('public-work','available','/uploads/public-cover.webp',1,1,1)").run();
    db.prepare("INSERT INTO works VALUES('private-staff-work','staff-free','/uploads/private-cover.webp',1,1,2)").run();
    const beforeDetail=calendarCalls,detail=map.details({kind:'master',id:'available'});assert.equal(calendarCalls,beforeDetail+1,'Details computes only selected master calendar');assert.equal(detail.cover,'/uploads/public-cover.webp');assert.equal(detail.availability.service.id,'service-available');assert.ok(detail.next_available>detail.checked_at);assert.equal(detail.next_available,detail.availability.start);
    const salonDetail=map.details({kind:'salon',id:'soon-salon'});assert.equal(salonDetail.cover,null,'Unpublished staff portfolio is not a salon public cover');assert.ok(salonDetail.availability.performer.name);assert.ok(!JSON.stringify(salonDetail).includes('PRIVATE'));
    assert.throws(()=>map.details({kind:'master',id:'demo'}),error=>error.status===404);assert.throws(()=>map.details({kind:'salon',id:'unknown'}),error=>error.status===404);
    assert.throws(()=>map.read({...query,soon:['true']}));
    for(const point of result.items){assert.ok(point.availability.start>result.checked_at&&point.availability.start<=result.checked_at+60*60000);assert.equal(point.next_available,point.availability.start)}
    assert.equal(result.refresh_at,(Math.floor(result.checked_at/60000)+1)*60000+10);
    clock=Date.UTC(2026,9,3,7,30);const exact=map.read(query);assert.ok(exact.items.every(p=>p.next_available>clock),'A slot starting exactly now is never advertised as still bookable');
  }finally{db.close()}
});

function createSalonGroupId(name,price,duration){
  return createHash('sha256').update(JSON.stringify([name.toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim(),price,duration])).digest('hex');
}
