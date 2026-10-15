import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {serviceCategorySQL,saveServiceDirection} from './service-directions.mjs';
import {salonServiceKey} from './salon-service-key.mjs';
import {activeServiceSQL} from './service-offers.mjs';

export const salonCatalogKey=id=>'salon-service:'+id;
const migration='salon-service-catalog-v1';
export function migrateSalonServiceCatalog(db,{backupDir}={}){
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get(migration))return;
  let reportFile;
  if(backupDir){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const stamp=Date.now()+'-'+randomUUID();const file=path.join(backupDir,'before-salon-service-catalog-'+stamp+'.sqlite');db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);reportFile=path.join(backupDir,'salon-service-catalog-import-'+stamp+'.json')}
  const report={migration,created_at:Date.now(),services:0,definitions:0,needs_review:0};
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE salon_service_catalog(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,name TEXT NOT NULL,category TEXT NOT NULL DEFAULT '',price INTEGER NOT NULL CHECK(price BETWEEN 0 AND 1000000),duration INTEGER NOT NULL CHECK(duration BETWEEN 5 AND 720),active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),revision INTEGER NOT NULL DEFAULT 1,needs_review INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
      CREATE INDEX salon_service_catalog_workspace ON salon_service_catalog(workspace_id,active);
      CREATE TABLE salon_service_assignments(service_id TEXT PRIMARY KEY REFERENCES services(id) ON DELETE CASCADE,catalog_id TEXT NOT NULL REFERENCES salon_service_catalog(id) ON DELETE CASCADE,performer_id TEXT NOT NULL REFERENCES performers(id) ON DELETE CASCADE,active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),price_override INTEGER CHECK(price_override BETWEEN 0 AND 1000000),duration_override INTEGER CHECK(duration_override BETWEEN 5 AND 720),UNIQUE(catalog_id,performer_id));
      CREATE INDEX salon_service_assignment_performer ON salon_service_assignments(performer_id,active);
      CREATE TABLE salon_service_aliases(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,alias TEXT NOT NULL,service_id TEXT NOT NULL REFERENCES services(id) ON DELETE CASCADE,PRIMARY KEY(workspace_id,alias,service_id));
      CREATE TABLE salon_service_preserved_directions(performer_id TEXT NOT NULL REFERENCES performers(id) ON DELETE CASCADE,category TEXT NOT NULL,PRIMARY KEY(performer_id,category));`);
    const groups=new Map();
    const rows=db.prepare(`SELECT s.*,p.workspace_id,${serviceCategorySQL(db)} category FROM services s JOIN performers p ON p.id=s.user_id JOIN workspaces w ON w.id=p.workspace_id WHERE w.kind='salon' ORDER BY w.id,s.rowid`).all();
    for(const row of rows){
      const key=JSON.stringify([row.workspace_id,row.name,row.category,row.price,row.duration]);let group=groups.get(key);
      const duplicate=Boolean(group?.people.has(row.user_id));
      if(!group||duplicate){group={id:randomUUID(),people:new Set()};db.prepare('INSERT INTO salon_service_catalog(id,workspace_id,name,category,price,duration,needs_review,created) VALUES(?,?,?,?,?,?,?,?)').run(group.id,row.workspace_id,row.name,row.category,row.price,row.duration,Number(!row.category||duplicate),Date.now());report.definitions++;if(!row.category||duplicate)report.needs_review++;if(!duplicate)groups.set(key,group)}
      group.people.add(row.user_id);
      db.prepare('INSERT INTO salon_service_assignments(service_id,catalog_id,performer_id) VALUES(?,?,?)').run(row.id,group.id,row.user_id);
      db.prepare('INSERT OR IGNORE INTO salon_service_aliases VALUES(?,?,?)').run(row.workspace_id,salonServiceKey(row),row.id);report.services++;
    }
    // Retain only old directions not explained by imported offers. Do not mutate
    // existing profiles or business rows during the additive migration.
    db.exec(`INSERT INTO salon_service_preserved_directions SELECT pc.user_id,pc.category FROM profile_categories pc JOIN performers p ON p.id=pc.user_id JOIN workspaces w ON w.id=p.workspace_id WHERE w.kind='salon' AND NOT EXISTS(SELECT 1 FROM salon_service_assignments a JOIN salon_service_catalog c ON c.id=a.catalog_id WHERE a.performer_id=p.id AND c.category=pc.category)`);
    db.exec(`UPDATE salon_service_catalog SET needs_review=1 WHERE EXISTS(SELECT 1 FROM salon_service_catalog other WHERE other.workspace_id=salon_service_catalog.workspace_id AND other.name=salon_service_catalog.name AND other.category=salon_service_catalog.category AND other.id<>salon_service_catalog.id)`);
    report.needs_review=db.prepare('SELECT COUNT(*) n FROM salon_service_catalog WHERE needs_review=1').get().n;
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(migration,Date.now());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  if(reportFile)fs.writeFileSync(reportFile,JSON.stringify(report,null,2),{mode:0o600});
  return report;
}

export function salonServiceCatalog({db,fail,categories}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  function atomic(fn){db.exec('SAVEPOINT salon_catalog_edit');try{const result=fn();db.exec('RELEASE salon_catalog_edit');return result}catch(error){db.exec('ROLLBACK TO salon_catalog_edit;RELEASE salon_catalog_edit');throw error}}
  function owner(req,id){const w=get("SELECT * FROM workspaces WHERE id=? AND kind='salon' AND owner_user_id=?",id,req.user.id);if(!w)fail('Салон не найден',404);return w}
  function definition(workspace,id){const row=get('SELECT * FROM salon_service_catalog WHERE id=? AND workspace_id=?',id,workspace);if(!row)fail('Услуга салона не найдена',404);return row}
  function list(workspace){return all('SELECT * FROM salon_service_catalog WHERE workspace_id=? ORDER BY active DESC,category,name,created,id',workspace).map(row=>({...row,active:Boolean(row.active),needs_review:Boolean(row.needs_review),public_id:salonCatalogKey(row.id),assignments:all(`SELECT a.*,s.price,s.duration,p.name,p.active performer_active FROM salon_service_assignments a JOIN services s ON s.id=a.service_id JOIN performers p ON p.id=a.performer_id WHERE a.catalog_id=? ORDER BY p.created,p.id`,row.id).map(a=>({...a,active:Boolean(a.active),performer_active:Boolean(a.performer_active)}))}))}
  function remember(workspace,offer){run('INSERT OR IGNORE INTO salon_service_aliases VALUES(?,?,?)',workspace,salonServiceKey(offer),offer.id)}
  function syncDirections(id){
    const values=[...new Set([...all(`SELECT DISTINCT c.category FROM salon_service_assignments a JOIN salon_service_catalog c ON c.id=a.catalog_id WHERE a.performer_id=? AND a.active=1 AND c.active=1 AND c.category<>'' ORDER BY c.category`,id).map(r=>r.category),...all('SELECT category FROM salon_service_preserved_directions WHERE performer_id=? ORDER BY category',id).map(r=>r.category)])];
    run('DELETE FROM profile_categories WHERE user_id=?',id);for(const value of values)run('INSERT INTO profile_categories VALUES(?,?)',id,value);run("UPDATE profiles SET category=? WHERE user_id=?",values[0]||'',id);
    if(!get(`SELECT 1 FROM services s WHERE s.user_id=? AND ${activeServiceSQL(db)}`,id))run('UPDATE performers SET bookable=0 WHERE id=?',id);
  }
  function validateAssignments(workspace,items,catalogId){
    if(!Array.isArray(items)||items.length>100)fail('Выберите исполнителей услуги');const seen=new Set();
    return items.map(item=>{
      if(!item||typeof item.performer_id!=='string'||seen.has(item.performer_id))fail('Проверьте список исполнителей');seen.add(item.performer_id);
      if(!get('SELECT 1 FROM performers WHERE id=? AND workspace_id=? AND (active=1 OR EXISTS(SELECT 1 FROM salon_service_assignments a WHERE a.performer_id=performers.id AND a.catalog_id=? AND a.active=1))',item.performer_id,workspace,catalogId||''))fail('Мастер не найден в этом салоне',404);
      const price=item.price_override??null,duration=item.duration_override??null;
      if(price!==null&&(!Number.isInteger(price)||price<0||price>1000000)||duration!==null&&(!Number.isInteger(duration)||duration<5||duration>720))fail('Проверьте особую цену и длительность');
      return {performer_id:item.performer_id,price_override:price,duration_override:duration};
    });
  }
  function applyAssignments(def,items){
    const wanted=new Map(items.map(item=>[item.performer_id,item])),before=all('SELECT * FROM salon_service_assignments WHERE catalog_id=?',def.id),affected=new Set([...before.map(a=>a.performer_id),...wanted.keys()]);
    for(const assignment of before)if(!wanted.has(assignment.performer_id))run('UPDATE salon_service_assignments SET active=0 WHERE service_id=?',assignment.service_id);
    for(const item of items){
      const prior=before.find(a=>a.performer_id===item.performer_id),price=item.price_override??def.price,duration=item.duration_override??def.duration;
      if(prior){const offer=get('SELECT * FROM services WHERE id=?',prior.service_id);remember(def.workspace_id,offer);run('UPDATE services SET name=?,price=?,duration=? WHERE id=?',def.name,price,duration,offer.id);run('UPDATE salon_service_assignments SET active=1,price_override=?,duration_override=? WHERE service_id=?',item.price_override,item.duration_override,offer.id);saveServiceDirection(db,offer.id,def.category);remember(def.workspace_id,{id:offer.id,name:def.name,price,duration})}
      else{
        if(get(`SELECT COUNT(*) n FROM services s WHERE s.user_id=? AND ${activeServiceSQL(db)}`,item.performer_id).n>=100)fail('У мастера уже назначено 100 услуг');
        const id=randomUUID();run('INSERT INTO services VALUES(?,?,?,?,?)',id,item.performer_id,def.name,price,duration);run('INSERT INTO salon_service_assignments(service_id,catalog_id,performer_id,price_override,duration_override) VALUES(?,?,?,?,?)',id,def.id,item.performer_id,item.price_override,item.duration_override);saveServiceDirection(db,id,def.category);remember(def.workspace_id,{id,name:def.name,price,duration});
      }
    }
    for(const id of affected)syncDirections(id);
  }
  function save(workspace,b,id=''){
    const before=id?definition(workspace,id):null,name=typeof b.name==='string'?b.name.trim():'',category=b.category;
    if(!name||name.length>120||!Number.isInteger(b.price)||b.price<0||b.price>1000000||!Number.isInteger(b.duration)||b.duration<5||b.duration>720)fail('Проверьте название, цену и длительность услуги');
    if(!categories.includes(category))fail('Выберите направление услуги');
    if(b.active!==undefined&&typeof b.active!=='boolean')fail('Проверьте доступность услуги');
    if(before&&b.revision!==before.revision)fail('Услуга изменена в другом окне. Обновите данные перед сохранением.',409);
    const assignments=validateAssignments(workspace,b.assignments,id),key=before?.id||randomUUID();
    return atomic(()=>{
      if(before){const changed=run('UPDATE salon_service_catalog SET name=?,category=?,price=?,duration=?,active=?,needs_review=0,revision=revision+1 WHERE id=? AND revision=?',name,category,b.price,b.duration,Number(b.active??Boolean(before.active)),key,b.revision);if(changed.changes!==1)fail('Услуга изменена в другом окне. Обновите данные.',409)}
      else{if(get('SELECT COUNT(*) n FROM salon_service_catalog WHERE workspace_id=? AND active=1',workspace).n>=500)fail('В прайсе уже 500 услуг');run('INSERT INTO salon_service_catalog(id,workspace_id,name,category,price,duration,active,created) VALUES(?,?,?,?,?,?,?,?)',key,workspace,name,category,b.price,b.duration,Number(b.active??true),Date.now())}
      applyAssignments(definition(workspace,key),assignments);return list(workspace).find(s=>s.id===key);
    });
  }
  function setStaffServices(workspace,performer,ids){
    if(!Array.isArray(ids)||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'))fail('Выберите услуги из прайса салона');
    for(const id of ids){const row=definition(workspace,id);if(!row.active)fail('Эта услуга находится в архиве')}
    return atomic(()=>{
      for(const def of list(workspace)){
        const current=def.assignments.find(a=>a.performer_id===performer),wanted=ids.includes(def.id);
        if(wanted===Boolean(current?.active))continue;
        const assignments=def.assignments.filter(a=>a.active&&a.performer_id!==performer).map(a=>({performer_id:a.performer_id,price_override:a.price_override,duration_override:a.duration_override}));
        if(wanted)assignments.push({performer_id:performer,price_override:current?.price_override??null,duration_override:current?.duration_override??null});
        run('UPDATE salon_service_catalog SET revision=revision+1 WHERE id=?',def.id);applyAssignments(def,assignments);
      }
      syncDirections(performer);
    });
  }
  function addOffer(workspace,performer,b){
    return atomic(()=>{
      let def=list(workspace).find(d=>d.active&&d.name===b.name&&d.category===b.category&&d.price===b.price&&d.duration===b.duration&&!d.assignments.some(a=>a.performer_id===performer&&a.active));
      if(!def)def=save(workspace,{...b,assignments:[]});
      const items=def.assignments.filter(a=>a.active&&a.performer_id!==performer).map(a=>({performer_id:a.performer_id,price_override:a.price_override,duration_override:a.duration_override}));items.push({performer_id:performer,price_override:null,duration_override:null});run('UPDATE salon_service_catalog SET revision=revision+1 WHERE id=?',def.id);applyAssignments(def,items);return get('SELECT service_id id FROM salon_service_assignments WHERE catalog_id=? AND performer_id=?',def.id,performer);
    });
  }
  function detach(serviceId){const a=get('SELECT * FROM salon_service_assignments WHERE service_id=?',serviceId);if(!a)return false;return atomic(()=>{run('UPDATE salon_service_assignments SET active=0 WHERE service_id=?',serviceId);run('UPDATE salon_service_catalog SET revision=revision+1 WHERE id=?',a.catalog_id);syncDirections(a.performer_id);return true})}
  function legacyIds(workspace,ids){return [...new Set(ids.map(id=>{const a=get('SELECT a.catalog_id FROM salon_service_assignments a JOIN salon_service_catalog c ON c.id=a.catalog_id WHERE a.service_id=? AND c.workspace_id=?',id,workspace);if(!a)fail('Выберите услугу из общего прайса',409);return a.catalog_id}))]}
  function register(app,requireUser){
    app.get('/api/salons/:id/service-catalog',requireUser,(req,res)=>{owner(req,req.params.id);res.json(list(req.params.id))});
    app.post('/api/salons/:id/service-catalog',requireUser,(req,res)=>{owner(req,req.params.id);res.status(201).json(save(req.params.id,req.body))});
    app.put('/api/salons/:id/service-catalog/:service',requireUser,(req,res)=>{owner(req,req.params.id);res.json(save(req.params.id,req.body,req.params.service))});
  }
  return {list,save,setStaffServices,addOffer,detach,legacyIds,syncDirections,register};
}
