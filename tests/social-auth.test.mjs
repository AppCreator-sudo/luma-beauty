import {test} from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import {socialAuth} from '../lib/social-auth.mjs';

async function fixture(t){
  const db=new DatabaseSync(':memory:');
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE oauth_states(state TEXT PRIMARY KEY,expires INTEGER NOT NULL,verifier TEXT);
    CREATE TABLE users(id TEXT PRIMARY KEY,login TEXT UNIQUE,password TEXT,recovery TEXT,created INTEGER,account_type TEXT);
    CREATE TABLE identities(provider TEXT,subject TEXT,user_id TEXT REFERENCES users(id),PRIMARY KEY(provider,subject));
    CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER);`);
  const app=express();app.use(express.json());
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const origin='http://127.0.0.1:'+server.address().port;
  t.after(()=>{server.close();db.close()});
  const hash=v=>createHash('sha256').update(v).digest('hex');
  const cookie=(req,name)=>(req.headers.cookie||'').split('; ').find(v=>v.startsWith(name+'='))?.slice(name.length+1)||'';
  app.use((req,res,next)=>{
    res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
    if(req.method==='POST'&&req.headers.origin!==origin)return res.sendStatus(403);
    req.user=db.prepare('SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>?').get(hash(cookie(req,'atelie_session')),Date.now());next();
  });
  const calls=[];let gate=null;let available=true;
  const providers=Object.fromEntries(['yandex','vk','telegram'].map(name=>[name,{ready:()=>available,authorize:params=>'https://example.org/'+name+'?'+new URLSearchParams(params),subject:async args=>{calls.push({name,...args});if(gate)await gate;if(args.code==='fail')throw Error('PRIVATE_SECRET_TOKEN');return args.code}}]));
  socialAuth({app,db,authLimit:(req,res,next)=>next(),requireUser:(req,res,next)=>req.user?next():res.sendStatus(401),passwordOk:async(value,stored)=>value==='test-password'&&stored==='salt:key',fail:(message,status=400)=>{throw Object.assign(new Error(message),{status})},hash,str:v=>typeof v==='string'?v:'',origin,secureCookie:true,access:{memberships:id=>id==='staff-account'?[{kind:'salon'}]:[]},cookie,session:(res,id)=>{
    const token=randomBytes(32).toString('hex');db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,Date.now()+86400000,Date.now());res.cookie('atelie_session',token,{httpOnly:true,secure:true,sameSite:'lax',path:'/'});
  },providers});
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  function client(){
    const jar={};
    return {jar,async request(path,body,options={}){
      const response=await fetch(origin+path,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Origin:origin,Cookie:Object.entries(jar).map(([k,v])=>k+'='+v).join('; '),...options.headers},body:body===undefined?undefined:JSON.stringify(body)});
      for(const value of response.headers.getSetCookie()){const [name,data]=value.split(';')[0].split('=');if(data)jar[name]=data;else delete jar[name]}
      return response;
    },async start(name,body={},link=false){
      const response=await this.request((link?'/api/account/access/':'/api/auth/')+name+'/start',body);assert.equal(response.status,200);
      const url=(await response.json()).url;return {state:new URL(url).searchParams.get('state'),url,cookie:response.headers.get('set-cookie')};
    },finish(name,state,code='identity'){return this.request('/auth/'+name+'/callback?'+new URLSearchParams({state,code}))}};
  }
  function seed(id,role='client'){
    db.prepare('INSERT INTO users VALUES(?,?,?,?,?,?)').run(id,id,'salt:key','recovery',Date.now(),role);
    const c=client(),token=randomBytes(32).toString('hex');c.jar.atelie_session=token;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(token),id,Date.now()+86400000,Date.now());return c;
  }
  return {db,hash,client,seed,calls,block:()=>{let resolve;gate=new Promise(r=>{resolve=r});return ()=>{gate=null;resolve()}},disable:()=>{available=false}};
}

test('All providers preserve each account type and private invitations; returning users retain identity and role',async t=>{
  const {db,client,hash}=await fixture(t);
  for(const provider of ['yandex','vk','telegram'])for(const role of ['client','master','salon']){
    const c=client(),invitation='/v2/join#'+'a'.repeat(64),start=await c.start(provider,{account_type:role,next:invitation});
    assert.match(start.cookie,/HttpOnly/);assert.match(start.cookie,/Secure/);assert.match(start.cookie,/SameSite=Lax/);assert.match(start.cookie,/Path=\/auth/);
    assert.ok(!start.url.includes(invitation));const row=db.prepare('SELECT * FROM oauth_states WHERE state=?').get(hash(start.state));
    assert.equal(row.next_path,invitation);assert.equal(row.account_type,role);assert.equal(row.provider,provider);
    assert.equal(new URL(start.url).searchParams.get('code_challenge'),createHash('sha256').update(row.verifier).digest('base64url'));
    assert.ok(!start.url.includes(row.verifier));
    const id=provider+'-'+role,result=await c.finish(provider,start.state,id);
    assert.equal(result.status,302);assert.equal(result.headers.get('location'),invitation);assert.equal(result.headers.get('cache-control'),'no-store');
    assert.equal(result.headers.get('referrer-policy'),'no-referrer');assert.match(result.headers.get('set-cookie'),/HttpOnly/);
    const account=db.prepare('SELECT u.* FROM users u JOIN identities i ON i.user_id=u.id WHERE i.provider=? AND i.subject=?').get(provider,id);
    assert.equal(account.account_type,role);assert.equal(account.password,'disabled');
    const again=client(),s=await again.start(provider,{account_type:'salon',next:'https://evil.example/'}),r=await again.finish(provider,s.state,id);
    assert.equal(r.headers.get('location'),'/v2/'+(role==='master'?'studio':role==='salon'?'salon':'me'));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM identities WHERE provider=? AND subject=?').get(provider,id).n,1);
  }
  assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,9);
});

test('State rejects wrong browser/provider, expiry, replay, superseded attempts and callback races without leaking provider errors',async t=>{
  const f=await fixture(t),c=f.client(),s=await c.start('yandex');
  assert.equal((await f.client().finish('yandex',s.state)).headers.get('location'),'/v2/auth?auth_error=expired');
  assert.equal((await c.finish('vk',s.state)).headers.get('location'),'/v2/auth?auth_error=expired');assert.equal(f.calls.length,0);
  const release=f.block();const first=c.finish('yandex',s.state,'racing');
  while(!f.calls.length)await new Promise(r=>setTimeout(r,5));
  const replay=await c.finish('yandex',s.state,'racing');assert.equal(replay.headers.get('location'),'/v2/auth?auth_error=expired');release();
  assert.equal((await first).status,302);assert.equal(f.calls.length,1);assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  const other=f.client(),old=await other.start('vk'),next=await other.start('telegram');
  assert.equal((await other.finish('vk',old.state)).headers.get('location'),'/v2/auth?auth_error=expired');
  assert.equal((await other.finish('telegram',next.state,'fail')).headers.get('location'),'/v2/auth?auth_error=provider');
  const cancelled=await other.start('telegram');const r=await other.request('/auth/telegram/callback?state='+cancelled.state+'&error=PRIVATE_SECRET_TOKEN');
  assert.equal(r.headers.get('location'),'/v2/auth?auth_error=cancelled');assert.ok(!(await r.text()).includes('PRIVATE_SECRET_TOKEN'));
  const expired=await other.start('vk');f.db.exec('UPDATE oauth_states SET expires=0');
  assert.equal((await other.finish('vk',expired.state)).headers.get('location'),'/v2/auth?auth_error=expired');
  const invited=await other.start('vk',{next:'/v2/join#'+'b'.repeat(64)});
  const denied=await other.request('/auth/vk/callback?state='+invited.state+'&error=denied');
  assert.equal(denied.headers.get('location'),'/v2/join?auth_error=cancelled#'+'b'.repeat(64));
  assert.equal(new URL(denied.headers.get('location'),'https://site.example').searchParams.has('next'),false);
  f.disable();assert.equal((await other.request('/api/auth/vk/start',{})).status,503);
});

test('Reserve login requires the original live session; no account merging, account replacement or duplicate signup on linking',async t=>{
  const f=await fixture(t),c=f.seed('owner','salon');
  assert.equal((await f.client().request('/api/account/access/telegram/start',{})).status,401);
  assert.equal((await c.request('/api/auth/telegram/start',{})).status,409);
  assert.equal((await c.request('/api/account/access/telegram/start',{}, {headers:{Origin:'https://evil.example'}})).status,403);
  const s=await c.start('telegram',{},true),result=await c.finish('telegram',s.state,'tg-owner');
  assert.equal(result.headers.get('location'),'/v2/access?linked=telegram');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
  assert.equal(f.db.prepare('SELECT user_id FROM identities').get().user_id,'owner');
  const fresh=f.client(),login=await fresh.start('telegram'),signed=await fresh.finish('telegram',login.state,'tg-owner');assert.equal(signed.headers.get('location'),'/v2/salon');
  assert.equal((await c.request('/api/account/access/telegram/start',{})).status,409);
  const other=f.seed('other'),taken=await other.start('telegram',{},true);assert.equal((await other.finish('telegram',taken.state,'tg-owner')).headers.get('location'),'/v2/access?auth_error=conflict');
  assert.equal(f.db.prepare('SELECT user_id FROM identities').get().user_id,'owner');
  const swapped=await c.start('vk',{},true);c.jar.atelie_session=other.jar.atelie_session;
  const callCount=f.calls.length;assert.equal((await c.finish('vk',swapped.state,'vk-identity')).headers.get('location'),'/v2/access?auth_error=session');assert.equal(f.calls.length,callCount);
  const loggedOut=await other.start('vk',{},true);delete other.jar.atelie_session;
  assert.equal((await other.finish('vk',loggedOut.state)).headers.get('location'),'/v2/access?auth_error=session');
  const revoked=f.seed('revoked'),pending=await revoked.start('vk',{},true),release=f.block();
  const callback=revoked.finish('vk',pending.state,'vk-revoked');
  while(f.calls.length===callCount)await new Promise(r=>setTimeout(r,5));
  f.db.prepare('DELETE FROM sessions WHERE user_id=?').run('revoked');release();
  assert.equal((await callback).headers.get('location'),'/v2/access?auth_error=session');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identities WHERE user_id=?').get('revoked').n,0);
});

test('Access responses contain no identities/tokens; session revocation retains this device and employee login routes to salon',async t=>{
  const f=await fixture(t),c=f.seed('staff-account');f.db.prepare('INSERT INTO identities VALUES(?,?,?)').run('yandex','private-subject','staff-account');
  const another=randomBytes(32).toString('hex');f.db.prepare('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)').run(f.hash(another),'staff-account',Date.now()+100000);
  const response=await c.request('/api/account/access'),data=await response.json();
  assert.deepEqual(data,{password:true,recent:true,providers:[{id:'yandex',ready:true,linked:true},{id:'vk',ready:true,linked:false},{id:'telegram',ready:true,linked:false}]});
  assert.ok(!JSON.stringify(data).includes('private-subject'));assert.ok(!JSON.stringify(data).includes(c.jar.atelie_session));
  await c.start('vk',{},true);assert.equal((await c.request('/api/account/sessions/revoke',{})).status,200);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM oauth_states').get().n,0);
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').get('staff-account').n,1);
  assert.equal((await c.request('/api/account/access')).status,200);
  const fresh=f.client(),s=await fresh.start('yandex');assert.equal((await fresh.finish('yandex',s.state,'private-subject')).headers.get('location'),'/v2/salon');
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('Adding reserve access requires recent authentication by existing provider or current password, including after network delay',async t=>{
  const f=await fixture(t),c=f.seed('existing');
  f.db.prepare('INSERT INTO identities VALUES(?,?,?)').run('yandex','ya-existing','existing');
  f.db.exec('UPDATE sessions SET authenticated_at=0');
  assert.equal((await c.request('/api/account/access/telegram/start',{})).status,403);
  assert.equal((await c.request('/api/account/access/telegram/reauth',{})).status,403);
  assert.equal((await c.request('/api/account/access/password/reauth',{password:'wrong'})).status,401);
  assert.equal((await c.request('/api/account/access/password/reauth',{password:'test-password'})).status,200);
  assert.equal((await (await c.request('/api/account/access')).json()).recent,true);
  const pending=await c.start('telegram',{},true),release=f.block(),result=c.finish('telegram',pending.state,'new-tg');
  while(!f.calls.length)await new Promise(r=>setTimeout(r,5));f.db.exec('UPDATE sessions SET authenticated_at=0');release();
  assert.equal((await result).headers.get('location'),'/v2/access?auth_error=session');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM identities').get().n,1);
  async function reauth(code){const r=await c.request('/api/account/access/yandex/reauth',{});assert.equal(r.status,200);const url=(await r.json()).url;assert.equal(new URL(url).searchParams.get('prompt'),'login');return c.finish('yandex',new URL(url).searchParams.get('state'),code)}
  assert.equal((await reauth('different-user')).headers.get('location'),'/v2/access?auth_error=conflict');
  assert.equal((await (await c.request('/api/account/access')).json()).recent,false);
  assert.equal((await reauth('ya-existing')).headers.get('location'),'/v2/access?verified=1');
  assert.equal((await (await c.request('/api/account/access')).json()).recent,true);
  const s=await c.start('telegram',{},true);assert.equal((await c.finish('telegram',s.state,'new-tg')).headers.get('location'),'/v2/access?linked=telegram');
  assert.equal(f.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
});
