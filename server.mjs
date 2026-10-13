import { clientCabinet } from './lib/client-cabinet.mjs';
import { appointmentEditing } from './lib/appointment-editing.mjs';
import { experienceMonths, migrateProfileExperience } from './lib/profile-experience.mjs';
import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import webpush from 'web-push';
import { publications } from './lib/publications.mjs';
import { guestBookings } from './lib/guest-bookings.mjs';
import { schedules, relatedPerformersBatch } from './lib/schedule.mjs';
import { createGeocoder, parseAddress } from './lib/geocoding.mjs';
import { migratePerformers, workspaceAccess, salonRoutes } from './lib/workspaces.mjs';
import { socialAuth } from './lib/social-auth.mjs';
import { salonPublic } from './lib/salon-public.mjs';
import { salonContent } from './lib/salon-content.mjs';
import { salonCalendar } from './lib/salon-calendar.mjs';
import { promotions } from './lib/promotions.mjs';
import { addressSuggestions } from './lib/address-suggestions.mjs';
import { mapViewport } from './lib/map-viewport.mjs';
import { createImageUpload } from './lib/image-upload.mjs';
import { migrateProfileCover, profileAppearance } from './lib/profile-appearance.mjs';

const scrypt=promisify(scryptCb), app=express();
const PORT=Number(process.env.PORT||3100), ORIGIN=process.env.APP_ORIGIN||`http://localhost:${PORT}`;
const DATA=path.resolve(process.env.DATA_DIR||'data'), PROD=process.env.NODE_ENV==='production';
if(PROD&&!ORIGIN.startsWith('https://'))throw new Error('APP_ORIGIN must use HTTPS in production');
const SECURE_COOKIE=PROD||ORIGIN.startsWith('https://');
const CATEGORIES=Object.freeze(JSON.parse(fs.readFileSync(new URL('./lib/categories.json',import.meta.url),'utf8')));
fs.mkdirSync(path.join(DATA,'uploads'),{recursive:true});
const db=new DatabaseSync(path.join(DATA,'atelie.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, login TEXT UNIQUE NOT NULL, password TEXT NOT NULL, recovery TEXT NOT NULL, created INTEGER NOT NULL,account_type TEXT NOT NULL DEFAULT 'client');
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS profiles(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,slug TEXT UNIQUE NOT NULL,name TEXT NOT NULL,city TEXT NOT NULL DEFAULT '',category TEXT NOT NULL DEFAULT 'Маникюр',bio TEXT NOT NULL DEFAULT '',theme TEXT NOT NULL DEFAULT 'cream',avatar TEXT NOT NULL DEFAULT '',address TEXT NOT NULL DEFAULT '',latitude REAL,longitude REAL,published INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS profile_categories(user_id TEXT NOT NULL REFERENCES profiles(user_id) ON DELETE CASCADE,category TEXT NOT NULL,PRIMARY KEY(user_id,category));
CREATE INDEX IF NOT EXISTS profile_categories_by_category ON profile_categories(category,user_id);
CREATE TABLE IF NOT EXISTS services(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,name TEXT NOT NULL,price INTEGER NOT NULL,duration INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS works(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,image TEXT NOT NULL,caption TEXT NOT NULL,created INTEGER NOT NULL,service_id TEXT REFERENCES services(id) ON DELETE SET NULL);
CREATE TABLE IF NOT EXISTS appointments(id TEXT PRIMARY KEY,master_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,client_id TEXT REFERENCES users(id) ON DELETE SET NULL,client_name TEXT NOT NULL,service TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL,price INTEGER NOT NULL,status TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '',reminded INTEGER NOT NULL DEFAULT 0,reference_work_id TEXT REFERENCES works(id) ON DELETE SET NULL);
CREATE INDEX IF NOT EXISTS appointment_time ON appointments(master_id,start,end,status);
CREATE TABLE IF NOT EXISTS availability_slots(id TEXT PRIMARY KEY,master_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,start INTEGER NOT NULL,end INTEGER NOT NULL,created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS availability_time ON availability_slots(master_id,start,end);
CREATE TABLE IF NOT EXISTS follows(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,master_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,created INTEGER NOT NULL,PRIMARY KEY(user_id,master_id),CHECK(user_id<>master_id));
CREATE TABLE IF NOT EXISTS saved_works(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,work_id TEXT NOT NULL REFERENCES works(id) ON DELETE CASCADE,created INTEGER NOT NULL,PRIMARY KEY(user_id,work_id));
CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,appointment_id TEXT UNIQUE NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,client_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,master_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),text TEXT NOT NULL DEFAULT '',created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS pushes(endpoint TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,subscription TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notices(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS identities(provider TEXT NOT NULL,subject TEXT NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,PRIMARY KEY(provider,subject));
CREATE TABLE IF NOT EXISTS oauth_states(state TEXT PRIMARY KEY,expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS geocode_cache(query TEXT PRIMARY KEY,results TEXT NOT NULL,expires INTEGER NOT NULL);
`);
const oauthColumns=db.prepare('PRAGMA table_info(oauth_states)').all().map(x=>x.name);
if(!oauthColumns.includes('verifier'))db.exec("ALTER TABLE oauth_states ADD COLUMN verifier TEXT NOT NULL DEFAULT ''");
const profileColumns=db.prepare('PRAGMA table_info(profiles)').all().map(x=>x.name);
if(!profileColumns.includes('teaches'))db.exec('ALTER TABLE profiles ADD COLUMN teaches INTEGER NOT NULL DEFAULT 0');
migrateProfileExperience(db);
db.exec("INSERT OR IGNORE INTO profile_categories(user_id,category) SELECT user_id,category FROM profiles WHERE category<>''");
const workColumns=db.prepare('PRAGMA table_info(works)').all().map(x=>x.name);
if(!workColumns.includes('service_id'))db.exec('ALTER TABLE works ADD COLUMN service_id TEXT REFERENCES services(id) ON DELETE SET NULL');
const appointmentColumns=db.prepare('PRAGMA table_info(appointments)').all().map(x=>x.name);
if(!appointmentColumns.includes('reference_work_id'))db.exec('ALTER TABLE appointments ADD COLUMN reference_work_id TEXT REFERENCES works(id) ON DELETE SET NULL');
const userColumns=db.prepare('PRAGMA table_info(users)').all().map(x=>x.name);
if(!userColumns.includes('account_type')){db.exec("ALTER TABLE users ADD COLUMN account_type TEXT NOT NULL DEFAULT 'client'");db.exec("UPDATE users SET account_type='master' WHERE id IN (SELECT user_id FROM profiles)")}
const q=(sql,...args)=>db.prepare(sql).all(...args), one=(sql,...args)=>db.prepare(sql).get(...args), run=(sql,...args)=>db.prepare(sql).run(...args);
const hash=s=>createHash('sha256').update(s).digest('hex');
const geocode=createGeocoder({db,origin:ORIGIN});
async function passwordHash(value){const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(value,salt,64)).toString('hex')}
async function passwordOk(value,stored){const [salt,key]=stored.split(':');if(!salt||!key)return false;const calc=await scrypt(value,salt,64), target=Buffer.from(key,'hex');return calc.length===target.length&&timingSafeEqual(calc,target)}
function fail(message,status=400){const e=new Error(message);e.status=status;throw e}
function str(v,max=200){return typeof v==='string'?v.trim().slice(0,max):''}
function number(v,min,max){const n=Number(v);if(!Number.isFinite(n)||n<min||n>max)fail('Проверьте числовые значения');return n}
function cookie(req,name){try{return decodeURIComponent((req.headers.cookie||'').split('; ').find(x=>x.startsWith(name+'='))?.slice(name.length+1)||'')}catch{return ''}}
function session(res,id){const token=randomBytes(32).toString('hex');run('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)',hash(token),id,Date.now()+30*86400000,Date.now());res.cookie('atelie_session',token,{httpOnly:true,secure:SECURE_COOKIE,sameSite:'lax',maxAge:30*86400000,path:'/'});}
function requireUser(req,res,next){if(!req.user)return res.status(401).json({error:'Войдите в аккаунт'});next()}
function requireMaster(req,res,next){if(one('SELECT account_type FROM users WHERE id=?',req.user.id)?.account_type!=='master')return res.status(403).json({error:'Этот раздел доступен аккаунту мастера'});access.ensurePersonal(req.user.id);next()}
function requireClient(req,res,next){if(one('SELECT account_type FROM users WHERE id=?',req.user.id)?.account_type!=='client')return res.status(403).json({error:'Этот раздел доступен аккаунту клиента'});next()}
function profileCategories(id){return q('SELECT category FROM profile_categories WHERE user_id=? ORDER BY rowid',id).map(row=>row.category)}
function profile(id){const p=one('SELECT * FROM profiles WHERE user_id=?',id);return p?{...p,categories:profileCategories(id)}:null}
function requireProfile(req,res,next){if(!profile(req.user.id))return res.status(400).json({error:'Сначала создайте страницу мастера'});next()}
const schedule=schedules({db,fail,relatedMasters:id=>access.relatedIds(id),relatedMasterGroups:ids=>relatedPerformersBatch(db,ids),cityForMaster:id=>profile(id)?.city||personalAddress(id)?.city||''});
function futureAvailability(master){return schedule.availability(master)}
function publicProfile(p,viewer=''){const reviews=q(`SELECT r.id,r.rating,r.text,r.created,a.service FROM reviews r JOIN appointments a ON a.id=r.appointment_id WHERE r.master_id=? ORDER BY r.created DESC LIMIT 20`,p.user_id),rating=one('SELECT ROUND(AVG(rating),1) rating,COUNT(*) count FROM reviews WHERE master_id=?',p.user_id);return {...p,categories:p.categories||profileCategories(p.user_id),following:Boolean(viewer&&one('SELECT 1 FROM follows WHERE user_id=? AND master_id=?',viewer,p.user_id)),rating:rating.rating||null,review_count:rating.count,reviews,services:q('SELECT * FROM services WHERE user_id=?',p.user_id),works:portfolio(p.user_id,viewer),schedule:schedule.config(p.user_id),availability:futureAvailability(p.user_id)}}
const catalogVisibility=`(p.published=1 AND NOT EXISTS (
  SELECT 1 FROM performers person JOIN workspaces salon ON salon.id=person.workspace_id WHERE person.id=p.user_id AND salon.kind='salon'
))`;
function catalogProfile(p,nextAvailable=null){
 const rating=one('SELECT ROUND(AVG(rating),1) rating,COUNT(*) count FROM reviews WHERE master_id=?',p.user_id);
 const salon=one("SELECT w.id,w.slug,w.name,w.city,w.address,w.latitude,w.longitude,w.logo,w.cover,w.utc_offset FROM performers person JOIN workspaces w ON w.id=person.workspace_id WHERE person.id=? AND w.kind='salon'",p.user_id);
 return {...p,...(salon?{kind:'staff',published:1,city:salon.city,address:salon.address,latitude:salon.latitude,longitude:salon.longitude,salon_id:salon.id,salon_slug:salon.slug,salon_name:salon.name,salon_logo:salon.logo,salon_cover:salon.cover}:{}),categories:profileCategories(p.user_id),rating:rating.rating||null,review_count:rating.count,services:q('SELECT * FROM services WHERE user_id=?',p.user_id),works:q('SELECT id,user_id,image,caption,created FROM works WHERE user_id=? ORDER BY pinned DESC,position DESC,created DESC,id DESC LIMIT 1',p.user_id),schedule:{...schedule.config(p.user_id),...(salon?{utc_offset:salon.utc_offset}:{})},next_available:nextAvailable};
}
const vapidFile=path.join(DATA,'vapid.json');
const vapid=fs.existsSync(vapidFile)?JSON.parse(fs.readFileSync(vapidFile,'utf8')):webpush.generateVAPIDKeys();
if(!fs.existsSync(vapidFile))fs.writeFileSync(vapidFile,JSON.stringify(vapid),{mode:0o600});
webpush.setVapidDetails(ORIGIN.startsWith('https:')?ORIGIN:'https://atelie.example',vapid.publicKey,vapid.privateKey);
async function notify(userId,title,body,appointmentId=null){
 if(!one('SELECT 1 FROM users WHERE id=?',userId)){const results=await Promise.all(access.notificationUsers(userId).map(id=>notify(id,title,body,appointmentId)));return {delivered:results.reduce((n,r)=>n+r.delivered,0),subscriptions:results.reduce((n,r)=>n+r.subscriptions,0)}}
 run('INSERT INTO notices(id,user_id,title,body,created,appointment_id) VALUES(?,?,?,?,?,?)',randomUUID(),userId,title,body,Date.now(),appointmentId);
 const kind=one('SELECT account_type FROM users WHERE id=?',userId)?.account_type;
 const noticeUrl=kind==='client'?'/v2/me?tab=notifications'+(appointmentId?'&visit='+encodeURIComponent(appointmentId):''):kind==='salon'?'/v2/salon'+(appointmentId?'?visit='+encodeURIComponent(appointmentId):''):'/v2/calendar'+(appointmentId?'?visit='+encodeURIComponent(appointmentId):'');
 const results=await Promise.all(q('SELECT * FROM pushes WHERE user_id=?',userId).map(async p=>{try{await webpush.sendNotification(JSON.parse(p.subscription),JSON.stringify({title,body,url:noticeUrl}),{TTL:3600,timeout:10000});return true}catch(e){if([404,410].includes(e.statusCode))run('DELETE FROM pushes WHERE endpoint=?',p.endpoint);return false}}));
 return {delivered:results.filter(Boolean).length,subscriptions:results.length};
}
app.disable('x-powered-by');app.set('trust proxy','loopback');
app.use((req,res,next)=>{res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','X-Frame-Options':'DENY','Permissions-Policy':'camera=(), microphone=()','Content-Security-Policy':"default-src 'self'; img-src 'self' blob: data: https://*.tile.openstreetmap.org; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});next()});
app.use('/api',rateLimit({windowMs:60000,limit:180,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много запросов. Подождите минуту.'}}));
app.use(express.json({limit:'64kb'}));
app.use((req,res,next)=>{if(req.path.startsWith('/api/')||req.path.startsWith('/auth/'))res.set('Cache-Control','no-store');if(req.path.startsWith('/auth/')||['/v2/join','/v2/visit','/v2/access'].includes(req.path)){res.set('Referrer-Policy','no-referrer');res.set('Cache-Control','no-store')}if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin!==ORIGIN)return res.status(403).json({error:'Недопустимый источник запроса'});const token=cookie(req,'atelie_session');req.user=token?one('SELECT u.id,u.login FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?',hash(token),Date.now()):null;next()});
const authLimit=rateLimit({windowMs:15*60000,limit:25,message:{error:'Слишком много попыток входа. Попробуйте через 15 минут.'}});
app.get('/api/health',(req,res)=>res.json({ok:true}));
app.get('/api/categories',(req,res)=>res.json(CATEGORIES));
app.get('/api/me',(req,res)=>res.json({user:req.user?one('SELECT id,login,account_type FROM users WHERE id=?',req.user.id):null,profile:req.user?profile(req.user.id)||null:null,workspaces:req.user?access.memberships(req.user.id):[],providers:social.enabled(),client_profile:req.user&&one('SELECT account_type FROM users WHERE id=?',req.user.id)?.account_type==='client'?clientControl.profile(req.user.id):null}));
app.get('/api/geocode',requireUser,requireMaster,rateLimit({windowMs:15*60000,limit:10,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Слишком много поисков адреса. Попробуйте через 15 минут.'}}),async(req,res)=>{const address=str(req.query.address,200),city=str(req.query.city,80);if(city.length<2||!parseAddress(address))fail('Укажите город, улицу и номер дома без квартиры');try{res.json({results:await geocode(city,address)})}catch{fail('Поиск адреса временно недоступен. Попробуйте позже.',502)}});
app.post('/api/auth/register',authLimit,async(req,res)=>{const login=str(req.body.login,32).toLowerCase(),password=str(req.body.password,128),accountType=str(req.body.account_type,20);if(!['client','master','salon'].includes(accountType))fail('Выберите тип аккаунта');if(!/^[a-z0-9_-]{3,32}$/.test(login))fail('Логин: 3–32 латинские буквы, цифры, дефис или подчёркивание');if(password.length<10)fail('Пароль должен содержать минимум 10 символов');if(one('SELECT id FROM users WHERE login=?',login))fail('Этот логин уже занят');const id=randomUUID(), recovery=randomBytes(20).toString('hex');run('INSERT INTO users(id,login,password,recovery,created,account_type) VALUES(?,?,?,?,?,?)',id,login,await passwordHash(password),hash(recovery),Date.now(),accountType);session(res,id);res.status(201).json({recovery,account_type:accountType})});
app.post('/api/auth/login',authLimit,async(req,res)=>{const u=one('SELECT * FROM users WHERE login=?',str(req.body.login,32).toLowerCase());if(!u||!await passwordOk(str(req.body.password,128),u.password))fail('Неверный логин или пароль',401);session(res,u.id);res.json({ok:true})});
app.post('/api/auth/recover',authLimit,async(req,res)=>{const u=one('SELECT * FROM users WHERE login=?',str(req.body.login,32).toLowerCase());if(!u||hash(str(req.body.recovery,100))!==u.recovery)fail('Неверный логин или код восстановления',401);const password=str(req.body.password,128);if(password.length<10)fail('Пароль должен содержать минимум 10 символов');const recovery=randomBytes(20).toString('hex');run('UPDATE users SET password=?,recovery=? WHERE id=?',await passwordHash(password),hash(recovery),u.id);run('DELETE FROM sessions WHERE user_id=?',u.id);session(res,u.id);res.json({recovery})});
app.post('/api/auth/logout',(req,res)=>{run('DELETE FROM sessions WHERE token=?',hash(cookie(req,'atelie_session')));res.clearCookie('atelie_session',{path:'/'});res.json({ok:true})});
app.put('/api/account/password',requireUser,authLimit,async(req,res)=>{const current=str(req.body.current_password,128),next=str(req.body.new_password,128),user=one('SELECT password FROM users WHERE id=?',req.user.id);if(!user||!await passwordOk(current,user.password))fail('Текущий пароль указан неверно',401);if(next.length<10)fail('Новый пароль должен содержать минимум 10 символов');run('UPDATE users SET password=? WHERE id=?',await passwordHash(next),req.user.id);res.json({ok:true})});
app.get('/api/profiles',(req,res)=>{
 const city=str(req.query.city,100).toLowerCase(),category=str(req.query.category,100),term=str(req.query.q,100).toLowerCase();
 const masters=q(`SELECT p.* FROM profiles p WHERE ${catalogVisibility}`).map(p=>{const card=catalogProfile(p);return card.kind==='staff'?card:publicProfile(p,req.user?.id)}).filter(p=>{const categories=p.categories;return (!city||p.city.toLowerCase().includes(city))&&(!category||categories.includes(category))&&(!term||(p.name+' '+p.bio+' '+categories.join(' ')+' '+(p.salon_name||'')).toLowerCase().includes(term))}).slice(0,100);
 const salonCards=q("SELECT * FROM workspaces WHERE kind='salon' AND published=1 AND owner_user_id IS NOT NULL ORDER BY slug LIMIT 100").map(w=>salons.catalog(w,null,category)).filter(p=>(!city||p.city.toLowerCase().includes(city))&&(!category||p.categories.includes(category))&&(!term||[p.name,p.bio,...p.categories,...p.staff.map(s=>s.name)].join(' ').toLowerCase().includes(term)));
 res.json([...masters,...salonCards].slice(0,100));
});
app.get('/api/search/masters',(req,res)=>{
  const term=str(req.query.q,100).toLocaleLowerCase('ru-RU'),category=str(req.query.category,80),requestedLimit=req.query.limit===undefined?24:Number(req.query.limit);
  if(!Number.isInteger(requestedLimit)||requestedLimit<1||requestedLimit>48)fail('Некорректный размер страницы');
  const limit=requestedLimit;
  let cursor=str(req.query.cursor,40),day=null,duration=null;
  if(req.query.date){
    const raw=str(req.query.date,10),match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if(!match)fail('Проверьте дату поиска');
    day=Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3]));
    if(new Date(day).toISOString().slice(0,10)!==raw||day<Date.now()-86400000||day>Date.now()+90*86400000)fail('Выберите дату в ближайшие 90 дней');
    duration=Number(req.query.duration||60);
    if(!Number.isInteger(duration)||duration<15||duration>720)fail('Проверьте длительность услуги');
  }
  if(cursor&&!/^[a-z0-9][a-z0-9-]{2,39}$/.test(cursor))fail('Некорректная страница каталога');
  const promoted=promotionControl.active('catalog',category);
  function matchingCard(entry){
    const p=entry.kind==='salon'?one('SELECT * FROM workspaces WHERE id=?',entry.id):profile(entry.id);
    if(!p || (entry.kind==='salon'?!p.published:!one(`SELECT 1 FROM profiles p WHERE p.user_id=? AND ${catalogVisibility}`,p.user_id)))return null;
    const card=entry.kind==='salon'?salons.catalog(p,null,category):catalogProfile(p),categories=card.categories;
    if(category&&!categories.includes(category))return null;
    if(term&&!([card.name,card.city,card.bio,card.address,...categories,...card.services.map(service=>service.name),...(card.staff||[]).map(s=>s.name)].join(' ').toLocaleLowerCase('ru-RU').includes(term)))return null;
    const matchingStaff=(card.staff||[]).filter(s=>term&&s.name.toLocaleLowerCase('ru-RU').includes(term));
    let nextAvailable=null;
    if(day!==null){
      if(entry.kind==='salon'){
        const midnight=day-p.utc_offset*60000;
        for(const service of salons.groups(p.id,category).filter(s=>s.duration<=duration)){
          const start=salons.availability(p,service,'',{from:midnight,to:midnight+86400000,duration})[0]?.start;
          if(start!=null&&(nextAvailable===null||start<nextAvailable))nextAvailable=start;
        }
      }else{
        if(!one('SELECT 1 FROM services WHERE user_id=? AND duration<=? LIMIT 1',p.user_id,duration))return null;
        const midnight=day-card.schedule.utc_offset*60000;
        nextAvailable=schedule.availability(p.user_id,Date.now(),{from:midnight,to:midnight+86400000,duration})[0]?.start??null;
      }
      if(nextAvailable===null)return null;
    }
    return promotionControl.decorate({...card,matching_staff:matchingStaff,next_available:nextAvailable},promoted);
  }
  // Featured cards are independent of the organic slug cursor. The client
  // removes duplicates when a featured profile also appears on a later page.
  const featured=[];
  if(!cursor)for(const key of promoted.keys()){
    const separator=key.indexOf(':'),card=matchingCard({kind:key.slice(0,separator),id:key.slice(separator+1)});
    if(card)featured.push(card);if(featured.length===3)break;
  }
  const items=[];
  while(items.length<=limit){
    const rows=q(`SELECT p.user_id id,p.slug,'master' kind FROM profiles p WHERE ${catalogVisibility} AND p.slug>?
      UNION ALL SELECT id,slug,'salon' kind FROM workspaces WHERE kind='salon' AND published=1 AND owner_user_id IS NOT NULL AND slug>?
      ORDER BY slug LIMIT 100`,cursor,cursor);
    if(!rows.length)break;
    for(const entry of rows){
      cursor=entry.slug;
      const card=matchingCard(entry);if(!card)continue;
      items.push(card);
      if(items.length>limit)break;
    }
    if(rows.length<100||items.length>limit)break;
  }
  const next=items.length>limit?items[limit-1].slug:null;
  res.json({items:items.slice(0,limit),next,featured});
});
app.get('/api/map/masters',(req,res)=>{
  const term=str(req.query.q,100).toLocaleLowerCase('ru-RU'),category=str(req.query.category,80);
  const rows=q(`SELECT p.user_id,p.slug,p.name,p.city,p.category,p.avatar,p.address,p.latitude,p.longitude,p.teaches
    FROM profiles p WHERE ${catalogVisibility} AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
    AND (?='' OR EXISTS(SELECT 1 FROM profile_categories pc WHERE pc.user_id=p.user_id AND pc.category=?))
    ORDER BY p.slug`,category,category);
  const salonRows=q("SELECT * FROM workspaces WHERE kind='salon' AND published=1 AND owner_user_id IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL ORDER BY slug").map(w=>salons.catalog(w)).filter(p=>!category||p.categories.includes(category)).map(({kind,user_id,slug,name,city,category,categories,address,latitude,longitude,teaches,avatar})=>({kind,user_id,slug,name,city,category,categories,address,latitude,longitude,teaches,avatar}));
  const promoted=promotionControl.active('map',category);
  const results=[...rows.map(p=>({...p,categories:profileCategories(p.user_id)})),...salonRows].filter(p=>!term||[p.name,p.city,p.address,...p.categories].join(' ').toLocaleLowerCase('ru-RU').includes(term)).map(p=>promotionControl.decorate(p,promoted));
  const ranks=new Map([...promoted.keys()].map((key,index)=>[key,index]));
  results.sort((a,b)=>(ranks.get((a.kind||'master')+':'+a.user_id)??Infinity)-(ranks.get((b.kind||'master')+':'+b.user_id)??Infinity)||a.slug.localeCompare(b.slug));
  res.json(results);
});
app.get('/api/profiles/:slug',(req,res)=>{const p=one('SELECT * FROM profiles WHERE slug=?',req.params.slug);if(!p||(!p.published&&p.user_id!==req.user?.id))fail('Страница не найдена',404);res.json(publicProfile(p,req.user?.id))});
app.get('/api/masters/:id/booking',(req,res)=>{const p=profile(req.params.id);if(!p?.published)fail('Мастер не найден',404);res.json({user_id:p.user_id,name:p.name,slug:p.slug,is_demo:p.is_demo,services:q('SELECT * FROM services WHERE user_id=?',p.user_id)})});
app.post('/api/masters/:id/follow',requireUser,(req,res)=>{const p=profile(req.params.id);if(!p?.published)fail('Мастер не найден',404);if(req.params.id===req.user.id)fail('Нельзя подписаться на себя');run('INSERT OR IGNORE INTO follows VALUES(?,?,?)',req.user.id,req.params.id,Date.now());res.json({following:true})});
app.delete('/api/masters/:id/follow',requireUser,(req,res)=>{run('DELETE FROM follows WHERE user_id=? AND master_id=?',req.user.id,req.params.id);res.json({following:false})});
function personalAddress(id){return one("SELECT city,address,latitude,longitude FROM workspaces WHERE id=? AND kind='solo' AND owner_user_id=?",'solo:'+id,id)}
app.put('/api/profile/address',requireUser,requireMaster,(req,res,next)=>addresses.saveLimit(req,res,next),async(req,res)=>{
  const old=profile(req.user.id)||personalAddress(req.user.id),oldState=addresses.snapshot(old);
  const input=req.body,b={city:str(input.city,80),address:str(input.address,200),latitude:input.latitude??null,longitude:input.longitude??null,city_selection:input.city_selection,address_selection:input.address_selection,address_mode:'on-save'};
  if(!b.address)fail('Проверьте адрес: укажите улицу и номер дома');
  const result=await addresses.prepareSave(req,b,old,{recheck:true});
  if(addresses.snapshot(profile(req.user.id)||personalAddress(req.user.id))!==oldState)fail('Адрес изменился в другом окне. Обновите страницу и повторите сохранение',409);
  const lat=b.latitude==null?null:number(b.latitude,-90,90),lng=b.longitude==null?null:number(b.longitude,-180,180);
  if(lat===null||lng===null)fail('Проверьте адрес: не удалось найти точный дом на карте');
  if((lat===null)!==(lng===null))fail('Укажите обе координаты');
  addresses.assertSaved(req,b,old);
  db.exec('BEGIN IMMEDIATE');try{
    run('UPDATE profiles SET city=?,address=?,latitude=?,longitude=? WHERE user_id=?',b.city,b.address,lat,lng,req.user.id);
    run("UPDATE workspaces SET city=?,address=?,latitude=?,longitude=? WHERE id=? AND kind='solo' AND owner_user_id=?",b.city,b.address,lat,lng,'solo:'+req.user.id,req.user.id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  res.json({ok:true,address_result:result||addresses.savedResult(b)});
});
app.put('/api/profile',requireUser,requireMaster,(req,res,next)=>addresses.saveLimit(req,res,next),async(req,res)=>{
  const b=req.body,name=str(b.name,80),slug=str(b.slug,40).toLowerCase();let city=str(b.city,80);
  if(!name||!city&&b.address_mode!=='preserve')fail('Укажите имя и город');
  if(!/^[a-z0-9][a-z0-9-]{2,39}$/.test(slug))fail('Адрес страницы: 3–40 латинских букв, цифр и дефисов');
  const used=one('SELECT user_id FROM profiles WHERE slug=?',slug);
  if(used&&used.user_id!==req.user.id)fail('Этот адрес страницы уже занят');
  if(one('SELECT 1 FROM workspaces WHERE slug=?',slug))fail('Этот адрес страницы уже занят');
  const old=profile(req.user.id),oldState=JSON.stringify(old),addressSource=old||(b.address_mode==='preserve'?personalAddress(req.user.id):null),addressState=addresses.snapshot(addressSource);
  const experience=experienceMonths(b.experience_months,old?.experience_months ?? null);
  const addressResult=await addresses.prepareSave(req,b,addressSource);city=str(b.city,80);
  if(JSON.stringify(profile(req.user.id))!==oldState)fail('Настройки изменились в другом окне. Обновите страницу и повторите сохранение',409);
  if(!old&&b.address_mode==='preserve'&&addresses.snapshot(personalAddress(req.user.id))!==addressState)fail('Адрес изменился в другом окне. Обновите страницу и повторите сохранение',409);
  if(one('SELECT user_id FROM profiles WHERE slug=? AND user_id<>?',slug,req.user.id)||one('SELECT 1 FROM workspaces WHERE slug=?',slug))fail('Этот адрес страницы уже занят');
  const lat=b.latitude===''||b.latitude==null?null:number(b.latitude,-90,90),lng=b.longitude===''||b.longitude==null?null:number(b.longitude,-180,180);
  if((lat===null)!==(lng===null))fail('Укажите обе координаты');
  addresses.assertSaved(req,b,addressSource);
  const selected=Array.isArray(b.categories)?b.categories:[str(b.category,80)||old?.category||'Маникюр'];
  const categories=[...new Set(selected.map(value=>str(value,80)))];
  if(!categories.length||categories.length>CATEGORIES.length+1||categories.some(value=>!value||(!CATEGORIES.includes(value)&&!old?.categories.includes(value))))fail('Выберите направления из списка');
  db.exec('BEGIN IMMEDIATE');
  try{
    run(`INSERT INTO profiles(user_id,slug,name,city,category,bio,theme,avatar,address,latitude,longitude,published,teaches) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET slug=excluded.slug,name=excluded.name,city=excluded.city,category=excluded.category,bio=excluded.bio,theme=excluded.theme,address=excluded.address,latitude=excluded.latitude,longitude=excluded.longitude,published=excluded.published,teaches=excluded.teaches`,req.user.id,slug,name,city,categories[0],str(b.bio,1500),b.theme===undefined?(old?.theme||'cream'):(['cream','wine','green'].includes(b.theme)?b.theme:'cream'),old?.avatar||'',str(b.address,200),lat,lng,b.published===undefined?(old?.published||0):(b.published?1:0),b.teaches===true?1:0);
    run('DELETE FROM profile_categories WHERE user_id=?',req.user.id);
    run('UPDATE profiles SET experience_months=? WHERE user_id=?',experience,req.user.id);
    for(const category of categories)run('INSERT INTO profile_categories(user_id,category) VALUES(?,?)',req.user.id,category);
    run("UPDATE workspaces SET city=?,address=?,latitude=?,longitude=? WHERE id=? AND kind='solo' AND owner_user_id=?",city,str(b.address,200),lat,lng,'solo:'+req.user.id,req.user.id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  res.json({...profile(req.user.id),...(addressResult?{address_result:addressResult}:{})});
});
app.patch('/api/profile/publication',requireUser,requireMaster,requireProfile,(req,res)=>{
  if(typeof req.body.published!=='boolean')fail('Укажите видимость страницы');
  db.exec('BEGIN IMMEDIATE');
  try{
    if(req.body.published){
      const configured=one('SELECT weekdays FROM master_schedules WHERE master_id=?',req.user.id);
      if(!one('SELECT 1 FROM services WHERE user_id=?',req.user.id)||!configured||!JSON.parse(configured.weekdays).length)fail('Добавьте услугу и сохраните график хотя бы с одним рабочим днём');
    }
    run('UPDATE profiles SET published=? WHERE user_id=?',Number(req.body.published),req.user.id);
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  res.json({published:Number(req.body.published)});
});
app.get('/api/studio',requireUser,requireMaster,(req,res)=>{const p=profile(req.user.id),draft=p?null:personalAddress(req.user.id);res.json({profile:p||null,address_draft:draft?.address?draft:null,services:q('SELECT * FROM services WHERE user_id=?',req.user.id),works:portfolio(req.user.id,req.user.id),schedule:schedule.config(req.user.id),schedule_configured:Boolean(one('SELECT 1 FROM master_schedules WHERE master_id=?',req.user.id)),availability:futureAvailability(req.user.id)})});
app.post('/api/services',requireUser,requireProfile,(req,res)=>{const name=str(req.body.name,120);if(!name)fail('Укажите название услуги');if(one('SELECT COUNT(*) n FROM services WHERE user_id=?',req.user.id).n>=100)fail('Не более 100 услуг');const id=randomUUID();run('INSERT INTO services VALUES(?,?,?,?,?)',id,req.user.id,name,Math.round(number(req.body.price,0,1000000)),Math.round(number(req.body.duration,5,720)));res.status(201).json({id})});
app.delete('/api/services/:id',requireUser,(req,res)=>{if(one('SELECT id FROM works WHERE service_id=? AND user_id=? LIMIT 1',req.params.id,req.user.id))fail('Эта услуга связана с работой. Сначала удалите работу или выберите для неё другую услугу.',409);run('DELETE FROM services WHERE id=? AND user_id=?',req.params.id,req.user.id);res.json({ok:true})});
app.put('/api/schedule',requireUser,requireMaster,(req,res)=>res.json(schedule.save(req.user.id,req.body)));
app.post('/api/availability',requireUser,requireProfile,(req,res)=>{const start=Number(req.body.start),end=Number(req.body.end);if(!Number.isFinite(start)||!Number.isFinite(end)||start<Date.now()||end-start<15*60000||end-start>12*3600000)fail('Проверьте время свободного окна');if(one("SELECT id FROM appointments WHERE master_id=? AND status IN ('pending','confirmed') AND start<? AND end>?",req.user.id,end,start))fail('В это время уже есть заявка или запись',409);if(one('SELECT id FROM availability_slots WHERE master_id=? AND start<? AND end>?',req.user.id,end,start))fail('Это свободное окно пересекается с другим окном',409);const id=randomUUID();run('INSERT INTO availability_slots VALUES(?,?,?,?,?)',id,req.user.id,start,end,Date.now());res.status(201).json({id})});
app.delete('/api/availability/:id',requireUser,(req,res)=>{run('DELETE FROM availability_slots WHERE id=? AND master_id=?',req.params.id,req.user.id);res.json({ok:true})});
const publicationControl=publications({app,db,dataDir:DATA,requireUser,requireMaster,requireProfile,fail});
const {hydrate,portfolio,workDetail,isPublicWork,savedWorks}=publicationControl;
migratePerformers(db,{backupDir:path.join(DATA,'migration-backups')});
migrateProfileCover(db,{backupDir:path.join(DATA,'migration-backups')});
const access=workspaceAccess(db);
salonRoutes({app,db,requireUser,fail,schedule,access,categories:CATEGORIES,dataDir:DATA,publications:publicationControl});
salonCalendar({app,db,requireUser,fail,schedule,notify});
const addresses=addressSuggestions({app,db,requireUser,fail,geocode});
const salonPosts=salonContent({app,db,requireUser,fail,publications:publicationControl,backupDir:path.join(DATA,'migration-backups')});
const salons=salonPublic({app,db,requireUser,fail,schedule,geocode,addresses,backupDir:path.join(DATA,'migration-backups'),dataDir:DATA,publications:publicationControl,content:salonPosts});
const promotionControl=promotions({db,categories:CATEGORIES,backupDir:path.join(DATA,'migration-backups')});
mapViewport({app,db,fail,promotionControl,schedule,backupDir:path.join(DATA,'migration-backups')});
const social=socialAuth({app,db,authLimit,fail,session,cookie,hash,str,origin:ORIGIN,secureCookie:SECURE_COOKIE,access,requireUser,passwordOk});
const portraitUpload=createImageUpload({dataDir:DATA,fail});
profileAppearance({app,db,dataDir:DATA,requireUser,requireMaster,requireProfile,fail});
app.get('/api/works/:id',(req,res)=>{const result=workDetail(req.params.id);if(!result||(!result.public_visible&&result.user_id!==req.user?.id&&!access.canManage(req.user?.id,result.user_id)))fail('Работа не найдена',404);const {public_visible,...w}=result;res.json({...hydrate(w),services:q('SELECT * FROM services WHERE user_id=?',w.user_id),saved:Boolean(req.user&&one('SELECT 1 FROM saved_works WHERE user_id=? AND work_id=?',req.user.id,w.id)),following:Boolean(req.user&&one('SELECT 1 FROM follows WHERE user_id=? AND master_id=?',req.user.id,w.user_id))})});
app.post('/api/works/:id/save',requireUser,(req,res)=>{if(!isPublicWork(req.params.id))fail('Работа не найдена',404);run('INSERT OR IGNORE INTO saved_works VALUES(?,?,?)',req.user.id,req.params.id,Date.now());res.json({saved:true})});
app.delete('/api/works/:id/save',requireUser,(req,res)=>{run('DELETE FROM saved_works WHERE user_id=? AND work_id=?',req.user.id,req.params.id);res.json({saved:false})});
app.post('/api/avatar',requireUser,requireMaster,requireProfile,portraitUpload.middleware,async(req,res)=>{
  const before=profile(req.user.id).avatar,next=await portraitUpload.save(req.file,'portrait');
  try{
    db.exec('BEGIN IMMEDIATE');
    try{
      if(profile(req.user.id)?.avatar!==before)fail('Фото изменилось в другом окне. Обновите страницу и повторите загрузку',409);
      run('UPDATE profiles SET avatar=? WHERE user_id=?',next,req.user.id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
  }catch(error){await portraitUpload.removeOwned(next);throw error}
  await portraitUpload.removeOwned(before);
  res.json({ok:true,avatar:next,image:next});
});
app.delete('/api/avatar',requireUser,requireMaster,requireProfile,async(req,res)=>{
  const before=profile(req.user.id).avatar;
  const result=run("UPDATE profiles SET avatar='' WHERE user_id=? AND avatar=?",req.user.id,before);
  if(result.changes!==1)fail('Фото изменилось в другом окне. Обновите страницу и повторите удаление',409);
  await portraitUpload.removeOwned(before);res.json({ok:true,avatar:''});
});
app.get('/api/library',requireUser,(req,res)=>res.json({masters:q(`SELECT p.* FROM follows f JOIN profiles p ON p.user_id=f.master_id WHERE f.user_id=? AND p.published=1 ORDER BY f.created DESC`,req.user.id).map(p=>publicProfile(p,req.user.id)),works:savedWorks(req.user.id)}));
guestBookings({app,db,requireUser,requireClient,notify,fail,validateBooking:schedule.validate,resolveSalonBooking:salons.resolveBooking,bookingOffset:id=>schedule.config(id).utc_offset,recordClientVisit:(...args)=>clientControl.details(...args),clientComment:a=>one('SELECT comment FROM client_visit_details WHERE appointment_id=?',a.id)?.comment||''});
const privateClientDir=path.join(DATA,'private-client');
const clientControl=clientCabinet({app,db,requireUser,requireClient,access,schedule,notify,fail,privateDir:privateClientDir,privateUpload:createImageUpload({dataDir:privateClientDir,fail}),backupDir:path.join(DATA,'migration-backups')});
app.get('/api/appointments',requireUser,(req,res)=>{clientControl.expire();if(one('SELECT account_type FROM users WHERE id=?',req.user.id)?.account_type==='client')return res.set('Cache-Control','private, no-store').json(clientControl.visits(req.user.id));const ids=access.manageableIds(req.user.id);res.json(q(`SELECT a.*,g.contact guest_contact,p.name master_name,p.slug,v.name salon_name,COALESCE(salon.slug,v.slug) salon_slug,v.utc_offset,(SELECT id FROM reschedule_requests rr WHERE rr.appointment_id=a.id AND rr.status='pending') reschedule_request_id,w.image reference_image,w.caption reference_caption,r.id review_id,r.rating review_rating,r.text review_text FROM appointments a LEFT JOIN guest_bookings g ON g.appointment_id=a.id LEFT JOIN profiles p ON p.user_id=a.master_id LEFT JOIN works w ON w.id=a.reference_work_id LEFT JOIN reviews r ON r.appointment_id=a.id LEFT JOIN booking_venues v ON v.appointment_id=a.id LEFT JOIN workspaces salon ON salon.id=v.workspace_id WHERE a.master_id IN (${ids.length?ids.map(()=>'?').join(','):'NULL'}) OR a.client_id=? ORDER BY a.start`,...ids,req.user.id).map(a=>({...a,utc_offset:a.utc_offset??schedule.config(a.master_id).utc_offset}))) });
function checkOverlap(master,start,end,exclude=''){if(one("SELECT id FROM appointments WHERE master_id=? AND status='confirmed' AND start<? AND end>? AND id<>?",master,end,start,exclude))fail('Это время уже занято. Выберите другое.',409)}
app.post('/api/appointments',requireUser,(req,res)=>{const b=req.body,master=str(b.master_id,80)||req.user.id,manual=access.canManage(req.user.id,master),p=profile(master);if(!p||(!p.published&&!manual))fail('Мастер не найден',404);if(p.is_demo)fail('Это демонстрационная страница. Запись недоступна.');const svc=one('SELECT * FROM services WHERE id=? AND user_id=?',str(b.service_id,80),master);if(!manual&&!svc)fail('Выберите услугу');const referenceId=str(b.reference_work_id,80)||null,slotId=str(b.availability_slot_id,80)||'';if(referenceId&&!one('SELECT id FROM works WHERE id=? AND user_id=?',referenceId,master))fail('Работа-референс не найдена');const name=str(b.client_name,100),start=Number(b.start);if(!name)fail('Укажите имя клиента');if(!Number.isFinite(start)||start<Date.now()-86400000||start>Date.now()+366*86400000)fail('Проверьте дату записи');const duration=svc?.duration||number(b.duration,5,720),end=start+duration*60000,status=manual?'confirmed':'pending';db.exec('BEGIN IMMEDIATE');const id=randomUUID();try{if(!one('SELECT 1 FROM performers WHERE id=? AND active=1',master)||manual&&!access.canManage(req.user.id,master)||!manual&&!one('SELECT 1 FROM profiles WHERE user_id=? AND published=1',master))fail('Мастер не найден',404);schedule.validate(master,start,end,{hours:!manual});run('INSERT INTO appointments(id,master_id,client_id,client_name,service,start,end,price,status,notes,reminded,reference_work_id) VALUES(?,?,?,?,?,?,?,?,?,?,0,?)',id,master,manual?null:req.user.id,name,svc?.name||str(b.service,120)||'Личная запись',start,end,svc?.price||Math.round(number(b.price||0,0,1000000)),status,str(b.notes,1000),referenceId);if(!manual)clientControl.details(id,str(b.notes,1000),svc.id);db.exec('COMMIT')}catch(e){db.exec('ROLLBACK');throw e}if(!manual)void notify(master,'Новая заявка',referenceId?'Клиент хочет работу из вашего портфолио. Откройте календарь.':'Клиент хочет записаться. Откройте календарь.');res.status(201).json({id,status})});
appointmentEditing({app,db,requireUser,access,schedule,notify,fail,invalidateRequests:clientControl.invalidate});
app.post('/api/appointments/:id/review',requireUser,requireClient,(req,res)=>{const a=one("SELECT * FROM appointments WHERE id=? AND client_id=? AND status='done'",req.params.id,req.user.id);if(!a)fail('Отзыв доступен после завершённого визита',403);if(one('SELECT id FROM reviews WHERE appointment_id=?',a.id))fail('Вы уже оставили отзыв');const rating=Math.round(number(req.body.rating,1,5)),text=str(req.body.text,1000),id=randomUUID();run('INSERT INTO reviews VALUES(?,?,?,?,?,?,?)',id,a.id,req.user.id,a.master_id,rating,text,Date.now());void notify(a.master_id,'Новый отзыв','Клиент оставил подтверждённый отзыв после визита.');res.status(201).json({id})});
app.get('/api/notices',requireUser,(req,res)=>res.json(q('SELECT * FROM notices WHERE user_id=? ORDER BY created DESC LIMIT 50',req.user.id)));
app.post('/api/push/status',requireUser,(req,res)=>res.json({subscribed:Boolean(one('SELECT 1 FROM pushes WHERE user_id=? AND endpoint=?',req.user.id,str(req.body.endpoint,2000)))}));
app.get('/api/push/key',(req,res)=>res.json({publicKey:vapid.publicKey}));
app.post('/api/push/subscribe',requireUser,(req,res)=>{const s=req.body;let url;try{url=new URL(s.endpoint)}catch{fail('Некорректная подписка')}const allowed=['fcm.googleapis.com','updates.push.services.mozilla.com','web.push.apple.com'];if(url.protocol!=='https:'||url.port||url.username||url.password||!allowed.some(h=>url.hostname===h||url.hostname.endsWith('.'+h)))fail('Этот сервис уведомлений пока не поддерживается');if(!/^[\w-]{60,200}$/.test(s.keys?.p256dh||'')||!/^[\w-]{16,100}$/.test(s.keys?.auth||''))fail('Некорректный ключ подписки');if(one('SELECT COUNT(*) n FROM pushes WHERE user_id=?',req.user.id).n>=10&&!one('SELECT endpoint FROM pushes WHERE endpoint=?',s.endpoint))fail('Не более 10 устройств');run('INSERT INTO pushes VALUES(?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription=excluded.subscription',s.endpoint,req.user.id,JSON.stringify(s));res.json({ok:true})});
app.post('/api/push/test',requireUser,rateLimit({windowMs:60000,limit:3}),async(req,res)=>res.json(await notify(req.user.id,'Luma Beauty на связи','Уведомления о записях будут приходить сюда.')));
app.delete('/api/push/subscribe',requireUser,(req,res)=>{run('DELETE FROM pushes WHERE endpoint=? AND user_id=?',str(req.body.endpoint,2000),req.user.id);res.json({ok:true})});
setInterval(()=>{clientControl.expire();const now=Date.now();for(const a of q("SELECT * FROM appointments WHERE status='confirmed' AND reminded=0 AND start>? AND start<=?",now,now+3600000)){run('UPDATE appointments SET reminded=1 WHERE id=?',a.id);void notify(a.master_id,'Скоро запись','В течение часа начнётся следующая запись.');if(a.client_id)void notify(a.client_id,'Скоро ваш визит','Запись начнётся в течение часа. Подробности — в приложении.',a.id)}run('DELETE FROM sessions WHERE expires<?',now);run('DELETE FROM oauth_states WHERE expires<?',now)},60000).unref();
app.use('/uploads',express.static(path.join(DATA,'uploads'),{maxAge:'30d',immutable:true}),(req,res)=>res.sendStatus(404));
app.get('/',(req,res)=>res.redirect(302,'/v2/'));
app.use(express.static('public',{maxAge:0}));
app.get('/v2/{*path}',(req,res)=>res.sendFile(path.resolve('public/v2/index.html')));
app.get('/v2',(req,res)=>res.sendFile(path.resolve('public/v2/index.html')));
app.get('/{*path}',(req,res)=>{
 if(req.path.startsWith('/api/'))return res.status(404).json({error:'Не найдено'});
 if(/^\/(?:m|w|visit|auth|me|studio|calendar|map|masters)(?:\/|$)/.test(req.path)||/^\/book\//.test(req.path))return res.redirect(302,'/v2'+req.originalUrl);
 if(req.path==='/feed')return res.redirect(302,'/v2/inspiration');
 if(req.path==='/book')return res.redirect(302,'/v2/masters');
 res.redirect(302,'/v2/');
});
app.use((e,req,res,next)=>{if(e instanceof multer.MulterError&&e.code!=='LIMIT_FILE_SIZE')return res.status(400).json({error:'Можно загрузить до 6 фотографий. Проверьте размер и количество файлов.'});if(e.code==='LIMIT_FILE_SIZE')return res.status(413).json({error:'Фотография должна быть меньше 8 МБ'});if(e.status)res.status(e.status).json({error:e.message});else{console.error(e.message);res.status(500).json({error:'Не удалось выполнить действие. Попробуйте ещё раз.'})}});
app.listen(PORT,'127.0.0.1',()=>console.log(`Atelie listening on ${PORT}`));

