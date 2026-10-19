import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import {salonServiceKey} from './salon-service-key.mjs';

const IMAGE_RULES=JSON.parse(await fs.readFile(new URL('./image-rules.json',import.meta.url),'utf8'));

export function publications({ app, db, dataDir, requireUser, requireMaster, requireProfile, fail }) {
  // SQLite's built-in lower() only folds ASCII; Russian city filters need Unicode.
  db.function('publication_city_fold', { deterministic: true }, value => String(value || '').toLocaleLowerCase('ru-RU'));
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);
  const columns = all('PRAGMA table_info(works)').map(c => c.name);
  if (!columns.includes('pinned')) db.exec('ALTER TABLE works ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('position')) db.exec('ALTER TABLE works ADD COLUMN position INTEGER NOT NULL DEFAULT 0');
  if (!all('PRAGMA table_info(profiles)').some(c => c.name === 'is_demo')) db.exec('ALTER TABLE profiles ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS work_images (
    id TEXT PRIMARY KEY, work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,
    image TEXT NOT NULL, position INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS work_images_order ON work_images(work_id,position);
    CREATE INDEX IF NOT EXISTS works_feed ON works(created DESC,id DESC);
    INSERT INTO work_images(id,work_id,image,position)
    SELECT id,id,image,0 FROM works WHERE NOT EXISTS (SELECT 1 FROM work_images WHERE work_id=works.id);`);

  const images = id => all('SELECT id,image FROM work_images WHERE work_id=? ORDER BY position,id', id);
  const hydrate = work => ({ ...work, images: images(work.id) });
  const portfolio = (id, viewer = '') => all(`SELECT w.*,s.name service_name,s.price service_price,s.duration service_duration,
    EXISTS(SELECT 1 FROM saved_works sw WHERE sw.user_id=? AND sw.work_id=w.id) saved
    FROM works w LEFT JOIN services s ON s.id=w.service_id WHERE w.user_id=?
    ORDER BY w.pinned DESC,w.position DESC,w.created DESC,w.id DESC`, viewer, id).map(hydrate);
  const owned = req => {
    const work = get('SELECT * FROM works WHERE id=? AND user_id=?', req.params.id, req.user.id);
    if (!work) fail('Работа не найдена', 404);
    return work;
  };
  const service = (value, userId) => {
    const id = typeof value === 'string' && value ? value : null;
    if (id && !get('SELECT id FROM services WHERE id=? AND user_id=?', id, userId)) fail('Услуга не найдена');
    return id;
  };
  const transaction = fn => {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  };
  const unlink = async list => Promise.all(list.map(img => fs.unlink(path.join(dataDir,'uploads',path.basename(img.image))).catch(() => {})));
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: IMAGE_RULES.maxBytes, files: 6, fields: 8, fieldSize: 8192 } }).array('image', 6);
  async function convert(files) {
    const result = [];
    try {
      for (const file of files) {
        const id = randomUUID(), image = '/uploads/'+id+'.webp';
        result.push({ id, image });
        const photo = sharp(file.buffer, { limitInputPixels: IMAGE_RULES.maxPixels });
        const dimensions = await photo.metadata();
        if (!['jpeg','png','webp'].includes(dimensions.format)) fail('Используйте JPEG, PNG или WebP');
        if (dimensions.width > IMAGE_RULES.maxSide || dimensions.height > IMAGE_RULES.maxSide) fail('Фото должно быть не больше '+IMAGE_RULES.maxSide.toLocaleString('ru-RU')+' пикселей по каждой стороне');
        await photo.rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 82 }).toFile(path.join(dataDir,'uploads',id+'.webp'));
      }
      return result;
    } catch (error) { await unlink(result); if (error.status) throw error; fail('Не удалось прочитать фото. Используйте JPEG, PNG или WebP.'); }
  }
  const metadata = (req,userId=req.user.id) => ({
    caption: typeof req.body.caption === 'string' ? req.body.caption.trim().slice(0,500) : '',
    serviceId: service(req.body.service_id, userId)
  });
  const requirePublicationMetadata = meta => {
    if (!meta.caption) fail('Добавьте подпись к работе');
    if (!meta.serviceId) fail('Выберите связанную услугу');
  };
  const persistImages = (id, list) => {
    run('DELETE FROM work_images WHERE work_id=?', id);
    list.forEach((img, i) => run('INSERT INTO work_images VALUES(?,?,?,?)',img.id,id,img.image,i));
    run('UPDATE works SET image=? WHERE id=?',list[0].image,id);
  };

  async function createWork(req,userId,authorize=()=>{}) {
    authorize();
    if (!req.files?.length) fail('Выберите фотографии');
    const meta = metadata(req,userId); requirePublicationMetadata(meta);
    const id = randomUUID(), photos = await convert(req.files);
    try {
      transaction(() => {
        authorize();
        if (get('SELECT COUNT(*) n FROM works WHERE user_id=?',userId).n >= 100) fail('Лимит пилотной версии — 100 работ');
        service(meta.serviceId,userId);
        const position = get('SELECT COALESCE(MAX(position),0)+1 n FROM works WHERE user_id=?',userId).n;
        run('INSERT INTO works(id,user_id,image,caption,created,service_id,position) VALUES(?,?,?,?,?,?,?)',id,userId,photos[0].image,meta.caption,Date.now(),meta.serviceId,position);
        persistImages(id,photos);
      });
    } catch (error) { await unlink(photos); throw error; }
    return {id};
  }
  async function removeWork(id,userId) {
    const work=get('SELECT id FROM works WHERE id=? AND user_id=?',id,userId);
    if(!work)fail('Работа не найдена',404);
    const photos=images(work.id);
    run('DELETE FROM works WHERE id=? AND user_id=?',work.id,userId);
    await unlink(photos);
  }
  app.post('/api/works',requireUser,requireMaster,requireProfile,upload,async(req,res) => {
    res.status(201).json(await createWork(req,req.user.id));
  });
  app.put('/api/works/order',requireUser,requireMaster,(req,res) => {
    const ids = req.body.ids, rows = all('SELECT id FROM works WHERE user_id=?',req.user.id);
    if (!Array.isArray(ids) || ids.length !== rows.length || new Set(ids).size !== ids.length || ids.some(id => !rows.some(w => w.id === id))) fail('Обновите страницу и повторите изменение порядка');
    transaction(() => ids.forEach((id,i) => run('UPDATE works SET position=? WHERE id=? AND user_id=?',ids.length-i,id,req.user.id)));
    res.json({ok:true});
  });
  app.put('/api/works/:id',requireUser,requireMaster,upload,async(req,res) => {
    const work = owned(req), before = images(work.id), meta = metadata(req);
    requirePublicationMetadata(meta);
    let ids;
    try { ids = JSON.parse(req.body.existing_images); } catch { fail('Проверьте фотографии работы'); }
    if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some(id => !before.some(img => img.id === id))) fail('Проверьте фотографии работы');
    const count = ids.length + (req.files?.length || 0);
    if (count < 1 || count > 6) fail('В работе должно быть от 1 до 6 фотографий');
    const retained = ids.map(id => before.find(img => img.id === id));
    let order = null;
    if (req.body.photo_order) {
      try { order = JSON.parse(req.body.photo_order); } catch { fail('Проверьте порядок фотографий'); }
      const expected = [...ids.map(id=>'id:'+id),...(req.files||[]).map((_,i)=>'upload:'+i)];
      const keys = Array.isArray(order) ? order.map(p=>p && typeof p.id==='string'?'id:'+p.id:'upload:'+p?.upload) : [];
      if (keys.length!==expected.length || new Set(keys).size!==keys.length || keys.some(k=>!expected.includes(k))) fail('Проверьте порядок фотографий');
    }
    const added = await convert(req.files || []);
    try {
      transaction(() => {
        owned(req);
        if (JSON.stringify(images(work.id)) !== JSON.stringify(before)) fail('Работа изменена в другой вкладке. Откройте её заново.',409);
        service(meta.serviceId,req.user.id);
        run('UPDATE works SET caption=?,service_id=? WHERE id=?',meta.caption,meta.serviceId,work.id);
        const photos = order ? order.map(p=>p.id?retained.find(img=>img.id===p.id):added[p.upload]) : [...retained,...added];
        persistImages(work.id,photos);
      });
    } catch (error) { await unlink(added); throw error; }
    await unlink(before.filter(img => !ids.includes(img.id)));
    res.json({ok:true});
  });
  app.patch('/api/works/:id',requireUser,requireMaster,(req,res) => {
    const work = owned(req);
    if (typeof req.body.pinned !== 'boolean') fail('Укажите состояние закрепления');
    if (req.body.pinned && !work.pinned && get('SELECT COUNT(*) n FROM works WHERE user_id=? AND pinned=1',req.user.id).n >= 3) fail('Можно закрепить до трёх работ');
    run('UPDATE works SET pinned=? WHERE id=?',req.body.pinned?1:0,work.id);
    res.json({ok:true});
  });
  app.delete('/api/works/:id',requireUser,requireMaster,async(req,res) => {
    await removeWork(req.params.id,req.user.id);
    res.json({ok:true});
  });
  app.get('/api/feed',requireUser,(req,res) => {
    let cursor = null;
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(String(req.query.cursor),'base64url').toString());
        if (!Number.isSafeInteger(cursor.created) || typeof cursor.id !== 'string' || cursor.id.length > 80) throw Error();
      } catch { fail('Некорректная страница ленты'); }
    }
    const params = [req.user.id,req.user.id];
    if (cursor) params.push(cursor.created,cursor.created,cursor.id);
    const rows = all(`SELECT w.*,p.name master_name,p.slug,p.city,p.category,p.avatar,p.is_demo,
      s.name service_name,s.price service_price,s.duration service_duration,
      EXISTS(SELECT 1 FROM saved_works sw WHERE sw.user_id=? AND sw.work_id=w.id) saved
      FROM works w JOIN profiles p ON p.user_id=w.user_id JOIN follows f ON f.master_id=w.user_id
      LEFT JOIN services s ON s.id=w.service_id WHERE f.user_id=? AND p.published=1
      ${cursor?'AND (w.created<? OR (w.created=? AND w.id<?))':''}
      ORDER BY w.created DESC,w.id DESC LIMIT 13`,...params);
    const items = rows.slice(0,12), last = items.at(-1);
    res.json({items:items.map(hydrate),next:rows.length>12?Buffer.from(JSON.stringify({created:last.created,id:last.id})).toString('base64url'):null,
      following:get('SELECT COUNT(*) n FROM follows f JOIN profiles p ON p.user_id=f.master_id WHERE f.user_id=? AND p.published=1',req.user.id).n});
  });
  // A salon portfolio belongs to the staff performer record. A linked account's
  // separate personal page never inherits the salon's publication status.
  const publicJoins=`LEFT JOIN performers work_person ON work_person.id=w.user_id
    LEFT JOIN workspaces work_salon ON work_salon.id=work_person.workspace_id`;
  const publicVisible=`((p.published=1 AND COALESCE(work_salon.kind,'solo')<>'salon') OR
    (work_salon.kind='salon' AND work_salon.published=1 AND work_salon.owner_user_id IS NOT NULL
      AND work_person.active=1 AND work_person.bookable=1 AND p.is_demo=0))`;
  const workCity=`CASE WHEN work_salon.kind='salon' THEN work_salon.city ELSE p.city END`;
  const salonContext=`CASE WHEN work_salon.kind='salon' THEN work_salon.id END salon_id,
    CASE WHEN work_salon.kind='salon' THEN work_salon.slug END salon_slug,
    CASE WHEN work_salon.kind='salon' THEN work_salon.name END salon_name`;
  app.get('/api/inspiration',(req,res) => {
    let cursor = null;
    if (req.query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(String(req.query.cursor),'base64url').toString());
        if (!Number.isSafeInteger(cursor.created) || typeof cursor.id !== 'string' || cursor.id.length > 80) throw Error();
      } catch { fail('Некорректная страница ленты'); }
    }
    const city = typeof req.query.city === 'string' ? req.query.city.trim().slice(0,100).toLocaleLowerCase('ru-RU') : '';
    const category = typeof req.query.category === 'string' ? req.query.category.trim().slice(0,100) : '';
    const viewer = req.user?.id || '';
    const rows = all(`SELECT w.*,w.user_id performer_id,p.name master_name,p.slug,${workCity} city,p.category,p.avatar,p.is_demo,
      s.name service_name,s.price service_price,s.duration service_duration,
      ${salonContext},
      EXISTS(SELECT 1 FROM saved_works sw WHERE sw.user_id=? AND sw.work_id=w.id) saved
      FROM works w JOIN profiles p ON p.user_id=w.user_id ${publicJoins}
      LEFT JOIN services s ON s.id=w.service_id AND s.user_id=w.user_id
      WHERE ${publicVisible} AND (?='' OR instr(publication_city_fold(${workCity}),?)>0)
      AND (?='' OR EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.user_id=p.user_id AND pc.category=?))
      ${cursor?'AND (w.created<? OR (w.created=? AND w.id<?))':''}
      ORDER BY w.created DESC,w.id DESC LIMIT 13`,viewer,city,city,category,category,...(cursor?[cursor.created,cursor.created,cursor.id]:[]));
    const items = rows.slice(0,12), last = items.at(-1);
    res.json({items:items.map(hydrate),next:rows.length>12?Buffer.from(JSON.stringify({created:last.created,id:last.id})).toString('base64url'):null});
  });
  const workDetail=id=>{
    const work=get(`SELECT w.*,w.user_id performer_id,p.name master_name,p.slug,
    ${workCity} city,p.category,p.theme,p.avatar,p.published,p.is_demo,
    s.name service_name,s.price service_price,s.duration service_duration,${salonContext},${publicVisible} public_visible
    FROM works w JOIN profiles p ON p.user_id=w.user_id ${publicJoins}
    LEFT JOIN services s ON s.id=w.service_id AND s.user_id=w.user_id WHERE w.id=?`,id);
    return work?{...work,salon_service_id:work.salon_id&&work.service_name?salonServiceKey({name:work.service_name,price:work.service_price,duration:work.service_duration}):null}:null;
  };
  const isPublicWork=id=>Boolean(get(`SELECT 1 FROM works w JOIN profiles p ON p.user_id=w.user_id ${publicJoins} WHERE w.id=? AND ${publicVisible}`,id));
  const savedWorks=viewer=>all(`SELECT w.id,w.image,w.caption,w.service_id,p.name master_name,p.slug,
    ${workCity} city,
    s.name service_name,s.price service_price,s.duration service_duration,${salonContext},1 saved
    FROM saved_works sw JOIN works w ON w.id=sw.work_id JOIN profiles p ON p.user_id=w.user_id ${publicJoins}
    LEFT JOIN services s ON s.id=w.service_id AND s.user_id=w.user_id
    WHERE sw.user_id=? AND ${publicVisible} ORDER BY sw.created DESC`,viewer).map(hydrate);
  return {hydrate,portfolio,upload,convert,unlink,createWork,removeWork,workDetail,isPublicWork,savedWorks};
}
