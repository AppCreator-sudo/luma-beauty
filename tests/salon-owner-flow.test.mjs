import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {migrateSalonContent} from '../lib/salon-content.mjs';

test('salon publication migration preserves existing records, creates a private snapshot and repeats safely',t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'atelie-salon-content-')),db=new DatabaseSync(path.join(directory,'source.sqlite'));
  t.after(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true})});
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,created INTEGER); CREATE TABLE workspaces(id TEXT PRIMARY KEY,name TEXT); INSERT INTO workspaces VALUES('salon','Сохранить');");
  const backupDir=path.join(directory,'backups');migrateSalonContent(db,{backupDir});migrateSalonContent(db,{backupDir});
  assert.equal(fs.readdirSync(backupDir).length,1);
  const snapshot=new DatabaseSync(path.join(backupDir,fs.readdirSync(backupDir)[0]),{readOnly:true});
  assert.equal(snapshot.prepare("SELECT name FROM workspaces WHERE id='salon'").get().name,'Сохранить');
  assert.equal(snapshot.prepare("SELECT 1 FROM sqlite_master WHERE name='salon_posts'").get(),undefined);snapshot.close();
  assert.equal(db.prepare('SELECT COUNT(*) n FROM schema_migrations').get().n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('owner flow validates staff, keeps only salon catalog cards, isolates publication ownership and preserves linked availability',async t=>{
  const directory=process.env.OWNER_FLOW_DATA_DIR||fs.mkdtempSync(path.join(os.tmpdir(),'atelie-owner-flow-'));
  fs.mkdirSync(directory,{recursive:true});const port=process.env.OWNER_FLOW_PORT||'3249',origin='http://localhost:'+port;
  const child=spawn(process.execPath,['.cache/studio-onboarding-server.mjs'],{env:{...process.env,PORT:port,APP_ORIGIN:origin,DATA_DIR:directory,NODE_ENV:'test',DADATA_API_KEY:'fake-owner-flow-key'},stdio:['ignore','pipe','pipe']});
  let logs='',db;child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
  t.after(async()=>{db?.close();child.kill();if(child.exitCode===null)await new Promise(r=>child.once('exit',r));if(!process.env.OWNER_FLOW_DATA_DIR)fs.rmSync(directory,{recursive:true,force:true})});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs);
  let ip=1;const client=()=>({cookie:'',ip:'198.51.100.'+ip++,async call(url,body,method='POST'){
    const multipart=body instanceof FormData,r=await fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:this.cookie,'X-Forwarded-For':this.ip,...(multipart?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
    if(r.headers.get('set-cookie'))this.cookie=r.headers.get('set-cookie').split(';')[0];return {status:r.status,data:await r.json()};
  }});
  const owner=client(),employee=client(),outsider=client(),guest=client();
  for(const [c,login,type] of [[owner,'flow-owner','salon'],[employee,'flow-employee','master'],[outsider,'flow-outsider','salon']])assert.equal((await c.call('/auth/register',{login,password:'OwnerFlowPassword123',account_type:type})).status,201);
  const employeeId=(await employee.call('/me',undefined,'GET')).data.user.id;
  const wid=(await owner.call('/salons',{name:'Салон Линия',city:'Новосибирск'})).data.id;
  const config={opening:600,closing:1200,utc_offset:420,weekdays:[0,1,2,3,4,5,6]};
  const photo=await sharp({create:{width:256,height:400,channels:3,background:'#b78467'}}).jpeg().toBuffer();
  function staffForm(name,ids=[],newService=null,includePhoto=true){const f=new FormData();f.set('name',name);f.set('categories',JSON.stringify(['Маникюр']));f.set('schedule',JSON.stringify(config));f.set('service_ids',JSON.stringify(ids));f.set('visible','true');if(newService)f.set('new_service',JSON.stringify(newService));if(includePhoto)f.set('image',new Blob([photo],{type:'image/jpeg'}),'portrait.jpg');return f;}
  assert.equal((await owner.call('/salons/'+wid+'/staff',staffForm('Без фото',[],{name:'Маникюр',price:2000,duration:60},false))).status,400);
  const draft=(await owner.call('/salons/'+wid+'/staff',{name:'Черновик',categories:[],draft:true})).data;
  assert.equal(draft.bookable,0);assert.equal(draft.ready,false);
  assert.equal((await owner.call('/performers/'+draft.id+'/visibility',{visible:true},'PATCH')).status,400);
  const firstResult=await owner.call('/salons/'+wid+'/staff',staffForm('Анна',[],{name:'Маникюр',price:2000,duration:60}));assert.equal(firstResult.status,201,JSON.stringify(firstResult.data));
  const first=firstResult.data;assert.equal(first.ready,true);assert.equal(first.bookable,1);assert.equal(first.schedule.utc_offset,180,'Salon timezone takes precedence');
  const second=(await owner.call('/salons/'+wid+'/staff',staffForm('Мария',[first.services[0].id]))).data;assert.ok(second.id);assert.notEqual(second.services[0].id,first.services[0].id);
  assert.equal((await outsider.call('/performers/'+first.id+'/setup',staffForm('Подмена'),'PUT')).status,404);
  const invalidDay=staffForm('Неверный график',[first.services[0].id]);invalidDay.set('schedule',JSON.stringify({...config,weekdays:[]}));assert.equal((await owner.call('/salons/'+wid+'/staff',invalidDay)).status,400);
  const cleared=staffForm('Анна',[first.services[0].id],null,false);cleared.set('draft','true');cleared.set('schedule',JSON.stringify({...config,weekdays:[]}));
  const hidden=await owner.call('/performers/'+first.id+'/setup',cleared,'PUT');assert.equal(hidden.status,200);assert.deepEqual(hidden.data.schedule.weekdays,[]);assert.equal(hidden.data.bookable,0);
  assert.equal((await owner.call('/performers/'+first.id+'/setup',staffForm('Анна',[first.services[0].id],null,false),'PUT')).status,200);
  const address=await owner.call('/salons/'+wid+'/address',{city:'Новосибирск',address:'ул Громова, д 21'},'PUT');assert.equal(address.status,200,JSON.stringify(address.data));
  const page=await owner.call('/salons/'+wid+'/page',{name:'Салон Линия',slug:'salon-owner-flow',city:'Новосибирск',bio:'Команда',address_mode:'preserve',published:true,utc_offset:420},'PUT');assert.equal(page.status,200,JSON.stringify(page.data));
  const reloaded=(await owner.call('/salons/'+wid,undefined,'GET')).data;assert.equal(reloaded.staff.find(p=>p.id===first.id).schedule.utc_offset,420);
  const search=await guest.call('/search/masters?q='+encodeURIComponent('Анна'),undefined,'GET');assert.equal(search.status,200,JSON.stringify(search.data));const result=search.data;
  assert.equal(result.items.length,1);assert.equal(result.items[0].kind,'salon');assert.equal(result.items[0].matching_staff[0].id,first.id);
  assert.equal((await guest.call('/profiles',undefined,'GET')).data.some(p=>p.kind==='staff'),false);
  function publication(pid='',service='',caption='Работа Анны'){const f=new FormData();f.set('performer_id',pid);f.set('service_id',service);f.set('caption',caption);f.set('post_kind','space');f.set('image',new Blob([photo],{type:'image/jpeg'}),'work.jpg');return f;}
  const route='/salons/'+wid+'/publications';
  assert.equal((await owner.call(route,publication(first.id,second.services[0].id))).status,400);
  assert.equal((await outsider.call(route,publication())).status,404);assert.equal((await guest.call(route,undefined,'GET')).status,401);
  const work=(await owner.call(route,publication(first.id,first.services[0].id))).data.id;
  const post=(await owner.call(route,publication('','','Интерьер салона'))).data.id;assert.ok(work&&post);
  const publicData=(await guest.call('/public/salons/salon-owner-flow',undefined,'GET')).data;
  assert.equal(publicData.works.filter(p=>p.id===work).length,1);assert.equal(publicData.works[0].performer_id,first.id);assert.equal(publicData.posts[0].id,post);
  db=new DatabaseSync(path.join(directory,'atelie.sqlite'));
  assert.equal(db.prepare('SELECT published FROM profiles WHERE user_id=?').get(first.id).published,0);
  db.prepare('UPDATE profiles SET city=? WHERE user_id=?').run('Москва',first.id);
  const inspiration=(await guest.call('/inspiration',undefined,'GET')).data.items.find(item=>item.id===work);
  assert.ok(inspiration,'Salon work is public without a separately published staff profile');
  assert.equal(inspiration.performer_id,first.id);assert.equal(inspiration.salon_id,wid);
  assert.equal(inspiration.salon_slug,'salon-owner-flow');assert.equal(inspiration.salon_name,'Салон Линия');
  assert.equal(inspiration.city,'Новосибирск');assert.equal(inspiration.master_name,'Анна');
  assert.deepEqual(inspiration.images,publicData.works[0].images);
  for(const city of ['Новосибирск','новосибирск','НОВОСИБИРСК'])assert.ok((await guest.call('/inspiration?city='+encodeURIComponent(city),undefined,'GET')).data.items.some(item=>item.id===work));
  assert.equal((await guest.call('/inspiration?city='+encodeURIComponent('Москва'),undefined,'GET')).data.items.some(item=>item.id===work),false,'Salon city overrides a stale personal-profile city');
  assert.ok((await guest.call('/inspiration?category='+encodeURIComponent('Маникюр'),undefined,'GET')).data.items.some(item=>item.id===work));
  assert.equal((await guest.call('/inspiration?category='+encodeURIComponent('Волосы'),undefined,'GET')).data.items.some(item=>item.id===work),false);
  db.prepare('UPDATE profiles SET city=? WHERE user_id=?').run('Новосибирск',first.id);
  assert.equal((await outsider.call('/works/'+work+'/save',{})).status,200);
  const salonOwner=db.prepare('SELECT owner_user_id FROM workspaces WHERE id=?').get(wid).owner_user_id;
  db.prepare('UPDATE profiles SET published=1 WHERE user_id=?').run(first.id);
  const restoreVisibility=()=>{
    db.prepare('UPDATE performers SET active=1,bookable=1 WHERE id=?').run(first.id);
    db.prepare('UPDATE profiles SET is_demo=0 WHERE user_id=?').run(first.id);
    db.prepare('UPDATE workspaces SET published=1,owner_user_id=? WHERE id=?').run(salonOwner,wid);
  };
  for(const [label,sql,target,publicStatus,ownerStatus] of [
    ['hidden staff','UPDATE performers SET bookable=0 WHERE id=?',first.id,200,200],
    ['inactive staff','UPDATE performers SET active=0 WHERE id=?',first.id,200,404],
    ['hidden salon','UPDATE workspaces SET published=0 WHERE id=?',wid,404,200],
    ['salon without owner','UPDATE workspaces SET owner_user_id=NULL WHERE id=?',wid,404,404],
    ['demo staff','UPDATE profiles SET is_demo=1 WHERE user_id=?',first.id,200,200],
  ]){
    db.prepare(sql).run(target);
    try{
      assert.equal((await guest.call('/inspiration',undefined,'GET')).data.items.some(item=>item.id===work),false,label+' cannot inherit visibility from legacy published=1');
      assert.equal((await guest.call('/works/'+work,undefined,'GET')).status,404,label);
      assert.equal((await owner.call('/works/'+work,undefined,'GET')).status,ownerStatus,label+' private access');
      const publicPage=await guest.call('/public/salons/salon-owner-flow',undefined,'GET');assert.equal(publicPage.status,publicStatus,label);
      if(publicStatus===200)assert.equal(publicPage.data.works.some(item=>item.id===work),false,label);
      assert.equal((await outsider.call('/library',undefined,'GET')).data.works.some(item=>item.id===work),false,label+' is removed from saved public works');
      assert.equal((await outsider.call('/works/'+work+'/save',{})).status,404,label+' cannot be newly saved');
      assert.equal(db.prepare('SELECT COUNT(*) n FROM works WHERE id=?').get(work).n,1,label+' preserves the publication');
    }finally{restoreVisibility();}
  }
  db.prepare('UPDATE profiles SET published=0 WHERE user_id=?').run(first.id);
  assert.ok((await guest.call('/inspiration',undefined,'GET')).data.items.some(item=>item.id===work));
  assert.ok((await outsider.call('/library',undefined,'GET')).data.works.some(item=>item.id===work),'Restoring visibility also restores saved works');
  assert.equal((await owner.call('/performers/'+first.id+'/works',undefined,'GET')).data.filter(w=>w.id===work).length,1);
  const edit=new FormData();edit.set('caption','Новая подпись');edit.set('service_id',first.services[0].id);
  assert.equal((await owner.call(route+'/'+work,edit,'PUT')).status,200);
  assert.equal((await guest.call('/public/salons/salon-owner-flow',undefined,'GET')).data.works.find(p=>p.id===work).caption,'Новая подпись');
  assert.equal((await outsider.call(route+'/'+post,{caption:'Подмена'},'PUT')).status,404);
  const serviceKey=publicData.services.find(s=>s.master_ids.includes(first.id)).id;
  const slots=(await guest.call('/public/salons/salon-owner-flow/availability?service='+serviceKey+'&master='+first.id,undefined,'GET')).data.slots;assert.ok(slots.length);
  const booking={salon_slug:'salon-owner-flow',salon_service_id:serviceKey,master_id:first.id,start:slots[0].start,client_name:'Клиент',contact:'+79991234567',access_key:'b'.repeat(64)};
  const visit=await guest.call('/guest-appointments',booking);assert.equal(visit.status,201,JSON.stringify(visit.data));
  assert.equal((await guest.call('/guest-appointments',{...booking,access_key:'c'.repeat(64)})).status,409);
  db.prepare('UPDATE performers SET user_id=? WHERE id=?').run(employeeId,first.id);
  assert.equal((await employee.call('/salons/'+wid,undefined,'GET')).status,404);
  assert.equal((await employee.call('/performers/'+first.id+'/calendar',undefined,'GET')).status,404);
  assert.equal((await employee.call('/performers/'+first.id+'/works',undefined,'GET')).status,404);
  assert.equal((await employee.call('/performers/'+first.id+'/services',{name:'Подмена',price:1,duration:5})).status,404);
  assert.equal((await employee.call('/me',undefined,'GET')).data.workspaces.some(w=>w.id===wid),false);
  assert.equal((await owner.call('/performers/'+first.id+'/invitations',{})).status,410);
  assert.equal((await owner.call('/performers/'+first.id+'/visibility',{visible:false},'PATCH')).status,200);
  assert.equal(db.prepare('SELECT user_id FROM performers WHERE id=?').get(first.id).user_id,employeeId,'Shared person link is preserved');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments WHERE master_id=?').get(first.id).n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM works WHERE user_id=?').get(first.id).n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  if(process.env.OWNER_FLOW_DATA_DIR){db.prepare('UPDATE performers SET bookable=1 WHERE id=?').run(first.id);fs.writeFileSync('.cache/salon-owner-check.json',JSON.stringify({wid,first:first.id,second:second.id,slug:'salon-owner-flow',work,post},null,2));}
});
