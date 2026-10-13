import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('address autocomplete: city restriction, exact point, user-bound proofs, existing addresses, salons, quotas and secret isolation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelie-address-')),origin='http://localhost:3216';
  const fixture=path.join(dir,'run.mjs');
  fs.writeFileSync(fixture,`
    const originalFetch=globalThis.fetch;
    const cityId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',otherCity='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',houseId='cccccccc-cccc-cccc-cccc-cccccccccccc';
    globalThis.fetch=async(url,options)=>{
      if(String(url).startsWith('https://suggestions.dadata.ru/')){
        const b=JSON.parse(options.body);
        if(options.headers.Authorization!=='Token fake-address-api')throw Error('Missing server key');
        if('X-Secret' in options.headers)throw Error('Secret must not be used for suggestions');
        if(b.query==='failure')return new Response('fake-address-api NEVER_USE_THIS_SECRET',{status:503});
        const city={value:'г Новосибирск, Новосибирская область',unrestricted_value:'г Новосибирск',data:{country_iso_code:'RU',city:'Новосибирск',city_fias_id:cityId,fias_level:'4'}};
        if(b.from_bound?.value==='city'&&b.query==='москва')return Response.json({suggestions:[{...city,value:'г Москва',data:{...city.data,city:'Москва',region:'Москва',region_type:'г',city_fias_id:otherCity,fias_level:'1'}}]});
        if(b.from_bound?.value==='city')return Response.json({suggestions:[city,{...city,value:'г Томск',data:{...city.data,city:'Томск',city_fias_id:otherCity}}]});
        const approximate=b.query.includes('Пример'),street=b.query.includes('street'),foreign=b.query.includes('foreign');
        const item={value:'г Новосибирск, ул '+(approximate?'Пример':'Громова')+', д 21',unrestricted_value:'г Новосибирск, ул '+(approximate?'Пример':'Громова')+', д 21',data:{country_iso_code:'RU',city:'Новосибирск',city_fias_id:foreign?otherCity:cityId,street_with_type:'ул '+(approximate?'Пример':'Громова'),house_type:'д',house:street?null:'21',house_fias_id:street?null:houseId,fias_level:street?'7':'8',fias_actuality_state:'0',geo_lat:'54.958',geo_lon:'82.897',qc_geo:approximate?'2':'0'},private_extra:'DO_NOT_SEND_TO_CLIENT'};
        if(b.query.includes('Пустая'))item.data.geo_lat=null;
        if(b.query.includes('Подмена')&&b.count===1)item.data.house_fias_id=otherCity;
        if(b.query.includes('Удалённая')&&b.count===1)item.data.fias_actuality_state=99;
        for(const name of ['Пустая','Подмена','Удалённая'])if(b.query.includes(name)){item.data.street_with_type='ул '+name;item.value=item.unrestricted_value='г Новосибирск, ул '+name+', д 21'}
        return Response.json({suggestions:[item]});
      }
      if(String(url).startsWith('https://nominatim.openstreetmap.org/'))return Response.json([]);
      return originalFetch(url,options);
    };
    await import(${JSON.stringify(pathToFileURL(path.resolve('server.mjs')).href)});
  `);
  const child=spawn(process.execPath,[fixture],{env:{...process.env,PORT:'3216',DATA_DIR:dir,APP_ORIGIN:origin,NODE_ENV:'test',DADATA_API_KEY:'fake-address-api',DADATA_SECRET_KEY:'NEVER_USE_THIS_SECRET',ADDRESS_DAILY_LIMIT:'50'},stdio:['ignore','pipe','pipe']});
  let logs='',db;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  t.after(async()=>{db?.close();const done=child.exitCode===null?new Promise(r=>child.once('exit',r)):Promise.resolve();child.kill();await done;fs.rmSync(dir,{recursive:true,force:true})});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs);
  let ip=0;const client=()=>({cookie:'',ip:'198.51.100.'+(++ip),async call(url,body,method=body===undefined?'GET':'POST',source=origin){
    const response=await fetch(origin+'/api'+url,{method,headers:{Origin:source,Cookie:this.cookie,'Content-Type':'application/json','X-Forwarded-For':this.ip},body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  }});
  const master=client(),other=client(),owner=client(),reader=client(),guest=client();
  for(const [c,login,role] of [[master,'address-master','master'],[other,'address-other','master'],[owner,'address-owner','salon'],[reader,'address-reader','client']])assert.equal((await c.call('/auth/register',{login,password:'AddressTestPassword123',account_type:role})).status,201);
  assert.equal((await guest.call('/address/config')).status,401);assert.equal((await reader.call('/address/config')).status,403);
  assert.deepEqual((await master.call('/address/config')).data,{enabled:true,provider:'dadata'});
  const moscow=(await master.call('/address/suggestions',{kind:'city',query:'Москва'})).data.items;
  const prefixed=(await master.call('/address/suggestions',{kind:'city',query:'город москва'})).data.items;
  assert.equal(moscow[0].city,'Москва');assert.deepEqual(moscow.map(s=>s.label),prefixed.map(s=>s.label),'Federal cities survive filtering; city prefix gives same results');
  assert.equal((await master.call('/address/suggestions',{kind:'city',query:'Нов'},'POST','https://foreign.invalid')).status,403);
  const query={kind:'city',query:'Новосибирск'};
  const cities=(await master.call('/address/suggestions',query)).data.items;assert.equal(cities.length,2);assert.equal(cities[0].city,'Новосибирск');assert.match(cities[0].id,/^[a-f0-9]{64}$/);
  const otherCities=(await other.call('/address/suggestions',query)).data.items;
  assert.notEqual(cities[0].id,otherCities[0].id,'Cached provider data must issue new private selections for each user');
  assert.equal((await other.call('/address/suggestions',{kind:'address',query:'Громова 21',city_selection:cities[0].id})).status,400);
  const addresses=(await master.call('/address/suggestions',{kind:'address',query:'Громова 21',city_selection:cities[0].id})).data.items;
  assert.equal(addresses[0].label,'ул Громова, д 21');assert.equal(addresses[0].house,true);
  assert.equal((await master.call('/address/suggestions',{kind:'address',query:'foreign',city_selection:cities[0].id})).data.items.length,0,'Foreign city response rejected');
  const street=(await master.call('/address/suggestions',{kind:'address',query:'street',city_selection:cities[0].id})).data.items[0];assert.equal(street.house,false);assert.equal((await master.call('/address/resolve',{selection:street.id})).status,400);
  const resolved=await master.call('/address/resolve',{selection:addresses[0].id,latitude:0,longitude:0});assert.equal(resolved.status,200);assert.equal(resolved.data.points[0].latitude,54.958);
  const point=resolved.data.points[0],page={name:'Проверка адреса',slug:'address-master',city:resolved.data.city,address:resolved.data.address,latitude:point.latitude,longitude:point.longitude,categories:['Маникюр'],published:true,address_selection:point.selection,city_selection:cities[0].id};
  assert.equal((await master.call('/profile',{...page,address_selection:undefined},'PUT')).status,400,'Coordinates alone are not proof');
  assert.equal((await other.call('/profile',{...page,slug:'address-other'},'PUT')).status,400,'Proof bound to original user');
  assert.equal((await master.call('/profile',{...page,latitude:0},'PUT')).status,400,'Coordinate spoofing');
  assert.equal((await master.call('/profile',{...page,city:'Томск'},'PUT')).status,400,'City spoofing');
  assert.equal((await master.call('/profile',page,'PUT')).status,200);
  assert.equal((await master.call('/profile',{...page,address_selection:undefined,city_selection:undefined,bio:'Другое описание'},'PUT')).status,200,'Existing unchanged address does not need another external request');
  const approximate=(await master.call('/address/suggestions',{kind:'address',query:'Пример 21',city_selection:cities[0].id})).data.items[0];
  const uncertain=(await master.call('/address/resolve',{selection:approximate.id})).data;assert.equal(uncertain.points.length,0,'Street coordinates never used as house coordinates');assert.match(uncertain.message,/точн/);assert.ok(uncertain.manual.selection);
  const manualBody={selection:uncertain.manual.selection,latitude:54.9581,longitude:82.8971,confirmed:true};
  assert.equal((await other.call('/address/confirm-point',manualBody)).status,400,'Manual proof belongs to original user');
  assert.equal((await master.call('/address/confirm-point',{...manualBody,confirmed:false})).status,400,'Explicit owner confirmation required');
  assert.equal((await master.call('/address/confirm-point',{...manualBody,latitude:0,longitude:0})).status,400,'Point outside address neighborhood rejected');
  assert.equal((await master.call('/address/confirm-point',{...manualBody,selection:approximate.id})).status,400,'House choice alone cannot confirm arbitrary coordinates');
  const manualPoint=(await master.call('/address/confirm-point',manualBody)).data.point;assert.equal(manualPoint.source,'user');
  assert.equal((await master.call('/profile',{...page,address:uncertain.address,latitude:manualPoint.latitude,longitude:manualPoint.longitude,address_selection:manualPoint.selection},'PUT')).status,200,'Explicitly confirmed owner point can be saved');
  assert.equal((await master.call('/profile',page,'PUT')).status,200,'Restore prior address using valid original proof');
  for(const [query,status] of [['Пустая 21',200],['Подмена 21',400],['Удалённая 21',400]]){
    const selected=(await master.call('/address/suggestions',{kind:'address',query,city_selection:cities[0].id})).data.items[0];
    // The fake provider echoes the selected text so count=1 tests the same choice.
    const checked=await master.call('/address/resolve',{selection:selected.id});
    assert.equal(checked.status,status,query);if(status===200)assert.equal(checked.data.points.length,0,'Missing coordinates never interpreted as zero');
  }
  const failure=await master.call('/address/suggestions',{kind:'city',query:'failure'});assert.equal(failure.status,503);assert.ok(!JSON.stringify(failure.data).includes('fake-address-api'),'Provider failure body not leaked');
  const ownerCity=(await owner.call('/address/suggestions',query)).data.items[0];
  const ownerAddress=(await owner.call('/address/suggestions',{kind:'address',query:'Громова 21',city_selection:ownerCity.id})).data.items[0];
  const ownerPoint=(await owner.call('/address/resolve',{selection:ownerAddress.id})).data.points[0];
  const wid=(await owner.call('/salons',{name:'Адресный салон',city:'Новосибирск'})).data.id;
  const salonPage={name:'Адресный салон',slug:'address-salon',city:'Новосибирск',address:'ул Громова, д 21',latitude:ownerPoint.latitude,longitude:ownerPoint.longitude,utc_offset:420,published:false,address_selection:ownerPoint.selection};
  assert.equal((await owner.call('/salons/'+wid+'/page',{...salonPage,address_selection:point.selection},'PUT')).status,400,'Salon rejects another user proof');
  assert.equal((await owner.call('/salons/'+wid+'/page',salonPage,'PUT')).status,200);
  const map=(await guest.call('/map/masters')).data;assert.equal(map[0].address,page.address);assert.ok(!JSON.stringify(map).includes('selection'));
  for(const response of [cities,addresses,resolved.data,map]){const raw=JSON.stringify(response);for(const secret of ['fake-address-api','NEVER_USE_THIS_SECRET','DO_NOT_SEND_TO_CLIENT','unrestricted_value','house_fias_id'])assert.ok(!raw.includes(secret),'No '+secret)}
  db=new DatabaseSync(path.join(dir,'atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON');
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM address_choices').all()).includes(point.selection),'Selections hashed at rest');
  db.prepare('UPDATE address_choices SET expires=0 WHERE kind=?').run('point');
  assert.equal((await master.call('/profile',{...page,address:'ул Громова, д 22'},'PUT')).status,400,'Expired proof rejected');
  assert.equal((await master.call('/profile',{...page,bio:'Снова'},'PUT')).status,200,'Existing point remains usable after proof expiry');
  db.prepare("UPDATE address_choices SET expires=0 WHERE kind='city'").run();
  assert.equal((await master.call('/address/suggestions',{kind:'address',query:'Громова 21',city_selection:cities[0].id})).status,400,'Expired city choice rejected');
  const countBefore=db.prepare('SELECT requests FROM address_budget').get().requests;
  await owner.call('/address/suggestions',query);assert.equal(db.prepare('SELECT requests FROM address_budget').get().requests,countBefore,'Shared cache avoids provider calls');
  db.prepare('UPDATE address_budget SET requests=50').run();assert.equal((await owner.call('/address/suggestions',{kind:'city',query:'Новый запрос'})).status,429,'Global daily budget enforced before network');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
