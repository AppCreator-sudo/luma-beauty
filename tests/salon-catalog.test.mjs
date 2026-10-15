import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';import {spawn} from 'node:child_process';import sharp from 'sharp';
import {migrateSalonServiceCatalog,salonServiceCatalog} from '../lib/salon-service-catalog.mjs';
import {servicesWithDirections} from '../lib/service-directions.mjs';

function fixture(t){const folder=fs.mkdtempSync(path.join(os.tmpdir(),'luma-catalog-')),db=new DatabaseSync(path.join(folder,'source.sqlite'));db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,created INTEGER);CREATE TABLE workspaces(id TEXT PRIMARY KEY,kind TEXT);CREATE TABLE performers(id TEXT PRIMARY KEY,workspace_id TEXT REFERENCES workspaces(id),active INTEGER,bookable INTEGER,name TEXT,created INTEGER);CREATE TABLE profiles(user_id TEXT PRIMARY KEY,name TEXT,category TEXT);CREATE TABLE profile_categories(user_id TEXT,category TEXT,PRIMARY KEY(user_id,category));CREATE TABLE services(id TEXT PRIMARY KEY,user_id TEXT REFERENCES performers(id),name TEXT,price INTEGER,duration INTEGER);CREATE TABLE service_directions(service_id TEXT PRIMARY KEY REFERENCES services(id),category TEXT);CREATE TABLE works(id TEXT PRIMARY KEY,service_id TEXT REFERENCES services(id));CREATE TABLE appointments(id TEXT PRIMARY KEY,service TEXT,price INTEGER);
 INSERT INTO workspaces VALUES('salon','salon'),('solo','solo');INSERT INTO performers VALUES('a','salon',1,1,'Алина',1),('b','salon',1,1,'София',2),('c','salon',1,1,'Виктория',3),('s','solo',1,1,'Соло',4);INSERT INTO profiles VALUES('a','Алина','Маникюр'),('b','София','Маникюр'),('c','Виктория','Брови'),('s','Соло','Брови');INSERT INTO profile_categories VALUES('a','Маникюр'),('a','Брови'),('b','Маникюр'),('c','Брови'),('s','Брови');INSERT INTO services VALUES('a1','a','Маникюр',1000,30),('b1','b','Маникюр',1000,30),('c1','c','Брови',1500,60),('s1','s','Брови',1700,30);INSERT INTO service_directions VALUES('a1','Маникюр'),('b1','Маникюр'),('c1','Брови'),('s1','Брови');INSERT INTO works VALUES('work','a1');INSERT INTO appointments VALUES('visit','Маникюр',900);`);
 t.after(()=>{db.close();assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'luma-catalog-'));fs.rmSync(folder,{recursive:true,force:true})});
 const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};return {db,folder,manager:()=>salonServiceCatalog({db,fail,categories:['Маникюр','Брови']})};}

test('catalogue upgrade is additive, preserves IDs/conditions/history, exact groups and one private backup',t=>{
 const {db,folder}=fixture(t),before={};for(const table of ['profiles','profile_categories','services','service_directions','works','appointments'])before[table]=db.prepare('SELECT * FROM '+table).all();
 const backupDir=path.join(folder,'backups'),report=migrateSalonServiceCatalog(db,{backupDir});assert.equal(report.services,3);assert.equal(report.definitions,2);assert.equal(db.prepare('SELECT COUNT(*) n FROM salon_service_assignments').get().n,3);
 for(const [table,rows] of Object.entries(before))assert.deepEqual(db.prepare('SELECT * FROM '+table).all(),rows,table);
 assert.equal(db.prepare('SELECT COUNT(*) n FROM salon_service_preserved_directions WHERE performer_id=?').get('a').n,1);assert.equal(db.prepare('PRAGMA table_info(services)').all().length,5);
 const files=fs.readdirSync(backupDir);assert.equal(files.filter(f=>f.endsWith('.sqlite')).length,1);assert.equal(files.filter(f=>f.endsWith('.json')).length,1);migrateSalonServiceCatalog(db,{backupDir});assert.deepEqual(fs.readdirSync(backupDir),files);
 const old=new DatabaseSync(path.join(backupDir,files.find(f=>f.endsWith('.sqlite'))),{readOnly:true});assert.equal(old.prepare("SELECT 1 FROM sqlite_master WHERE name='salon_service_catalog'").get(),undefined);old.close();assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('shared edits preserve overrides, stale revisions are rejected, detach keeps historical rows and reuses offer IDs',t=>{
 const {db,manager}=fixture(t);migrateSalonServiceCatalog(db);const catalog=manager(),base=catalog.list('salon').find(s=>s.name==='Маникюр');
 let saved=catalog.save('salon',{name:'Маникюр',category:'Маникюр',price:1200,duration:45,revision:base.revision,assignments:[{performer_id:'a'},{performer_id:'b',price_override:1800,duration_override:90}]},base.id);
 assert.equal(saved.assignments.find(a=>a.performer_id==='a').service_id,'a1');assert.equal(db.prepare("SELECT price FROM services WHERE id='a1'").get().price,1200);assert.equal(db.prepare("SELECT price FROM services WHERE id='b1'").get().price,1800);
 assert.throws(()=>catalog.save('salon',{...saved,revision:base.revision,assignments:[]},base.id),e=>e.status===409);
 saved=catalog.save('salon',{...saved,price:1300,assignments:[{performer_id:'b',price_override:1800,duration_override:90}]},base.id);assert.equal(servicesWithDirections(db,'a').length,0);assert.equal(db.prepare("SELECT service_id FROM works WHERE id='work'").get().service_id,'a1');assert.equal(db.prepare("SELECT price FROM appointments WHERE id='visit'").get().price,900);assert.equal(db.prepare("SELECT bookable FROM performers WHERE id='a'").get().bookable,0);
 saved=catalog.save('salon',{...saved,assignments:[{performer_id:'a'},{performer_id:'b',price_override:1800,duration_override:90}]},base.id);assert.equal(saved.assignments.find(a=>a.performer_id==='a').service_id,'a1');assert.equal(db.prepare("SELECT COUNT(*) n FROM services WHERE user_id='a'").get().n,1);assert.equal(db.prepare("SELECT price FROM services WHERE id='a1'").get().price,1300);assert.equal(db.prepare("SELECT price FROM services WHERE id='b1'").get().price,1800);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('different legacy prices, missing direction and duplicate offers stay distinct for owner review',t=>{
 const {db}=fixture(t);db.exec("INSERT INTO services VALUES('a2','a','Маникюр',1000,30),('b2','b','Маникюр',1300,45),('c2','c','Неопределено',2000,30);INSERT INTO service_directions VALUES('a2','Маникюр'),('b2','Маникюр'),('c2','');");const original=db.prepare('SELECT * FROM services').all();const result=migrateSalonServiceCatalog(db);assert.ok(result.needs_review>=3);assert.deepEqual(db.prepare('SELECT * FROM services').all(),original);assert.equal(db.prepare('SELECT COUNT(*) n FROM salon_service_assignments').get().n,6);
});

test('failed shared edits roll back every offer; archived assignments are retained and foreign performers rejected',t=>{
 const {db,manager}=fixture(t);migrateSalonServiceCatalog(db);const catalog=manager(),base=catalog.list('salon').find(s=>s.name==='Маникюр');
 const before=db.prepare('SELECT * FROM services ORDER BY id').all();
 db.exec("CREATE TRIGGER fail_second_offer BEFORE UPDATE ON services WHEN OLD.id='b1' BEGIN SELECT RAISE(ABORT,'test failure'); END");
 assert.throws(()=>catalog.save('salon',{...base,price:2500,assignments:[{performer_id:'a'},{performer_id:'b'}]},base.id),/test failure/);
 assert.deepEqual(db.prepare('SELECT * FROM services ORDER BY id').all(),before);assert.equal(catalog.list('salon').find(s=>s.id===base.id).revision,base.revision);
 db.exec('DROP TRIGGER fail_second_offer');
 assert.throws(()=>catalog.save('salon',{...base,assignments:[{performer_id:'s'}]},base.id),e=>e.status===404);
 db.exec("UPDATE performers SET active=0 WHERE id='b'");
 const saved=catalog.save('salon',{...base,price:1200,assignments:[{performer_id:'a'},{performer_id:'b'}]},base.id);
 assert.equal(saved.assignments.find(a=>a.performer_id==='b').active,true);assert.equal(saved.assignments.find(a=>a.performer_id==='b').performer_active,false);
 assert.throws(()=>catalog.save('salon',{name:'Новая',category:'Брови',price:100,duration:30,assignments:[{performer_id:'b'}]}),e=>e.status===404);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('owner API isolates salons, public availability uses actual duration and quoted conditions cannot silently change',async t=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'luma-catalog-http-')),port='3281',origin='http://localhost:'+port;let db;
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,DATA_DIR:folder,NODE_ENV:'test',PORT:port,APP_ORIGIN:origin,DADATA_API_KEY:'',DADATA_SECRET_KEY:'',PROMOTIONS_ENABLED:'0'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);t.after(async()=>{db?.close();child.kill();if(child.exitCode===null)await new Promise(r=>child.once('exit',r));assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir())+path.sep+'luma-catalog-http-'));fs.rmSync(folder,{recursive:true,force:true})});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,100))}assert.ok(ready,logs);
 const client=()=>({cookie:'',async call(route,body,method=body===undefined?'GET':'POST'){const form=body instanceof FormData,res=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,Cookie:this.cookie,...(!form?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:form?body:JSON.stringify(body)});if(res.headers.get('set-cookie'))this.cookie=res.headers.get('set-cookie').split(';')[0];return {status:res.status,data:await res.json()}}});const owner=client(),stranger=client(),guest=client();
 for(const [c,login] of [[owner,'catalog-owner'],[stranger,'catalog-stranger']])assert.equal((await c.call('/auth/register',{login,password:'CatalogPassword123',account_type:'salon'})).status,201);
 const wid=(await owner.call('/salons',{name:'Тестовый салон',city:'Москва'})).data.id,photo=await sharp({create:{width:300,height:400,channels:3,background:'#c3a477'}}).jpeg().toBuffer(),people=[];
 for(const name of ['Алина','София']){const form=new FormData();form.set('name',name);form.set('draft','true');form.set('catalog_service_ids','[]');form.set('schedule',JSON.stringify({opening:0,closing:1440,utc_offset:180,weekdays:[0,1,2,3,4,5,6]}));form.set('image',new Blob([photo],{type:'image/jpeg'}),'photo.jpg');const result=await owner.call('/salons/'+wid+'/staff',form);assert.equal(result.status,201,JSON.stringify(result.data));people.push(result.data.id)}
 let result=await owner.call('/salons/'+wid+'/service-catalog',{name:'Общая услуга',category:'Маникюр',price:1000,duration:30,assignments:[{performer_id:people[0]},{performer_id:people[1],price_override:1500,duration_override:90}]});assert.equal(result.status,201,JSON.stringify(result.data));let service=result.data;
 assert.equal((await stranger.call('/salons/'+wid+'/service-catalog')).status,404);assert.equal((await stranger.call('/salons/'+wid+'/service-catalog/'+service.id,{...service,assignments:[]},'PUT')).status,404);
 for(const id of people)assert.equal((await owner.call('/performers/'+id+'/visibility',{visible:true},'PATCH')).status,200);
 db=new DatabaseSync(path.join(folder,'atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON');db.prepare("UPDATE workspaces SET slug='catalog-test',published=1,address='ул Тестовая, д 1',latitude=55.75,longitude=37.61,utc_offset=180 WHERE id=?").run(wid);
 const now=new Date(Date.now()+86400000+180*60000),day=now.toISOString().slice(0,10),start=Date.parse(day+'T10:00:00Z')-180*60000;
 db.prepare("INSERT INTO appointments(id,master_id,client_name,service,start,end,price,status) VALUES('busy',?,'Тест','Занято',?,?,100,'confirmed')").run(people[1],start+60*60000,start+90*60000);
 const publicData=(await guest.call('/public/salons/catalog-test')).data;assert.equal(publicData.services.length,1);const publicService=publicData.services[0];assert.equal(publicService.id,service.public_id);assert.equal(publicService.offers.length,2);
 const slots=(await guest.call('/public/salons/catalog-test/availability?service='+encodeURIComponent(publicService.id))).data.slots,slot=slots.find(s=>s.start===start);assert.ok(slot);assert.deepEqual(slot.master_ids,[people[0]],'90-minute performer must not be offered across a later busy interval');
 const quote=slots.find(s=>s.start===start+120*60000).offers.find(o=>o.master_id===people[1]);assert.ok(quote);const booking=await guest.call('/guest-appointments',{salon_slug:'catalog-test',salon_service_id:publicService.id,master_id:people[1],start:start+120*60000,offer_service_id:quote.service_id,expected_price:quote.price,expected_duration:quote.duration,client_name:'Клиент',contact:'@catalog_client',access_key:'1'.repeat(64)});assert.equal(booking.status,201,JSON.stringify(booking.data));const visit=db.prepare('SELECT * FROM appointments WHERE id=?').get(booking.data.id);assert.equal(visit.price,1500);assert.equal(visit.end-visit.start,90*60000);
 const updated=await owner.call('/salons/'+wid+'/service-catalog/'+service.id,{...service,price:1100,assignments:[{performer_id:people[0]},{performer_id:people[1],price_override:1500,duration_override:90}]},'PUT');assert.equal(updated.status,200);service=updated.data;
 const stale=await guest.call('/guest-appointments',{salon_slug:'catalog-test',salon_service_id:publicService.id,master_id:people[0],start:start+180*60000,offer_service_id:service.assignments.find(a=>a.performer_id===people[0]).service_id,expected_price:1000,expected_duration:30,client_name:'Клиент',contact:'@catalog_client_two',access_key:'2'.repeat(64)});assert.equal(stale.status,409);assert.match(stale.data.error,/Цена|длительность/);
 assert.equal(db.prepare('SELECT price FROM appointments WHERE id=?').get(visit.id).price,1500);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
