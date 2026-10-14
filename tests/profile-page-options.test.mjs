import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {migratePageOptions,pageOptions} from '../lib/profile-page-options.mjs';

test('page migration preserves old salon teaching, images, user follows and is repeatable',()=>{
  const db=new DatabaseSync(':memory:');
  try{
    db.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE schema_migrations(name TEXT PRIMARY KEY,created INTEGER);
      CREATE TABLE users(id TEXT PRIMARY KEY);
      CREATE TABLE profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),teaches INTEGER,is_demo INTEGER,avatar TEXT,theme TEXT);
      CREATE TABLE workspaces(id TEXT PRIMARY KEY,kind TEXT,logo TEXT,cover TEXT);
      CREATE TABLE performers(id TEXT,workspace_id TEXT,active INTEGER,bookable INTEGER);
      INSERT INTO users VALUES('staff'),('client');
      INSERT INTO profiles VALUES('staff',1,0,'portrait.webp','wine');
      INSERT INTO workspaces VALUES('salon','salon','logo.webp','cover.webp'),('hidden','salon','','');
      INSERT INTO performers VALUES('staff','salon',1,1);`);
    const before=db.prepare('SELECT * FROM profiles').all();
    const backupDir=path.resolve('.cache/profile-options-backup-test-'+Date.now());
    migratePageOptions(db,{backupDir});migratePageOptions(db,{backupDir});
    assert.equal(fs.readdirSync(backupDir).length,1,'Only the first migration creates a backup');
    const backup=new DatabaseSync(path.join(backupDir,fs.readdirSync(backupDir)[0]),{readOnly:true});
    try{assert.deepEqual(backup.prepare('SELECT * FROM profiles').all(),before);assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.equal(backup.prepare('PRAGMA table_info(profiles)').all().some(c=>c.name==='looking_models'),false);}finally{backup.close()}
    const after=db.prepare('SELECT * FROM profiles').all();
    assert.deepEqual(after.map(({looking_models,...old})=>old),before.map(row=>({...row})));
    assert.equal(after[0].looking_models,0);
    const w=db.prepare('SELECT * FROM workspaces WHERE id=?').get('salon');
    assert.equal(w.teaches,1);assert.equal(w.theme,'green');assert.equal(w.logo,'logo.webp');assert.equal(w.cover,'cover.webp');
    assert.equal(db.prepare('SELECT teaches FROM workspaces WHERE id=?').get('hidden').teaches,0);
    db.prepare('INSERT INTO saved_salons VALUES(?,?,?)').run('client','salon',1);
    assert.throws(()=>db.prepare('INSERT INTO saved_salons VALUES(?,?,?)').run('client','missing',1));
    db.prepare('DELETE FROM workspaces WHERE id=?').run('salon');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_salons').get().n,0);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  }finally{db.close()}
});

test('omitted page options preserve saved settings and invalid checkboxes cannot become true',()=>{
  const fail=message=>{throw Error(message)};
  assert.deepEqual(pageOptions({}, {theme:'wine',teaches:1,looking_models:1}, fail),{theme:'wine',teaches:1,looking_models:1});
  assert.deepEqual(pageOptions({teaches:false,looking_models:false,theme:'cream'}, {teaches:1,looking_models:1}, fail),{theme:'cream',teaches:0,looking_models:0});
  for(const value of ['false',1,null,{}])assert.throws(()=>pageOptions({looking_models:value},{},fail));
  assert.throws(()=>pageOptions({theme:'other'},{},fail));
});
