import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Separate relation preserves existing service IDs, booking snapshots and INSERT compatibility.
export function migrateServiceDirections(db,{backupDir}={}) {
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('service-directions-v1'))return;
  if(backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const file=path.join(backupDir,'before-service-directions-'+Date.now()+'-'+randomUUID()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE service_directions(service_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,category TEXT NOT NULL);
      CREATE INDEX service_directions_category ON service_directions(category,service_id);
      INSERT INTO service_directions(service_id,category)
        SELECT s.id,MIN(pc.category) FROM services s JOIN profile_categories pc ON pc.user_id=s.user_id GROUP BY s.id HAVING COUNT(*)=1;`);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('service-directions-v1',Date.now());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}

export function serviceCategorySQL(db,alias='s') {
  if(!/^[a-z_]+$/i.test(alias))throw new Error('Invalid SQL alias');
  const single=`(SELECT CASE WHEN COUNT(*)=1 THEN MIN(pc.category) ELSE '' END FROM profile_categories pc WHERE pc.user_id=${alias}.user_id)`;
  // Old fixtures and pre-migration readers can still derive an unambiguous direction.
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='service_directions'").get())return single;
  return `CASE WHEN EXISTS(SELECT 1 FROM service_directions sd WHERE sd.service_id=${alias}.id AND sd.category<>'')
    THEN COALESCE((SELECT sd.category FROM service_directions sd WHERE sd.service_id=${alias}.id
      AND EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.user_id=${alias}.user_id AND pc.category=sd.category)),'') ELSE ${single} END`;
}

export function servicesWithDirections(db,userId) {
  return db.prepare(`SELECT s.*,${serviceCategorySQL(db)} category FROM services s WHERE s.user_id=? ORDER BY s.rowid`).all(userId);
}

export function checkedServiceDirection(db,userId,value,fail) {
  const categories=db.prepare('SELECT category FROM profile_categories WHERE user_id=? ORDER BY rowid').all(userId).map(row=>row.category);
  if(value===undefined)return categories.length===1?categories[0]:'';
  if(typeof value!=='string'||value.length>80||value!==value.trim()||(value&&!categories.includes(value)))fail('Выберите направление из направлений мастера');
  return value;
}

export function saveServiceDirection(db,id,category) {
  db.prepare(`INSERT INTO service_directions(service_id,category) VALUES(?,?) ON CONFLICT(service_id) DO UPDATE SET category=excluded.category`).run(id,category);
}
