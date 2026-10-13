import {randomBytes,createHash} from 'node:crypto';
import {rateLimit} from 'express-rate-limit';
import {exactCandidates,parseAddress} from './geocoding.mjs';

const digest=v=>createHash('sha256').update(v).digest('hex');
const text=(v,max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(v);
const locality=d=>Number(d.fias_level)===6?{id:d.settlement_fias_id,name:d.settlement}:{id:d.city_fias_id||(d.region_type==='г'?d.region_fias_id:null),name:d.city||(d.region_type==='г'?d.region:null)};
const addressText=d=>[d.street_with_type||d.planning_structure_with_type,d.house&&((d.house_type||'д')+' '+d.house),d.block&&((d.block_type||'к')+' '+d.block)].filter(Boolean).join(', ');
const distance=(a,b)=>{const rad=n=>n*Math.PI/180;const x=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;return 6371000*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)))};

export function addressSuggestions({app,db,requireUser,fail,geocode,fetcher=fetch,key=()=>process.env.DADATA_API_KEY,now=Date.now,dailyLimit=()=>Number(process.env.ADDRESS_DAILY_LIMIT||9000)}){
  const get=(sql,...a)=>db.prepare(sql).get(...a),run=(sql,...a)=>db.prepare(sql).run(...a);
  // Temporary provider results/proofs, independent of public business data.
  db.exec(`CREATE TABLE IF NOT EXISTS address_cache(query TEXT PRIMARY KEY,results TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS address_budget(day TEXT PRIMARY KEY,requests INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS address_choices(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,kind TEXT NOT NULL,details TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS address_choices_expiry ON address_choices(expires);`);
  const ready=()=>Boolean(key());
  function cleanup(){run('DELETE FROM address_choices WHERE expires<=?',now());run('DELETE FROM address_cache WHERE expires<=?',now());run('DELETE FROM address_budget WHERE day<?',new Date(now()-2*86400000).toISOString().slice(0,10))}
  function issue(user,kind,details,ttl=30*60000){const token=randomBytes(32).toString('hex');run('INSERT INTO address_choices VALUES(?,?,?,?,?)',digest(token),user,kind,JSON.stringify(details),now()+ttl);return token}
  function choice(user,token,kind){
    if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token))fail('Выберите вариант из подсказок');
    const row=get('SELECT details FROM address_choices WHERE token_hash=? AND user_id=? AND kind=? AND expires>?',digest(token),user,kind,now());
    if(!row)fail('Подсказка устарела. Найдите адрес ещё раз');return JSON.parse(row.details);
  }
  const inFlight=new Map();let outboundTimes=[],activeRequests=0;
  async function request(body){
    if(!ready())fail('Проверка адреса пока не настроена',503);
    const cacheKey=digest(JSON.stringify(body)),cached=get('SELECT results FROM address_cache WHERE query=? AND expires>?',cacheKey,now());
    if(cached)return JSON.parse(cached.results);
    if(inFlight.has(cacheKey))return inFlight.get(cacheKey);
    const work=(async()=>{
      const limit=dailyLimit();if(!Number.isSafeInteger(limit)||limit<1||limit>1000000)fail('Подсказки временно недоступны',503);
      outboundTimes=outboundTimes.filter(time=>time>now()-1000);
      if(outboundTimes.length>=25||activeRequests>=8)fail('Подсказки заняты. Повторите через несколько секунд',429);
      const day=new Date(now()).toISOString().slice(0,10);
      const reserved=get('INSERT INTO address_budget VALUES(?,1) ON CONFLICT(day) DO UPDATE SET requests=requests+1 WHERE requests<? RETURNING requests',day,limit);
      if(!reserved)fail('Дневной лимит подсказок исчерпан. Попробуйте завтра',429);
      outboundTimes.push(now());activeRequests++;
      try{
        const response=await fetcher('https://suggestions.dadata.ru/suggestions/api/4_1/rs/suggest/address',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json',Authorization:'Token '+key()},body:JSON.stringify(body),signal:AbortSignal.timeout(8000),redirect:'error'});
        if(!response.ok)fail('Проверка адреса временно недоступна. Попробуйте сохранить позже',503);
        const data=await response.json();if(!Array.isArray(data.suggestions)||data.suggestions.length>20)fail('Не удалось получить подсказки',502);
        const result=data.suggestions.filter(s=>s&&typeof s.value==='string'&&s.data&&s.data.country_iso_code==='RU');
        run('INSERT INTO address_cache VALUES(?,?,?) ON CONFLICT(query) DO UPDATE SET results=excluded.results,expires=excluded.expires',cacheKey,JSON.stringify(result),now()+10*60000);
        return result;
      }catch(error){if(error.status)throw error;fail('Проверка адреса временно недоступна. Попробуйте сохранить позже',503)}finally{activeRequests--}
    })();
    inFlight.set(cacheKey,work);try{return await work}finally{inFlight.delete(cacheKey)}
  }
  function manager(req,res,next){
    const user=get('SELECT account_type FROM users WHERE id=?',req.user.id);
    if(user?.account_type!=='master'&&!get("SELECT 1 FROM workspaces WHERE kind='salon' AND owner_user_id=?",req.user.id)&&user?.account_type!=='salon')return res.status(403).json({error:'Подсказки доступны в настройках мастера и салона'});
    next();
  }
  const limit=rateLimit({windowMs:60000,limit:45,keyGenerator:req=>req.user.id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много подсказок. Подождите минуту'}});
  app.get('/api/address/config',requireUser,manager,(req,res)=>res.json({enabled:ready(),provider:ready()?'dadata':null}));
  app.post('/api/address/suggestions',requireUser,manager,limit,async(req,res)=>{
    cleanup();const b=req.body,query=text(b.query),kind=b.kind;
    if(query.length<2||!['city','address'].includes(kind))fail('Укажите город или адрес');
    let city=null,body;
    if(kind==='city'){
      const normalized=query.replace(/^(?:город\s+|г\.?\s+)/iu,'').trim().toLocaleLowerCase('ru-RU');
      if(normalized.length<2)fail('Укажите название города');
      body={query:normalized,count:5,locations:[{country:'Россия'}],from_bound:{value:'city'},to_bound:{value:'settlement'}};
    }
    else{
      city=choice(req.user.id,b.city_selection,'city');
      const restriction=city.settlement?{settlement_fias_id:city.city_id}:{city_fias_id:city.city_id};
      body={query,count:5,locations:[restriction],restrict_value:true,from_bound:{value:'street'},to_bound:{value:'house'}};
    }
    const found=await request(body),items=[];
    for(const s of found){
      const d=s.data,place=kind==='city'?locality(d):city;
      if(kind==='city'){
        const level=Number(d.fias_level),federal=level===1&&d.region_type==='г';
        if(!uuid(place.id)||!place.name||!([4,6].includes(level)||federal))continue;
        const details={city:text(place.name,80),city_id:place.id,settlement:Number(d.fias_level)===6};
        items.push({id:issue(req.user.id,'city',details),label:text(s.value,300),city:details.city,settlement:details.settlement});
      }else{
        if((city.settlement?d.settlement_fias_id:d.city_fias_id)!==city.city_id)continue;
        const house=Boolean(d.house&&uuid(d.house_fias_id)&&Number(d.fias_level)===8),address=house?addressText(d):text(d.street_with_type||s.value);
        if(!address||address.length>200)continue;
        const details={...city,address,house,house_id:d.house_fias_id,query:text(s.unrestricted_value||s.value,300)};
        items.push({id:issue(req.user.id,'address',details),label:address,house});
      }
    }
    res.json({items});
  });
  async function confirmedHouse(selected){
    if(!selected.house)fail('Укажите и выберите номер дома');
    const rows=await request({query:selected.query,count:1,to_bound:{value:'house'}});
    const house=rows.find(s=>s.data.house_fias_id===selected.house_id&&(selected.settlement?s.data.settlement_fias_id:s.data.city_fias_id)===selected.city_id)?.data;
    if(!house||Number(house.fias_level)!==8||!house.house||house.flat||Number(house.fias_actuality_state)===99)fail('Не удалось подтвердить выбранный дом. Найдите адрес ещё раз');
    return house;
  }
  const cityName=v=>text(v,80).replace(/^(?:город\s+|г\.\s*|г\s+|пгт\s+|пос[её]лок\s+|село\s+|деревня\s+)/iu,'').trim();
  const same=(a,b)=>String(a||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'')===String(b||'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]/gu,'');
  const regionName=v=>String(v||'').replace(/(?:^|\s)(?:область|обл\.?|республика|респ\.?|край|город|г\.?)(?=\s|$)/giu,' ').trim();
  function matchesHouse(d,city,address){
    return exactCandidates([{lat:0,lon:0,address:{country_code:'ru',city,road:d.street_with_type||d.planning_structure_with_type,house_number:[d.house,d.block&&((d.block_type||'к')+' '+d.block)].filter(Boolean).join(' ')}}],city,address).length===1;
  }
  async function checkInput(user,cityInput,addressInput){
    cleanup();const [name,...regionParts]=text(cityInput,80).split(',');const city=cityName(name),region=regionParts.join(',').trim(),address=text(addressInput);
    if(city.length<2)fail('Проверьте адрес: укажите город');
    if(address&&!parseAddress(address))fail('Проверьте адрес: укажите улицу и номер дома без квартиры');
    if(!ready()){
      if(!address)return {city,address:'',points:[]};
      let points;try{points=(await geocode(city,address)).filter(p=>p.building)}catch{fail('Проверка адреса временно недоступна. Попробуйте сохранить позже',503)}
      if(points.length!==1)fail('Не удалось подтвердить адрес. Проверьте город, улицу и номер дома');
      return {city,address,points:points.map(p=>({...p,selection:issue(user,'point',{city,address,latitude:p.latitude,longitude:p.longitude},24*3600000)}))};
    }
    const rows=await request({query:address?cityInput+', '+address:cityInput,count:20,locations:[{country:'Россия'}],...(address?{to_bound:{value:'house'}}:{from_bound:{value:'city'},to_bound:{value:'settlement'}})});
    const found=[];let needsBuildingPart=false;
    for(const s of rows){
      const d=s.data;
      if(region&&!same(regionName(region),regionName(d.region_with_type)))continue;
      const settlement=Boolean(d.settlement&&same(city,d.settlement));
      const place=settlement?{name:d.settlement,id:d.settlement_fias_id}:locality(d);
      if(!same(city,place.name)||!uuid(place.id)||Number(d.fias_actuality_state)===99)continue;
      if(address){
        if(!d.flat&&d.house&&(d.block||Number(d.fias_level)===7)&&matchesHouse({...d,block:null},place.name,address))needsBuildingPart=true;
        if(Number(d.fias_level)!==8||!uuid(d.house_fias_id)||!d.house||d.flat||!matchesHouse(d,place.name,address))continue;
        found.push({city:text(place.name,80),city_id:place.id,settlement,address:addressText(d),house:true,house_id:d.house_fias_id,query:text(s.unrestricted_value||s.value,300)});
      }else if([4,6].includes(Number(d.fias_level))||Number(d.fias_level)===1&&d.region_type==='г')found.push({city:text(place.name,80),city_id:place.id,settlement,address:''});
    }
    const unique=[...new Map(found.map(s=>[s.house_id||s.city_id,s])).values()];
    if(!unique.length)fail(needsBuildingPart?'Уточните адрес: укажите корпус или строение дома':address?'Адрес не найден. Проверьте адрес: город, улицу и номер дома':'Город не найден. Проверьте название города');
    if(unique.length!==1)fail('Уточните адрес: укажите город и регион через запятую');
    const selected=unique[0];
    if(!address)return {city:selected.city,address:'',city_selection:issue(user,'city',selected),points:[]};
    const house=await confirmedHouse(selected);
    if(!matchesHouse(house,selected.city,selected.address))fail('Адрес изменился в справочнике. Проверьте адрес ещё раз');
    return resolveHouse(user,selected,house);
  }
  async function resolveHouse(user,selected,house){
    const latitude=house.geo_lat==null||house.geo_lat===''?NaN:Number(house.geo_lat),longitude=house.geo_lon==null||house.geo_lon===''?NaN:Number(house.geo_lon);
    let points=[];
    if(String(house.qc_geo)==='0'&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180)points=[{latitude,longitude,label:selected.address}];
    else if(geocode){try{points=(await geocode(selected.city,selected.address)).filter(p=>p.building)}catch{/* House existence is already confirmed; do not substitute approximate coordinates. */}}
    const center=Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180?{latitude,longitude}:null;
    return {city:selected.city,address:selected.address,points:points.map(p=>({label:p.label,latitude:p.latitude,longitude:p.longitude,selection:issue(user,'point',{city:selected.city,address:selected.address,latitude:p.latitude,longitude:p.longitude},24*3600000)})),...(!points.length&&center?{manual:{center,selection:issue(user,'manual-address',{...selected,center,radius:String(house.qc_geo)==='1'?2000:20000})}}:{})};
  }
  app.post('/api/address/check',requireUser,manager,limit,async(req,res)=>res.json(await checkInput(req.user.id,text(req.body.city,80),text(req.body.address))));
  function savedResult(value){
    const address=text(value?.address),latitude=value?.latitude??null,longitude=value?.longitude??null;
    return {checked:Boolean(address),needs_point:Boolean(address&&(latitude===null||longitude===null)),city:text(value?.city,80),address,latitude,longitude};
  }
  function snapshot(value){return JSON.stringify([text(value?.city,80),text(value?.address),value?.latitude??null,value?.longitude??null])}
  async function prepareSave(req,b,old,{recheck=false}={}){
    if(b.address_mode==='preserve'){
      if(!old?.city)fail('Сначала сохраните адрес');
      Object.assign(b,{city:old.city,address:old.address||'',latitude:old.latitude??null,longitude:old.longitude??null});
      return null;
    }
    if(b.address_mode!=='on-save'){assertSaved(req,b,old);return null}
    const unchanged=old&&text(b.city,80)===old.city&&text(b.address)===old.address&&(b.latitude??null)===old.latitude&&(b.longitude??null)===old.longitude;
    if((!recheck&&unchanged)||b.address_selection){assertSaved(req,b,old);return savedResult(b)}
    const result=await checkInput(req.user.id,text(b.city,80),text(b.address));
    if(result.points.length>1)fail('Найдено несколько точек дома. Уточните адрес и корпус');
    // Rechecking a saved house must retain an owner's previously confirmed exact marker.
    if(recheck&&unchanged&&result.city===old.city&&result.address===old.address){assertSaved(req,b,old);return savedResult(b)}
    const point=result.points[0];
    Object.assign(b,{city:result.city,address:result.address,latitude:point?.latitude??null,longitude:point?.longitude??null,city_selection:result.city_selection,address_selection:point?.selection||(result.address?issue(req.user.id,'point',{city:result.city,address:result.address,latitude:null,longitude:null},24*3600000):undefined)});
    assertSaved(req,b,old);
    return savedResult(b);
  }
  app.post('/api/address/resolve',requireUser,manager,limit,async(req,res)=>{
    cleanup();const selected=choice(req.user.id,req.body.selection,'address'),house=await confirmedHouse(selected);
    const latitude=house.geo_lat==null||house.geo_lat===''?NaN:Number(house.geo_lat),longitude=house.geo_lon==null||house.geo_lon===''?NaN:Number(house.geo_lon);
    let points=[];
    if(String(house.qc_geo)==='0'&&Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180)points=[{latitude,longitude,label:selected.address}];
    else if(geocode){try{points=(await geocode(selected.city,selected.address)).filter(p=>p.building)}catch{/* Never publish an approximate point when the fallback fails. */}}
    if(!points.length){
      const center=Number.isFinite(latitude)&&Math.abs(latitude)<=90&&Number.isFinite(longitude)&&Math.abs(longitude)<=180?{latitude,longitude}:null;
      return res.json({city:selected.city,address:selected.address,points:[],message:'Дом найден, но в справочниках нет точной точки. Укажите ваш дом на карте и подтвердите его',...(center?{manual:{center,selection:issue(req.user.id,'manual-address',{...selected,center,radius:String(house.qc_geo)==='1'?2000:20000})}}:{})});
    }
    res.json({city:selected.city,address:selected.address,points:points.map(p=>({label:p.label,latitude:p.latitude,longitude:p.longitude,selection:issue(req.user.id,'point',{city:selected.city,address:selected.address,latitude:p.latitude,longitude:p.longitude},24*3600000)}))});
  });
  app.post('/api/address/confirm-point',requireUser,manager,limit,async(req,res)=>{
    cleanup();const selected=choice(req.user.id,req.body.selection,'manual-address'),b=req.body;
    if(b.confirmed!==true)fail('Подтвердите точку вашего дома');
    const latitude=typeof b.latitude==='number'?b.latitude:NaN,longitude=typeof b.longitude==='number'?b.longitude:NaN;
    if(!Number.isFinite(latitude)||Math.abs(latitude)>90||!Number.isFinite(longitude)||Math.abs(longitude)>180||distance(selected.center,{latitude,longitude})>selected.radius)fail('Выберите точку рядом с найденным адресом');
    await confirmedHouse(selected);
    const point={latitude,longitude,label:selected.address,source:'user',selection:issue(req.user.id,'point',{city:selected.city,address:selected.address,latitude,longitude,source:'user'},24*3600000)};
    res.json({city:selected.city,address:selected.address,point});
  });
  function assertSaved(req,b,old){
    if(!ready())return;
    const city=text(b.city,80),address=text(b.address),latitude=b.latitude==null||b.latitude===''?null:Number(b.latitude),longitude=b.longitude==null||b.longitude===''?null:Number(b.longitude);
    if(old&&city===old.city&&address===old.address&&latitude===old.latitude&&longitude===old.longitude)return;
    if(!address){
      if(latitude!==null||longitude!==null)fail('Для точки карты выберите адрес');
      if(!old||city!==old.city){const selected=choice(req.user.id,b.city_selection,'city');if(selected.city!==city)fail('Город изменился. Выберите его из подсказок')}
      return;
    }
    const selected=choice(req.user.id,b.address_selection,'point');
    if(selected.city!==city||selected.address!==address||selected.latitude!==latitude||selected.longitude!==longitude)fail('Адрес или точка изменились. Выберите адрес ещё раз');
  }
  return {ready,assertSaved,prepareSave,savedResult,snapshot,saveLimit:limit};
}
