import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {migrateServiceDirections,servicesWithDirections,checkedServiceDirection,saveServiceDirection} from '../lib/service-directions.mjs';
import {mapFixture} from '../scripts/benchmark-map.mjs';
import {mapViewport} from '../lib/map-viewport.mjs';
import {salonServiceKey} from '../lib/salon-service-key.mjs';

const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})};

test('directions migration backs up, preserves service IDs, assigns only unambiguous directions and is idempotent',()=>{
  const db=new DatabaseSync(':memory:'),backupDir=fs.mkdtempSync(path.join(os.tmpdir(),'luma-service-directions-'));
  try{
    db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,created INTEGER);
      CREATE TABLE services(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,price INTEGER,duration INTEGER);
      CREATE TABLE profile_categories(user_id TEXT,category TEXT,PRIMARY KEY(user_id,category));
      INSERT INTO services VALUES('one','single','Коррекция',1500,60),('two','multi','Снятие',500,30),('three','empty','Без направления',0,15);
      INSERT INTO profile_categories VALUES('single','Маникюр'),('multi','Маникюр'),('multi','Макияж');`);
    const original=db.prepare('SELECT * FROM services ORDER BY id').all();
    migrateServiceDirections(db,{backupDir});migrateServiceDirections(db,{backupDir});
    assert.equal(fs.readdirSync(backupDir).length,1);
    const backup=new DatabaseSync(path.join(backupDir,fs.readdirSync(backupDir)[0]),{readOnly:true});
    assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='service_directions'").get(),undefined);backup.close();
    assert.deepEqual(db.prepare('SELECT * FROM services ORDER BY id').all(),original);
    assert.equal(servicesWithDirections(db,'single')[0].category,'Маникюр');
    assert.equal(servicesWithDirections(db,'multi')[0].category,'');
    assert.equal(servicesWithDirections(db,'empty')[0].category,'');
    saveServiceDirection(db,'two','Макияж');assert.equal(servicesWithDirections(db,'multi')[0].category,'Макияж');
    // Removing a profile direction never silently reclassifies its service.
    db.prepare("DELETE FROM profile_categories WHERE user_id='multi' AND category='Макияж'").run();
    assert.equal(servicesWithDirections(db,'multi')[0].category,'');
    db.prepare("DELETE FROM services WHERE id='two'").run();
    assert.equal(db.prepare("SELECT 1 FROM service_directions WHERE service_id='two'").get(),undefined);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close();fs.rmSync(backupDir,{recursive:true,force:true})}
});

test('direction validation accepts only the service owner directions and retains compatibility with old creates',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("CREATE TABLE profile_categories(user_id TEXT,category TEXT);INSERT INTO profile_categories VALUES('one','Маникюр'),('two','Маникюр'),('two','Макияж')");
    assert.equal(checkedServiceDirection(db,'one',undefined,fail),'Маникюр');
    assert.equal(checkedServiceDirection(db,'two',undefined,fail),'');
    assert.equal(checkedServiceDirection(db,'two','Макияж',fail),'Макияж');
    for(const value of ['Брови',[],null,{},' Маникюр'])assert.throws(()=>checkedServiceDirection(db,'one',value,fail));
  }finally{db.close()}
});

test('map service choices and hour filter use service direction, full duration and stable salon booking IDs',()=>{
  const fixture=mapFixture(),{db,master}=fixture,now=Date.UTC(2026,9,15,2);
  try{
    db.exec(`CREATE TABLE services(id TEXT PRIMARY KEY,user_id TEXT,name TEXT,price INTEGER,duration INTEGER);
      CREATE TABLE works(id TEXT PRIMARY KEY,user_id TEXT,image TEXT,pinned INTEGER,position INTEGER,created INTEGER);
      ALTER TABLE workspaces ADD COLUMN utc_offset INTEGER DEFAULT 420;`);
    master('person');db.exec("INSERT INTO profile_categories VALUES('person','Макияж');INSERT INTO services VALUES('nails','person','Коррекция',2000,90),('face','person','Коррекция',1000,15),('unknown','person','Не размечено',500,10)");
    migrateServiceDirections(db);saveServiceDirection(db,'nails','Маникюр');saveServiceDirection(db,'face','Макияж');
    const schedule={config:()=>({utc_offset:420}),availability:(_id,_now,{duration})=>[{start:now+(duration>=90?90:30)*60000,end:now+(duration>=90?90:30)*60000+duration*60000}]};
    const map=mapViewport({...fixture,schedule,now:()=>now});
    let details=map.details({kind:'master',id:'person',category:'Маникюр'});
    assert.deepEqual(details.services.map(service=>service.id),['nails']);assert.equal(details.selected_service,'nails');assert.equal(details.availability.service.duration,90);
    assert.equal(map.read({soon:'true',category:'Маникюр'}).total,0,'An unrelated short service cannot make nails fit the hour filter');
    assert.equal(map.read({soon:'true',category:'Макияж'}).total,1);
    details=map.details({kind:'master',id:'person',category:'Маникюр',soon:'true'});assert.equal(details.availability,null);assert.equal(details.services.length,1);
    assert.equal(map.details({kind:'master',id:'person',service:'face'}).availability.service.id,'face');
    assert.throws(()=>map.details({kind:'master',id:'person',category:'Маникюр',service:'face'}),error=>error.status===409);
    assert.equal(map.details({kind:'master',id:'person'}).services.length,3,'Unmapped old offers remain under all services');
    db.exec("INSERT INTO workspaces(id,kind,owner_user_id,name,city,slug,address,latitude,longitude,published) VALUES('salon','salon','owner','Салон','Москва','salon','ул Тестовая, д 2',55,82.9,1);UPDATE performers SET workspace_id='salon',bookable=1 WHERE id='person';UPDATE profiles SET published=0 WHERE user_id='person'");
    details=map.details({kind:'salon',id:'salon',category:'Маникюр'});
    const key=salonServiceKey({name:'Коррекция',price:2000,duration:90});
    assert.equal(details.selected_service,key);assert.equal(details.availability.service.id,key);assert.equal(details.availability.performer.id,'person');assert.deepEqual(details.services[0].master_ids,['person']);
    db.exec("DELETE FROM services WHERE id='nails'");assert.throws(()=>map.details({kind:'salon',id:'salon',service:key}),error=>error.status===409);
  }finally{db.close()}
});
