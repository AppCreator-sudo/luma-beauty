import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

test('public salon rating, saved collection, owner flags/palette and master models persist with role isolation',async t=>{
  const root=path.resolve('.cache/profile-page-http-'+Date.now()),origin='http://localhost:3263';
  const child=spawn(process.execPath,['tests/fixtures/map-reference-server.mjs'],{env:{...process.env,LUMA_MAP_TEST_ROOT:root,LUMA_MAP_TEST_PORT:'3263'},stdio:['ignore','pipe','pipe']});
  let logs='',db;child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v);
  t.after(async()=>{db?.close();child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));});
  for(let i=0;i<200&&!fs.existsSync(path.join(root,'manifest.json'));i++)await new Promise(resolve=>setTimeout(resolve,100));
  assert.ok(fs.existsSync(path.join(root,'manifest.json')),logs);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  db=new DatabaseSync(path.join(root,'data/atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
  const salon=manifest.salon,master=manifest.free;
  function session(id){const token=randomUUID();db.prepare('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000,Date.now());return 'atelie_session='+token}
  function client(){const id=randomUUID();db.prepare("INSERT INTO users(id,login,password,recovery,created,account_type) VALUES(?,?,'disabled','disabled',?,'client')").run(id,'profile-test-'+id,Date.now());return {id,cookie:session(id)}}
  const a=client(),b=client(),ownerId=db.prepare('SELECT owner_user_id id FROM workspaces WHERE id=?').get(salon.id).id,owner=session(ownerId),personal=session(master.id);
  async function call(url,method='GET',body,cookie=''){const r=await fetch(origin+'/api'+url,{method,headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()}}
  const getSalon=()=>call('/public/salons/'+salon.slug,'GET',undefined,a.cookie);
  const initial=await getSalon();assert.equal(initial.status,200);assert.equal(initial.data.rating,4.5);assert.equal(initial.data.review_count,2);assert.equal(initial.data.reviews.length,2);assert.equal(initial.data.saved,false);
  assert.equal((await call('/salons/'+salon.id+'/save','POST',{},'')).status,401);
  for(let i=0;i<2;i++)assert.equal((await call('/salons/'+salon.id+'/save','POST',{},a.cookie)).status,200);
  assert.equal((await getSalon()).data.saved,true);
  assert.equal((await call('/library','GET',undefined,a.cookie)).data.salons.length,1);
  assert.equal((await call('/library','GET',undefined,b.cookie)).data.salons.length,0);
  const exported=await call('/client/data','GET',undefined,a.cookie);assert.equal(exported.data.salons[0].salon_id,salon.id);
  assert.equal((await call('/salons/'+salon.id+'/save','DELETE',{},b.cookie)).status,200);assert.equal((await getSalon()).data.saved,true);
  const w=db.prepare('SELECT * FROM workspaces WHERE id=?').get(salon.id);
  const body={name:w.name,slug:w.slug,bio:w.bio,address_mode:'preserve',utc_offset:w.utc_offset,published:Boolean(w.published),theme:'wine',teaches:true,looking_models:true};
  assert.equal((await call('/salons/'+salon.id+'/page','PUT',body,a.cookie)).status,404);
  assert.equal((await call('/salons/'+salon.id+'/page','PUT',{...body,looking_models:'false'},owner)).status,400);
  const saved=await call('/salons/'+salon.id+'/page','PUT',body,owner);assert.equal(saved.status,200,JSON.stringify(saved.data));
  const current=(await getSalon()).data;assert.equal(current.theme,'wine');assert.equal(current.teaches,1);assert.equal(current.looking_models,1);assert.equal(current.address,w.address);
  const catalog=await call('/search/masters?q='+encodeURIComponent(w.name));const card=catalog.data.items.find(p=>p.user_id===salon.id);assert.equal(card.teaches,1);assert.equal(card.rating,current.rating);
  const profile=db.prepare('SELECT * FROM profiles WHERE user_id=?').get(master.id);
  const pbody={name:profile.name,slug:profile.slug,bio:profile.bio,categories:[profile.category],teaches:true,looking_models:true,address_mode:'preserve'};
  const savedMaster=await call('/profile','PUT',pbody,personal);assert.equal(savedMaster.status,200,JSON.stringify(savedMaster.data));
  assert.equal((await call('/profiles/'+master.slug)).data.looking_models,1);
  assert.equal((await call('/profile/appearance','PATCH',{theme:'wine'},personal)).status,200);
  assert.equal((await call('/profiles/'+master.slug)).data.theme,'wine');
  assert.equal((await call('/masters/'+master.id+'/follow','POST',{},a.cookie)).status,200);
  const library=(await call('/library','GET',undefined,a.cookie)).data;assert.equal(library.masters.length,1);assert.equal(library.salons.length,1);
  // A pending visit cannot contribute a score; staff moves cannot reassign old salon reviews.
  const staff=manifest.salonStaff.id;
  db.prepare("UPDATE appointments SET status='pending' WHERE master_id=?").run(staff);
  assert.equal((await getSalon()).data.rating,null);assert.equal((await getSalon()).data.reviews.length,0);
  db.prepare("UPDATE appointments SET status='done' WHERE master_id=?").run(staff);
  db.prepare('UPDATE performers SET active=0 WHERE id=?').run(staff);
  assert.equal((await getSalon()).data.rating,4.5);
  db.prepare('UPDATE workspaces SET published=0 WHERE id=?').run(salon.id);
  assert.equal((await getSalon()).status,404);assert.equal((await call('/library','GET',undefined,a.cookie)).data.salons.length,0);
  assert.equal((await call('/salons/'+salon.id+'/save','POST',{},b.cookie)).status,404);
  assert.equal((await call('/salons/'+salon.id+'/save','DELETE',{},a.cookie)).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM saved_salons WHERE user_id=?').get(a.id).n,0);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  console.log('Profile HTTP checks use only synthetic .cache data; no production requests.');
});
