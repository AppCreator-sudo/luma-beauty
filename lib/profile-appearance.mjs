import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {createImageUpload} from './image-upload.mjs';

export function migrateProfileCover(db,{backupDir}={}){
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(name TEXT PRIMARY KEY,created INTEGER NOT NULL)');
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('profile-cover-v1'))return;
  if(backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});fs.chmodSync(backupDir,0o700);
    const file=path.join(backupDir,'before-profile-cover-'+Date.now()+'-'+randomUUID()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    if(!db.prepare('PRAGMA table_info(profiles)').all().some(column=>column.name==='cover'))db.exec("ALTER TABLE profiles ADD COLUMN cover TEXT NOT NULL DEFAULT ''");
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('profile-cover-v1',Date.now());
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}

export function profileAppearance({app,db,dataDir,requireUser,requireMaster,requireProfile,fail}){
  const media=createImageUpload({dataDir,fail});
  const current=id=>db.prepare('SELECT cover FROM profiles WHERE user_id=?').get(id)?.cover;
  app.patch('/api/profile/appearance',requireUser,requireMaster,requireProfile,(req,res)=>{
    if(!['cream','wine','green'].includes(req.body.theme))fail('Выберите оформление страницы');
    db.prepare('UPDATE profiles SET theme=? WHERE user_id=?').run(req.body.theme,req.user.id);
    res.json({ok:true,theme:req.body.theme});
  });
  app.post('/api/profile/cover',requireUser,requireMaster,requireProfile,media.middleware,async(req,res)=>{
    const before=current(req.user.id),image=await media.save(req.file,'cover');
    try{
      if(current(req.user.id)!==before)fail('Фото изменилось в другом окне. Обновите страницу и повторите загрузку',409);
      const result=db.prepare('UPDATE profiles SET cover=? WHERE user_id=? AND cover=?').run(image,req.user.id,before);
      if(result.changes!==1)fail('Фото изменилось в другом окне. Обновите страницу и повторите загрузку',409);
    }catch(error){await media.removeOwned(image);throw error}
    await media.removeOwned(before);res.json({ok:true,image,cover:image});
  });
  app.delete('/api/profile/cover',requireUser,requireMaster,requireProfile,async(req,res)=>{
    const before=current(req.user.id);
    const result=db.prepare("UPDATE profiles SET cover='' WHERE user_id=? AND cover=?").run(req.user.id,before);
    if(result.changes!==1)fail('Фото изменилось в другом окне. Обновите страницу и повторите удаление',409);
    await media.removeOwned(before);res.json({ok:true,cover:''});
  });
}
