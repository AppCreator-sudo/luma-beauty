// Read-only source, isolated VACUUM copy; report contains only counts and checks.
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {migrateSalonServiceCatalog} from '../lib/salon-service-catalog.mjs';
const source=process.argv[2];if(!source)throw Error('Usage: node scripts/verify-salon-catalog-migration.mjs <pre-catalog.sqlite> [report.json]');
const folder=path.resolve('.cache/salon-catalog-migration-'+Date.now());assert.ok(folder.startsWith(path.resolve('.cache')+path.sep));fs.mkdirSync(folder,{recursive:true,mode:0o700});
const original=new DatabaseSync(path.resolve(source),{readOnly:true}),file=path.join(folder,'copy.sqlite');original.prepare('VACUUM INTO ?').run(file);original.close();fs.chmodSync(file,0o600);
const db=new DatabaseSync(file);db.exec('PRAGMA foreign_keys=ON');
const quote=name=>'"'+name.replaceAll('"','""')+'"';
function snapshot(){return Object.fromEntries(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name<>'schema_migrations' ORDER BY name").all().map(({name})=>{const rows=db.prepare('SELECT * FROM '+quote(name)).all().map(row=>JSON.stringify(row)).sort();return [name,{rows:rows.length,hash:createHash('sha256').update(JSON.stringify(rows)).digest('hex')}]}))}
try{
 assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='salon_service_catalog'").get(),undefined,'Source must precede catalogue migration');
 const before=snapshot(),beforeMarkers=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all(),backupDir=path.join(folder,'backups'),migration=migrateSalonServiceCatalog(db,{backupDir}),after=snapshot();
 for(const [name,table] of Object.entries(before))assert.deepEqual(after[name],table,'Business rows changed: '+name);
 assert.deepEqual(db.prepare("SELECT * FROM schema_migrations WHERE name<>'salon-service-catalog-v1' ORDER BY name").all(),beforeMarkers);
 const migrated=snapshot(),markers=db.prepare('SELECT * FROM schema_migrations ORDER BY name').all();migrateSalonServiceCatalog(db,{backupDir});assert.deepEqual(snapshot(),migrated);assert.deepEqual(db.prepare('SELECT * FROM schema_migrations ORDER BY name').all(),markers);
 assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 const backupFiles=fs.readdirSync(backupDir).filter(f=>f.endsWith('.sqlite'));assert.equal(backupFiles.length,1);const backup=new DatabaseSync(path.join(backupDir,backupFiles[0]),{readOnly:true});assert.equal(backup.prepare("SELECT 1 FROM sqlite_master WHERE name='salon_service_catalog'").get(),undefined);backup.close();
 const report={at:new Date().toISOString(),scope:'Read-only source and isolated local copy; source and uploads untouched',preserved_tables:Object.keys(before).length,preserved_rows:Object.values(before).reduce((n,t)=>n+t.rows,0),migration,integrity:'ok',foreign_keys:'ok',repeat:'idempotent',backup:'one closed pre-migration SQLite',existing_rows:'identical'};
 if(process.argv[3]){fs.mkdirSync(path.dirname(process.argv[3]),{recursive:true});fs.writeFileSync(process.argv[3],JSON.stringify(report,null,2)+'\n')}
 console.log(JSON.stringify(report));
}finally{db.close()}
