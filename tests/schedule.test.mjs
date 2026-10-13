import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {schedules,relatedPerformersBatch} from '../lib/schedule.mjs';

test('calendar is free by default, reservations occupy it and cancellation releases it',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('master');
    CREATE TABLE profiles(user_id TEXT,city TEXT); INSERT INTO profiles VALUES('master','Новосибирск');
    CREATE TABLE services(user_id TEXT,duration INTEGER); INSERT INTO services VALUES('master',90);
    CREATE TABLE appointments(id TEXT,master_id TEXT,start INTEGER,end INTEGER,status TEXT);`);
  const schedule=schedules({db,fail(message,status){throw Object.assign(new Error(message),{status})}});
  const now=Date.UTC(2026,8,24,2),start=Date.UTC(2026,8,24,3),end=start+90*60000;
  assert.equal(schedule.config('master').utc_offset,420);
  assert.equal(schedule.availability('master',now)[0].start,start);
  assert.equal(schedule.availability('master',now,{from:start,to:start+86400000,duration:90})[0].start,start);
  assert.equal(schedule.availability('master',now,{from:start+30*60000,to:start+86400000,duration:90})[0].start,start+30*60000);
  assert.equal(schedule.availability('master',now,{from:start,to:start+30*60000,duration:90}).length,1);
  schedule.validate('master',start,end,{now});
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?)').run('booking','master',start,end,'pending');
  assert.throws(()=>schedule.validate('master',start,end,{now}),/занято/);
  assert.equal(schedule.availability('master',now)[0].start,end);
  db.exec("UPDATE appointments SET status='cancelled'");
  assert.equal(schedule.availability('master',now)[0].start,start);
  assert.throws(()=>schedule.validate('master',Date.UTC(2026,8,24,12),Date.UTC(2026,8,24,14),{now}),/рабочие часы/);
  schedule.save('master',{opening:660,closing:1080,utc_offset:420,weekdays:[1,2,3,4,5]});
  assert.equal(schedule.availability('master',now)[0].start,start+3600000);
  assert.ok(schedule.availability('master',now).every(s=>![0,6].includes(new Date(s.start+420*60000).getUTCDay())));
  assert.throws(()=>schedule.save('master',{opening:1200,closing:600,utc_offset:420,weekdays:[1]}));
  db.close();
});

test('request-local batch matches booking availability across shared calendars, durations, timezones and fresh writes',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY); INSERT INTO users VALUES('master'),('staff'),('other');
    CREATE TABLE profiles(user_id TEXT,city TEXT); INSERT INTO profiles VALUES('master','Новосибирск'),('staff','Москва'),('other','Омск');
    CREATE TABLE performers(id TEXT,user_id TEXT,active INTEGER); INSERT INTO performers VALUES('master','account',1),('staff','account',0),('other',NULL,1);
    CREATE TABLE services(user_id TEXT,duration INTEGER); INSERT INTO services VALUES('master',30),('staff',90),('other',120);
    CREATE TABLE appointments(id TEXT,master_id TEXT,start INTEGER,end INTEGER,status TEXT);`);
  const related=id=>relatedPerformersBatch(db,[id]).get(id);
  const schedule=schedules({db,fail(message){throw Error(message)},relatedMasters:related,relatedMasterGroups:ids=>relatedPerformersBatch(db,ids)});
  const now=Date.UTC(2026,9,3,2,10),to=now+3*86400000;
  schedule.save('staff',{opening:570,closing:1260,utc_offset:180,weekdays:[0,1,2,3,4,5,6]});
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?)').run('linked','staff',now+70*60000,now+130*60000,'confirmed');
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?)').run('cancelled','other',now,now+86400000,'cancelled');
  assert.deepEqual(new Set(related('master')),new Set(['master','staff']),'Inactive linked calendars still occupy shared person');
  db.exec('BEGIN');
  const batch=schedule.prepareAvailability(['master','staff','other'],now,{from:now,to});
  for(const master of ['master','staff','other'])for(const duration of [30,90,120,720]){
    const options={from:now,to,duration};
    assert.deepEqual(batch.config(master),schedule.config(master));
    assert.deepEqual(batch.availability(master,now,options),schedule.availability(master,now,options),master+':'+duration);
  }
  db.exec('COMMIT');
  const first=schedule.availability('master',now,{from:now,to,duration:30})[0];
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?)').run('fresh','staff',first.start,first.start+30*60000,'pending');
  const fresh=schedule.prepareAvailability(['master'],now,{from:now,to});
  assert.deepEqual(fresh.availability('master',now,{duration:30}),schedule.availability('master',now,{from:now,to,duration:30}));
  assert.ok(!fresh.availability('master',now,{duration:30}).some(slot=>slot.start===first.start),'A new request sees fresh shared bookings without cache invalidation');
  db.close();
});
