// U-10-06: browser API fault injection, isolated synthetic database, no push delivery.
import {chromium, expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

const baseline = process.argv.includes('--baseline');
const root = path.resolve('test-results/professional-push-' + Date.now());
const out = path.resolve('docs/ui-checks/2026-10-19-professional-push');
fs.mkdirSync(root, {recursive:true}); fs.mkdirSync(out, {recursive:true});
fs.cpSync(path.resolve('public'),path.join(root,'public'),{recursive:true,filter:source=>!/[.](mp4|webm)$/i.test(source)});
const origin = 'http://localhost:3266';
try { await fetch(origin+'/api/health'); throw Error('Acceptance port already in use'); }
catch(error) { if (error.message==='Acceptance port already in use') throw error; }
const fixture=path.join(root,'server.mjs');
fs.writeFileSync(fixture,`import {installAddressProvider} from ${JSON.stringify(pathToFileURL(path.resolve('tests/helpers/address-provider.mjs')).href)};installAddressProvider();await import(${JSON.stringify(pathToFileURL(path.resolve('server.mjs')).href)});`);
const child = spawn(process.execPath, [fixture], {cwd:root,env:{...process.env, NODE_ENV:'test', PORT:'3266', DATA_DIR:path.join(root,'data'), APP_ORIGIN:origin, DADATA_API_KEY:'synthetic-push-provider', DADATA_SECRET_KEY:'', PROMOTIONS_ENABLED:'0'}, stdio:['ignore','pipe','pipe']});
let browser, fixtureStopped=false;
const checks=[], errors=[], layouts=[];
child.stdout.resume(); child.stderr.resume();
function pass(name) { checks.push({name,pass:true}); console.log('PASS '+name); }
const publicKey = Buffer.concat([Buffer.from([4]), Buffer.alloc(64,1)]).toString('base64url');
const identities=new Map(), readCache=new Map();
async function api(context,url,body,expected=200,method='POST') {
 const response=await context.request.fetch(origin+'/api'+url,{method,headers:{Origin:origin},data:body});
 assert.equal(response.status(),expected,url); return response.json();
}
async function setup(role,width,scenario) {
 const group=['worker-unavailable','worker-rejected','existing','busy','server-subscribe-error','browser-subscribe-error'].includes(scenario)?'b':'a';
 const identity=role+'-'+width+'-'+group;
 const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce',serviceWorkers:'block',storageState:identities.get(identity)});
 if(!identities.has(identity)) {
 await api(context,'/auth/register',{login:'push-'+identity+'-'+Date.now(),password:'SyntheticPushPassword123',account_type:role},201);
 if(role==='salon') await api(context,'/salons',{name:'Синтетический салон Push',city:'Новосибирск'},201);
 else {
  await api(context,'/profile/address',{city:'Новосибирск',address:'Громова 21'},200,'PUT');
  await api(context,'/profile',{name:'Синтетический мастер Push',slug:'push-'+width+'-'+Date.now(),categories:['Макияж'],address_mode:'preserve',published:false},200,'PUT');
 }
 identities.set(identity,await context.storageState());
 }
 await context.addInitScript(({scenario,endpointId})=>{
  const state={scenario,permissionCalls:0,subscribeCalls:0,subscription:null};
  window.__pushTest=state;
  const subscription={endpoint:'https://fcm.googleapis.com/fcm/send/synthetic-professional-push-'+endpointId,keys:{p256dh:'B'+'a'.repeat(86),auth:'a'.repeat(22)}};
  if(scenario==='insecure') Object.defineProperty(window,'isSecureContext',{value:false,configurable:true});
  Object.defineProperty(window,'PushManager',{value:scenario==='unsupported'?undefined:function(){},configurable:true});
  if(scenario==='unsupported') delete window.PushManager;
  Object.defineProperty(window,'Notification',{value:scenario==='no-notification'?undefined:{requestPermission:async()=>{
   state.permissionCalls++;
   if(state.scenario==='denied') return 'denied';
   if(state.scenario==='dismissed') return 'default';
   return 'granted';
  }},configurable:true});
  const registration={pushManager:{getSubscription:async()=>state.scenario==='existing'?{toJSON:()=>subscription}:state.subscription,subscribe:async()=>{
   state.subscribeCalls++;
   if(state.scenario==='browser-subscribe-error') throw new DOMException('Synthetic subscription failure','AbortError');
   state.subscription={toJSON:()=>subscription}; return state.subscription;
  }}};
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>registration,get ready(){
   if(state.scenario==='worker-unavailable') return new Promise(()=>{});
   if(state.scenario==='worker-rejected') return Promise.reject(new Error('Synthetic worker failure'));
   return Promise.resolve(registration);
  }},configurable:true});
 },{scenario,endpointId:role+'-'+width+'-'+scenario});
 const page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
 // Business read data is unchanged by push subscriptions; reuse genuine fixture GET responses.
 await page.route('**/api/**',async route=>{
  if(route.request().method()!=='GET')return route.continue();
  const key=identity+route.request().url();
  if(!readCache.has(key)){const r=await route.fetch();readCache.set(key,{status:r.status(),contentType:'application/json',body:await r.body()});}
  await route.fulfill(readCache.get(key));
 });
 let keys=0,posts=0,fail=true,release;
 await page.route('**/api/push/key',async route=>{
  keys++;
  if(scenario==='busy') await new Promise(resolve=>{release=resolve});
  if(scenario==='network-error'&&fail) {fail=false;return route.abort('failed');}
  if(scenario==='key-error'&&fail) {fail=false;return route.fulfill({status:503,json:{error:'Ключ уведомлений временно недоступен.'}});}
  return route.fulfill({json:{publicKey:scenario==='invalid-key'&&fail?(fail=false,'bad-key'):publicKey}});
 });
 await page.route('**/api/push/subscribe',async route=>{
  posts++;
  if(scenario==='server-subscribe-error'&&fail) {fail=false;return route.fulfill({status:503,json:{error:'Не удалось сохранить подписку.'}});}
  return route.continue();
 });
 await page.goto(origin+'/v2/'+(role==='master'?'studio?tab=settings':'salon'));
 if(role==='salon') {
  await page.getByRole('button',{name:'Меню профиля',exact:true}).click();
  await page.getByRole('button',{name:'Настройки аккаунта',exact:true}).click();
 }
 const button=page.getByRole('button',{name:/^(Включить уведомления|Включаем…)$/});
 await expect(button).toBeVisible();
 const status=page.locator(role==='master'?'.settings-aside':'.salon-account-settings').getByRole('status');
 return {page,context,button,status,get keys(){return keys},get posts(){return posts},release:()=>release?.()};
}
try {
 for(let i=0;i<100;i++){try{if((await fetch(origin+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'chrome',headless:true});
 if(baseline){
  const a=await setup('master',390,'worker-unavailable'); await a.button.click();
  await new Promise(r=>setTimeout(r,10000)); assert.equal(await a.button.isDisabled(),true); pass('baseline-worker-ready-hangs-for-10-seconds'); await a.context.close();
  const b=await setup('master',390,'no-notification'); await b.button.click(); await expect(b.status).toContainText('requestPermission'); pass('baseline-missing-notification-exposes-technical-error'); await b.context.close();
 } else {
  for(const width of [1440,390,320]) for(const role of ['master','salon']) {
   for(const scenario of ['unsupported','insecure','no-notification','denied','dismissed','key-error','invalid-key','network-error','browser-subscribe-error','server-subscribe-error','worker-unavailable','worker-rejected','existing','busy']) {
    const t=await setup(role,width,scenario), {page,button}=t; await button.click();
    if(scenario==='busy') {
     await expect(button).toBeDisabled(); await expect(button).toHaveText('Включаем…');
     await button.evaluate(node=>{node.click();node.click()});
     assert.equal(t.keys,1); t.release();
    }
    const status=t.status;
    await expect(status).toBeVisible({timeout:12000}); await expect(button).toBeEnabled();
    const message=await status.innerText();
    if(['existing','busy'].includes(scenario)) {assert.equal(message,'Уведомления включены.');assert.equal(t.posts,1);}
    else {assert.match(message,/[А-Яа-я]/);assert.doesNotMatch(message,/undefined|requestPermission|Synthetic|Failed to fetch/);assert.notEqual(message,'Уведомления включены.');}
    assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0,'message does not overflow');
    if((scenario==='worker-unavailable'&&width===390)||(scenario==='insecure'&&width===320)) await page.screenshot({path:path.join(out,role+'-'+width+'-'+scenario+'.png'),fullPage:true});
    if(['unsupported','insecure','no-notification','denied','dismissed','worker-unavailable','worker-rejected'].includes(scenario)) {assert.equal(t.keys,0);assert.equal(t.posts,0);}
    if(['key-error','invalid-key','network-error','server-subscribe-error','browser-subscribe-error','worker-unavailable','worker-rejected','denied','dismissed'].includes(scenario)) {
     await page.evaluate(()=>{window.__pushTest.scenario='success'});
     await button.click(); await expect(status).toHaveText('Уведомления включены.'); await expect(button).toBeEnabled();
     assert.equal(t.posts,scenario==='server-subscribe-error'?2:1);
     if(scenario==='server-subscribe-error') assert.equal(await page.evaluate(()=>window.__pushTest.subscribeCalls),1);
    }
    if(scenario==='existing') {
     assert.equal(await page.evaluate(()=>window.__pushTest.subscribeCalls),0);
     await button.click(); await expect(status).toHaveText('Уведомления включены.'); assert.equal(t.posts,2);
     await page.reload(); await expect(button).toBeVisible();
    }
    const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)); assert.equal(overflow,0);
    const box=await button.boundingBox();assert.ok(box.width>=44&&box.height>=44);
    assert.equal(await page.locator('.bottom-nav').count(),0);
    if(scenario==='busy') {await page.screenshot({path:path.join(out,role+'-'+width+'.png'),fullPage:true});layouts.push({role,width,overflow,button:box});}
    pass(role+'-'+width+'-'+scenario+'-message-retry-layout'); await t.context.close();
   }
  }
  assert.deepEqual(errors,[]);pass('no-unhandled-javascript-errors');
  const db=new DatabaseSync(path.join(root,'data','atelie.sqlite'));
  try {assert.equal(db.prepare('SELECT count(*) n FROM pushes').get().n,66);pass('subscriptions-persist-without-duplicate-endpoints');}finally{db.close()}
 }
} catch(error) {checks.push({name:'acceptance',pass:false,message:error.message});console.error(error);process.exitCode=1;}
finally {
 await browser?.close();
 if(child.exitCode===null&&child.signalCode===null){const done=new Promise(r=>child.once('exit',r));child.kill();await done;}
 fixtureStopped=child.exitCode!==null||child.signalCode!==null;
 const db=new DatabaseSync(path.join(root,'data','atelie.sqlite'));
 try {assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);pass('fixture-stopped-database-integrity-and-foreign-keys');}finally{db.close()}
 fs.writeFileSync(path.join(out,baseline?'baseline.json':'report.json'),JSON.stringify({at:new Date().toISOString(),scope:'U-10-06; browser API simulation, synthetic SQLite; no physical push delivery',root,fixtureStopped,checks,errors,layouts},null,2)+'\n');
 console.log(checks.filter(x=>x.pass).length+'/'+checks.length);
}
