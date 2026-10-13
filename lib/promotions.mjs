import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

// Writes are available only to the server operator, never through public HTTP.
export function promotions({db,categories,backupDir,enabled=()=>process.env.PROMOTIONS_ENABLED==='1',now=Date.now}){
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  if(!get('SELECT 1 FROM schema_migrations WHERE name=?','promotions-v1')){
    if(backupDir){fs.mkdirSync(backupDir,{recursive:true,mode:0o700});const file=path.join(backupDir,'before-promotions-'+now()+'-'+randomUUID()+'.sqlite');db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600)}
    db.exec('BEGIN IMMEDIATE');
    try{
      db.exec(`CREATE TABLE promotions(
        id TEXT PRIMARY KEY,master_id TEXT REFERENCES profiles(user_id) ON DELETE CASCADE,salon_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
        category TEXT NOT NULL DEFAULT '',catalog INTEGER NOT NULL CHECK(catalog IN (0,1)),map INTEGER NOT NULL CHECK(map IN (0,1)),
        starts INTEGER NOT NULL,ends INTEGER NOT NULL,priority INTEGER NOT NULL CHECK(priority BETWEEN 1 AND 100),
        advertiser TEXT NOT NULL,erid TEXT NOT NULL,created INTEGER NOT NULL,cancelled INTEGER,
        CHECK((master_id IS NULL)<>(salon_id IS NULL)),CHECK(ends>starts),CHECK(catalog=1 OR map=1));
        CREATE INDEX promotions_period ON promotions(cancelled,starts,ends);
        CREATE TABLE promotion_events(id TEXT PRIMARY KEY,promotion_id TEXT NOT NULL,action TEXT NOT NULL,operator TEXT NOT NULL,created INTEGER NOT NULL,details TEXT NOT NULL);`);
      run('INSERT INTO schema_migrations VALUES(?,?)','promotions-v1',now());db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
  }
  function target(kind,id){
    if(kind==='master')return get(`SELECT pr.user_id id,pr.slug,pr.name FROM profiles pr JOIN performers p ON p.id=pr.user_id JOIN workspaces w ON w.id=p.workspace_id
      WHERE pr.user_id=? AND pr.published=1 AND pr.is_demo=0 AND p.active=1 AND w.kind='solo' AND w.owner_user_id IS NOT NULL`,id);
    if(kind==='salon')return get("SELECT id,slug,name FROM workspaces WHERE id=? AND kind='salon' AND published=1 AND owner_user_id IS NOT NULL",id);
    return null;
  }
  function targetCategories(kind,id){
    return kind==='master'?all('SELECT category FROM profile_categories WHERE user_id=?',id).map(p=>p.category):all(`SELECT DISTINCT pc.category FROM profile_categories pc JOIN performers p ON p.id=pc.user_id JOIN profiles pr ON pr.user_id=p.id WHERE p.workspace_id=? AND p.active=1 AND p.bookable=1 AND pr.is_demo=0`,id).map(p=>p.category);
  }
  function transaction(fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value}catch(error){db.exec('ROLLBACK');throw error}}
  function required(value,max,label){if(typeof value!=='string'||!value.trim()||value.trim().length>max)throw new Error(label);return value.trim()}
  function create(input,operator){
    operator=required(operator,100,'Укажите оператора');
    const kind=input.kind,id=required(input.target_id,100,'Укажите ID страницы'),category=input.category??'',starts=input.starts,ends=input.ends,priority=input.priority??50;
    const advertiser=required(input.advertiser,200,'Укажите рекламодателя'),erid=required(input.erid,100,'Укажите идентификатор рекламы');
    if(!/^[a-zA-Z0-9_-]+$/.test(erid))throw new Error('Проверьте идентификатор рекламы');
    if(!Number.isSafeInteger(starts)||!Number.isSafeInteger(ends)||starts<0||ends<=starts||ends<=now()||ends-starts>366*86400000)throw new Error('Проверьте срок размещения (до 366 дней)');
    if(!Number.isInteger(priority)||priority<1||priority>100)throw new Error('Приоритет: 1–100');
    if(typeof input.catalog!=='boolean'||typeof input.map!=='boolean'||!input.catalog&&!input.map)throw new Error('Выберите каталог и/или карту');
    if(typeof category!=='string'||category&&!categories.includes(category))throw new Error('Выберите направление из справочника');
    return transaction(()=>{
      if(!target(kind,id))throw new Error('Опубликованная страница не найдена');
      if(category&&!targetCategories(kind,id).includes(category))throw new Error('На странице нет этого направления');
      const column=kind==='master'?'master_id':'salon_id';
      if(get(`SELECT 1 FROM promotions WHERE ${column}=? AND cancelled IS NULL AND ends>? AND starts<? AND (category='' OR ?='' OR category=?) AND ((catalog=1 AND ?=1) OR (map=1 AND ?=1))`,id,starts,ends,category,category,Number(input.catalog),Number(input.map)))throw new Error('Размещение пересекается с существующим');
      const promotion={id:randomUUID(),kind,target_id:id,category,catalog:input.catalog,map:input.map,starts,ends,priority,advertiser,erid,created:now()};
      run('INSERT INTO promotions(id,master_id,salon_id,category,catalog,map,starts,ends,priority,advertiser,erid,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',promotion.id,kind==='master'?id:null,kind==='salon'?id:null,category,Number(input.catalog),Number(input.map),starts,ends,priority,advertiser,erid,promotion.created);
      run('INSERT INTO promotion_events VALUES(?,?,?,?,?,?)',randomUUID(),promotion.id,'create',operator,promotion.created,JSON.stringify(promotion));
      return promotion;
    });
  }
  function cancel(id,operator){operator=required(operator,100,'Укажите оператора');return transaction(()=>{
    const promotion=get('SELECT * FROM promotions WHERE id=?',id);if(!promotion)throw new Error('Размещение не найдено');if(promotion.cancelled!==null)return false;
    run('UPDATE promotions SET cancelled=? WHERE id=?',now(),id);run('INSERT INTO promotion_events VALUES(?,?,?,?,?,?)',randomUUID(),id,'cancel',operator,now(),'{}');return true;
  })}
  function active(surface,category=''){
    if(!enabled())return new Map();if(!['catalog','map'].includes(surface))throw new Error('Неизвестное место показа');
    const time=now(),result=new Map();
    for(const p of all(`SELECT * FROM promotions WHERE cancelled IS NULL AND starts<=? AND ends>? AND ${surface}=1 ORDER BY priority DESC,created,id`,time,time)){
      const kind=p.master_id?'master':'salon',id=p.master_id||p.salon_id,key=kind+':'+id;
      if(result.has(key)||category&&p.category&&category!==p.category||!target(kind,id))continue;
      if(p.category&&!targetCategories(kind,id).includes(p.category))continue;
      result.set(key,{label:'Реклама',until:p.ends,advertiser:p.advertiser,erid:p.erid});
    }
    return result;
  }
  const decorate=(profile,active)=>{const promotion=active.get((profile.kind||'master')+':'+profile.user_id);return promotion?{...profile,promotion}:profile};
  return {create,cancel,active,decorate,list:()=>all('SELECT * FROM promotions ORDER BY created DESC,id')};
}
