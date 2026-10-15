import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {schedules} from '../lib/schedule.mjs';
import {normalizeSchedulePattern,scheduleDayHours,validScheduleDate} from '../lib/schedule-patterns.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const base={opening:600,closing:1080,utc_offset:420,weekdays:[],mode:'cycle',cycle_start:'2026-10-15',work_days:2,rest_days:2,exceptions:[]};
test('cycles keep local dates across months, before the anchor, and date overrides',()=>{
  for(const [date,working] of [['2026-10-15',true],['2026-10-16',true],['2026-10-17',false],['2026-10-18',false],['2026-10-19',true],['2026-10-14',false],['2026-11-01',true]])assert.equal(Boolean(scheduleDayHours(base,date)),working,date);
  const three={...base,work_days:3,rest_days:3};assert.ok(scheduleDayHours(three,'2026-10-17'));assert.equal(scheduleDayHours(three,'2026-10-18'),null);
  const own={...base,work_days:4,rest_days:1};assert.ok(scheduleDayHours(own,'2026-10-18'));assert.equal(scheduleDayHours(own,'2026-10-19'),null);
  const weekly={...base,mode:'weekly',weekdays:[1,3,5]};assert.equal(scheduleDayHours(weekly,'2026-10-15'),null);assert.ok(scheduleDayHours(weekly,'2026-10-16'));
  const changed={...base,exceptions:[{date:'2026-10-15',working:false},{date:'2026-10-17',working:true,opening:720,closing:900}]};assert.equal(scheduleDayHours(changed,'2026-10-15'),null);assert.deepEqual(scheduleDayHours(changed,'2026-10-17'),{opening:720,closing:900});
  assert.equal(validScheduleDate('2026-02-30'),false);assert.equal(validScheduleDate('2028-02-29'),true);
  for(const patch of [{cycle_start:'2026-02-30'},{work_days:0},{rest_days:32},{exceptions:[{date:'2026-10-15',working:true,opening:900,closing:600}]},{exceptions:[{date:'2026-10-15',working:false},{date:'2026-10-15',working:true}]}])assert.throws(()=>normalizeSchedulePattern({...base,...patch}));
});
test('saved cycles, exceptions, occupied duration, batch and validation share one schedule without deleting visits',()=>{
  const db=new DatabaseSync(':memory:');db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('master');CREATE TABLE profiles(user_id TEXT,city TEXT);INSERT INTO profiles VALUES('master','Новосибирск');CREATE TABLE services(user_id TEXT,duration INTEGER);INSERT INTO services VALUES('master',90);CREATE TABLE appointments(id TEXT,master_id TEXT,start INTEGER,end INTEGER,status TEXT);`);
  const schedule=schedules({db,fail(message,status){throw Object.assign(Error(message),{status})}}),now=Date.UTC(2026,9,14),start=Date.UTC(2026,9,15,3);
  schedule.save('master',base);assert.equal(schedule.config('master').mode,'cycle');assert.equal(schedule.config('master').cycle_start,base.cycle_start);assert.equal(db.prepare('SELECT weekdays FROM master_schedules WHERE master_id=?').get('master').weekdays,'[]','Older code must close availability for an unsupported pattern');
  const options={from:start,to:start+5*86400000,duration:90};
  const slots=schedule.availability('master',now,options);assert.ok(slots.length);assert.ok(!slots.some(s=>['2026-10-17','2026-10-18'].includes(new Date(s.start+420*60000).toISOString().slice(0,10))));
  for(const slot of slots)schedule.validate('master',slot.start,slot.start+90*60000,{now});
  db.prepare('INSERT INTO appointments VALUES(?,?,?,?,?)').run('kept','master',start,start+90*60000,'confirmed');
  const changed={...base,exceptions:[{date:'2026-10-15',working:false},{date:'2026-10-17',working:true,opening:720,closing:810}]};
  schedule.save('master',changed);assert.equal(db.prepare('SELECT COUNT(*) n FROM appointments').get().n,1);assert.throws(()=>schedule.validate('master',start,start+90*60000,{now}),/рабочие часы/);
  const next=schedule.availability('master',now,options);const saturday=next.filter(s=>new Date(s.start+420*60000).toISOString().startsWith('2026-10-17'));assert.equal(saturday.length,1);assert.equal(new Date(saturday[0].start+420*60000).getUTCHours(),12);
  assert.deepEqual(schedule.prepareAvailability(['master'],now,options).availability('master',now,options),next);
  const before=schedule.config('master');assert.throws(()=>schedule.save('master',{...changed,work_days:0}));assert.deepEqual(schedule.config('master'),before);
  schedule.save('master',{opening:600,closing:1080,utc_offset:420,weekdays:[1]});assert.equal(schedule.config('master').mode,'weekly');assert.deepEqual(schedule.config('master').exceptions,[]);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);db.close();
});
test('additive upgrade makes a backup and keeps the five legacy columns and business rows',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'luma-schedule-test-'));assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));
  const db=new DatabaseSync(':memory:');
  try{
    db.exec("PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY);INSERT INTO users VALUES('master');CREATE TABLE master_schedules(master_id TEXT PRIMARY KEY REFERENCES users(id),opening INTEGER,closing INTEGER,utc_offset INTEGER,weekdays TEXT);INSERT INTO master_schedules VALUES('master',600,1080,420,'[1,3,5]');CREATE TABLE profiles(user_id TEXT,city TEXT);CREATE TABLE services(user_id TEXT,duration INTEGER);CREATE TABLE appointments(id TEXT,master_id TEXT,start INTEGER,end INTEGER,status TEXT);INSERT INTO appointments VALUES('existing','master',1,2,'confirmed');");
    const before=db.prepare('SELECT * FROM master_schedules').all(),schedule=schedules({db,backupDir:directory,fail(message){throw Error(message)}});
    assert.deepEqual(db.prepare('SELECT * FROM master_schedules').all(),before);assert.equal(db.prepare('PRAGMA table_info(master_schedules)').all().length,5);assert.equal(db.prepare('SELECT id FROM appointments').get().id,'existing');assert.equal(schedule.config('master').mode,'weekly');
    const backups=fs.readdirSync(directory);assert.equal(backups.length,1);const copy=new DatabaseSync(path.join(directory,backups[0]));try{assert.deepEqual(copy.prepare('SELECT * FROM master_schedules').all(),before);assert.equal(copy.prepare("SELECT 1 FROM sqlite_master WHERE name='schedule_patterns'").get(),undefined)}finally{copy.close()}
    schedules({db,backupDir:directory,fail(message){throw Error(message)}});assert.equal(fs.readdirSync(directory).length,1);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
  }finally{db.close();for(const name of fs.readdirSync(directory))fs.unlinkSync(path.join(directory,name));fs.rmdirSync(directory)}
});
