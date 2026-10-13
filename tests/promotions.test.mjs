import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {promotions} from '../lib/promotions.mjs';

test('operator placements: scopes, publication, dates, filters, stable pagination, audit and no HTTP elevation',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'atelie-promotion-')),origin='http://localhost:3214';
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3214',DATA_DIR:dir,APP_ORIGIN:origin,NODE_ENV:'test',PROMOTIONS_ENABLED:'1'},stdio:['ignore','pipe','pipe']});
  let logs='',db;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  t.after(async()=>{db?.close();const done=child.exitCode===null?new Promise(r=>child.once('exit',r)):Promise.resolve();child.kill();await done;fs.rmSync(dir,{recursive:true,force:true})});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs);
  let ip=1;const client=()=>({cookie:'',ip:'198.51.100.'+ip++,async call(url,body,method='GET'){
    const response=await fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:this.cookie,'Content-Type':'application/json','X-Forwarded-For':this.ip},body:body===undefined?undefined:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:response.headers.get('content-type')?.includes('json')?await response.json():await response.text()};
  }});
  const guest=client(),masters=[];
  for(const slug of ['aaa-organic','bbb-organic','zzz-promoted']){
    const account=client();assert.equal((await account.call('/auth/register',{login:slug,password:'PromotionTestPassword123',account_type:'master'},'POST')).status,201);
    const page={name:slug==='zzz-promoted'?'Тестовый мастер':'Обычный мастер',slug,city:'Москва',categories:['Маникюр','Татуировки'],published:true,address:'Тверская 1',latitude:55.75,longitude:37.61};
    const created=await account.call('/profile',{...page,promotion:{label:'Реклама'},premium:true},'PUT');assert.equal(created.status,200);masters.push({account,page,id:created.data.user_id});
  }
  const promotedMaster=masters[2];
  assert.ok(!(await guest.call('/search/masters')).data.items.some(p=>p.promotion),'Client cannot request premium via profile fields');
  db=new DatabaseSync(path.join(dir,'atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  const categories=JSON.parse(fs.readFileSync(new URL('../lib/categories.json',import.meta.url),'utf8'));let clock=Date.now();
  const control=promotions({db,categories,enabled:()=>true,now:()=>clock});
  const input={kind:'master',target_id:promotedMaster.id,category:'Маникюр',catalog:true,map:true,starts:clock-1000,ends:clock+86400000,priority:70,advertiser:'Тестовый рекламодатель',erid:'testTokenOnly'};
  assert.throws(()=>control.create(input,''),/оператора/);
  assert.throws(()=>control.create({...input,priority:101},'test'),/Приоритет/);
  assert.throws(()=>control.create({...input,ends:clock-1},'test'),/срок/);
  assert.throws(()=>control.create({...input,category:'Макияж'},'test'),/направления/);
  assert.throws(()=>control.create({...input,erid:'<img src=x>'},'test'),/идентификатор/);
  assert.throws(()=>control.create({...input,kind:'client'},'test'),/страница/);
  const placement=control.create(input,'test-operator');
  assert.throws(()=>control.create({...input,category:''},'test'),/пересекается/);
  const page1=(await guest.call('/search/masters?limit=1')).data;assert.equal(page1.items[0].slug,'aaa-organic');assert.equal(page1.featured[0].slug,promotedMaster.page.slug);
  assert.deepEqual(page1.featured[0].promotion,{label:'Реклама',until:input.ends,advertiser:input.advertiser,erid:input.erid});
  const page2=(await guest.call('/search/masters?limit=1&cursor='+page1.next)).data;assert.equal(page2.items[0].slug,'bbb-organic');assert.equal(page2.featured.length,0);
  const page3=(await guest.call('/search/masters?limit=1&cursor='+page2.next)).data;assert.equal(page3.items[0].slug,promotedMaster.page.slug);assert.equal(page3.next,null);
  assert.equal((await guest.call('/search/masters?q='+encodeURIComponent('Новосибирск'))).data.featured.length,0,'Promotion respects search');
  const tattoo=(await guest.call('/search/masters?category='+encodeURIComponent('Татуировки'))).data;assert.equal(tattoo.items.length,3);assert.equal(tattoo.featured.length,0);assert.ok(!tattoo.items.some(p=>p.promotion),'Category-specific ad never appears in another activity');
  const map=(await guest.call('/map/masters')).data;assert.equal(map[0].slug,promotedMaster.page.slug);assert.ok(map[0].promotion);assert.ok(!('priority' in map[0].promotion));
  assert.ok(!(await guest.call('/map/masters?category='+encodeURIComponent('Татуировки'))).data.some(p=>p.promotion));
  assert.equal(promotions({db,categories,enabled:()=>false}).active('map').size,0,'Global switch disables placements');
  clock=input.ends;assert.equal(control.active('catalog').size,0,'End is exclusive');clock=input.starts;assert.equal(control.active('map').size,1,'Start is inclusive');clock=input.starts-1;assert.equal(control.active('map').size,0);clock=Date.now();

  const date=new Date(Date.now()+2*86400000).toISOString().slice(0,10);
  assert.equal((await guest.call('/search/masters?date='+date+'&duration=60')).data.featured.length,0,'Paid profile with no service cannot bypass availability');
  await promotedMaster.account.call('/services',{name:'Маникюр',price:1800,duration:60},'POST');
  await promotedMaster.account.call('/schedule',{opening:600,closing:1200,utc_offset:180,weekdays:[0,1,2,3,4,5,6]},'PUT');
  const free=(await guest.call('/search/masters?date='+date+'&duration=60')).data;assert.equal(free.featured.length,1);assert.equal(free.featured[0].next_available,free.items[0].next_available);
  await promotedMaster.account.call('/profile',{...promotedMaster.page,categories:['Татуировки']},'PUT');assert.equal(control.active('map').size,0,'Removed advertised activity hides promotion');
  await promotedMaster.account.call('/profile',{...promotedMaster.page,published:false},'PUT');assert.equal(control.active('catalog').size,0,'Unpublishing hides placement');
  await promotedMaster.account.call('/profile',promotedMaster.page,'PUT');

  const owner=client();await owner.call('/auth/register',{login:'promotion-owner',password:'PromotionTestPassword123',account_type:'salon'},'POST');
  const wid=(await owner.call('/salons',{name:'Тестовый салон',city:'Москва'},'POST')).data.id;
  const person=(await owner.call('/salons/'+wid+'/staff',{name:'Сотрудник',categories:['Маникюр']},'POST')).data.id;
  await owner.call('/performers/'+person+'/services',{name:'Маникюр',price:1800,duration:60},'POST');
  await owner.call('/performers/'+person+'/schedule',{opening:600,closing:1200,utc_offset:180,weekdays:[0,1,2,3,4,5,6]},'PUT');
  await owner.call('/performers/'+person+'/profile',{name:'Сотрудник',categories:['Маникюр'],teaches:false,bookable:true},'PUT');
  await owner.call('/salons/'+wid+'/page',{name:'Тестовый салон',city:'Москва',slug:'premium-salon',address:'Тверская 1',latitude:55.76,longitude:37.62,utc_offset:180,published:true},'PUT');
  const salonPlacement=control.create({...input,kind:'salon',target_id:wid,catalog:true,map:false,priority:90},'test-operator');
  assert.equal((await guest.call('/search/masters')).data.featured[0].kind,'salon');
  assert.ok(!(await guest.call('/map/masters')).data.find(p=>p.kind==='salon').promotion,'Separate surface toggles');
  assert.throws(()=>control.create({...input,target_id:person},'test'),/страница/,'Staff is promoted through the salon');
  const future=control.create({...input,target_id:masters[0].id,starts:clock+100000,ends:clock+200000},'test');assert.ok(!control.active('catalog').has('master:'+masters[0].id),'Scheduled placements stay hidden');
  assert.equal(control.cancel(placement.id,'test-operator'),true);assert.equal(control.cancel(placement.id,'test-operator'),false);assert.ok(!control.active('map').size);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM promotion_events WHERE promotion_id=?').get(placement.id).n,2,'Create and cancellation audit, no duplicate event');
  assert.equal(control.cancel(salonPlacement.id,'test-operator'),true);assert.equal(control.cancel(future.id,'test-operator'),true);
  for(const c of [guest,promotedMaster.account,owner])assert.equal((await c.call('/promotions',input,'POST')).status,404,'No public operator route');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(fs.readdirSync(path.join(dir,'migration-backups')).filter(f=>f.startsWith('before-promotions-')).length,1,'Migration backup occurs once');
});
