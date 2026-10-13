import {randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function migrateSalonContent(db,{backupDir}={}){
  if(db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('salon-content-v1'))return;
  if(backupDir){
    fs.mkdirSync(backupDir,{recursive:true,mode:0o700});
    const file=path.join(backupDir,'before-salon-content-'+Date.now()+'-'+randomUUID()+'.sqlite');
    db.prepare('VACUUM INTO ?').run(file);fs.chmodSync(file,0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec(`CREATE TABLE salon_posts(id TEXT PRIMARY KEY,workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
      caption TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('space','news')),created INTEGER NOT NULL);
      CREATE INDEX salon_posts_workspace ON salon_posts(workspace_id,created DESC);
      CREATE TABLE salon_post_images(id TEXT PRIMARY KEY,post_id TEXT NOT NULL REFERENCES salon_posts(id) ON DELETE CASCADE,
      image TEXT NOT NULL,position INTEGER NOT NULL);`);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('salon-content-v1',Date.now());db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
}

export function salonContent({app,db,requireUser,fail,publications,backupDir}){
  migrateSalonContent(db,{backupDir});
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  const transaction=fn=>{db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(error){db.exec('ROLLBACK');throw error}};
  function owner(req){const w=get("SELECT * FROM workspaces WHERE id=? AND kind='salon' AND owner_user_id=?",req.params.id,req.user.id);if(!w)fail('Салон не найден',404);return w}
  const postImages=id=>all('SELECT id,image FROM salon_post_images WHERE post_id=? ORDER BY position,id',id);
  const posts=id=>all('SELECT * FROM salon_posts WHERE workspace_id=? ORDER BY created DESC,id DESC LIMIT 100',id).map(p=>({...p,images:postImages(p.id),image:postImages(p.id)[0]?.image,publication_target:'salon'}));
  function target(req,w){
    const id=typeof req.body.performer_id==='string'?req.body.performer_id:'';
    if(!id)return null;
    const p=get('SELECT id FROM performers WHERE id=? AND workspace_id=? AND active=1',id,w.id);if(!p)fail('Мастер салона не найден',404);return p.id;
  }
  function metadata(req,pid){
    const caption=typeof req.body.caption==='string'?req.body.caption.trim().slice(0,500):'';
    if(!caption)fail('Добавьте подпись к публикации');
    if(pid){const s=get('SELECT id FROM services WHERE id=? AND user_id=?',req.body.service_id||'',pid);if(!s)fail('Выберите услугу этого мастера');return {caption,service_id:s.id}}
    const kind=req.body.post_kind||'space';if(!['space','news'].includes(kind))fail('Выберите вид публикации салона');return {caption,kind};
  }
  const authorize=(req,res,next)=>{owner(req);next()};
  app.get('/api/salons/:id/publications',requireUser,(req,res)=>{
    const w=owner(req);
    const works=all(`SELECT work.*,p.name master_name,p.id performer_id,s.name service_name FROM works work
      JOIN performers p ON p.id=work.user_id LEFT JOIN services s ON s.id=work.service_id
      WHERE p.workspace_id=? AND p.active=1 ORDER BY work.created DESC,work.id DESC`,w.id)
      .map(work=>({...publications.hydrate(work),publication_target:work.performer_id,kind:'work'}));
    res.json([...works,...posts(w.id)].sort((a,b)=>b.created-a.created||b.id.localeCompare(a.id)));
  });
  app.post('/api/salons/:id/publications',requireUser,authorize,publications.upload,async(req,res)=>{
    const w=owner(req),pid=target(req,w),meta=metadata(req,pid);
    if(pid)return res.status(201).json(await publications.createWork(req,pid,()=>{owner(req);target(req,w)}));
    if(!req.files?.length)fail('Добавьте фотографии');
    const photos=await publications.convert(req.files),id=randomUUID();
    try{transaction(()=>{
      owner(req);
      if(get('SELECT COUNT(*) n FROM salon_posts WHERE workspace_id=?',w.id).n>=100)fail('Лимит — 100 публикаций салона');
      run('INSERT INTO salon_posts VALUES(?,?,?,?,?)',id,w.id,meta.caption,meta.kind,Date.now());
      photos.forEach((p,i)=>run('INSERT INTO salon_post_images VALUES(?,?,?,?)',p.id,id,p.image,i));
    })}catch(error){await publications.unlink(photos);throw error}
    res.status(201).json({id});
  });
  function owned(req){
    const w=owner(req),id=req.params.publication;
    const post=get('SELECT * FROM salon_posts WHERE id=? AND workspace_id=?',id,w.id);
    if(post)return {post,images:postImages(id),pid:null};
    const work=get('SELECT work.* FROM works work JOIN performers p ON p.id=work.user_id WHERE work.id=? AND p.workspace_id=?',id,w.id);
    if(!work)fail('Публикация не найдена',404);
    return {post:work,images:publications.hydrate(work).images,pid:work.user_id};
  }
  app.put('/api/salons/:id/publications/:publication',requireUser,authorize,publications.upload,async(req,res)=>{
    const before=owned(req),meta=metadata(req,before.pid),added=req.files?.length?await publications.convert(req.files):[];
    try{transaction(()=>{
      const current=owned(req);
      if(JSON.stringify(current)!==JSON.stringify(before))fail('Публикация изменена в другом окне. Откройте её заново.',409);
      metadata(req,before.pid);
      if(before.pid){
        run('UPDATE works SET caption=?,service_id=? WHERE id=?',meta.caption,meta.service_id,before.post.id);
        if(added.length){run('DELETE FROM work_images WHERE work_id=?',before.post.id);added.forEach((p,i)=>run('INSERT INTO work_images VALUES(?,?,?,?)',p.id,before.post.id,p.image,i));run('UPDATE works SET image=? WHERE id=?',added[0].image,before.post.id)}
      }else{
        run('UPDATE salon_posts SET caption=?,kind=? WHERE id=?',meta.caption,meta.kind,before.post.id);
        if(added.length){run('DELETE FROM salon_post_images WHERE post_id=?',before.post.id);added.forEach((p,i)=>run('INSERT INTO salon_post_images VALUES(?,?,?,?)',p.id,before.post.id,p.image,i))}
      }
    })}catch(error){await publications.unlink(added);throw error}
    if(added.length)await publications.unlink(before.images);res.json({ok:true});
  });
  app.delete('/api/salons/:id/publications/:publication',requireUser,async(req,res)=>{
    const entry=owned(req);
    if(entry.pid)await publications.removeWork(entry.post.id,entry.pid);
    else{run('DELETE FROM salon_posts WHERE id=? AND workspace_id=?',entry.post.id,req.params.id);await publications.unlink(entry.images)}
    res.json({ok:true});
  });
  return {posts};
}
