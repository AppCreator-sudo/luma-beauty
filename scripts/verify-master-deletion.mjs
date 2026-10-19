// BUG-008: DELETE acceptance against a fresh synthetic local database.
// Run after the frontend build; LUMA_DELETION_BEFORE_FIX=1 records the original defect.
import {chromium,expect} from '@playwright/test';
import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root=path.resolve('.cache/bug008-deletion-'+Date.now());
assert.ok(root.startsWith(path.resolve('.cache')+path.sep));
fs.mkdirSync(root,{recursive:true});
const port=String(process.env.LUMA_DELETION_PORT||'3262');
assert.match(port,/^\d+$/);assert.ok(+port>=1024&&+port<=65535);
const origin='http://localhost:'+port;
try {await fetch(origin+'/api/health');throw Error('Local deletion port is already in use');}
catch(error){if(error.message==='Local deletion port is already in use')throw error;}
const beforeFix=process.env.LUMA_DELETION_BEFORE_FIX==='1';
const widths=beforeFix?[390]:[1440,390,320];
const prefix=beforeFix?'before-fix-':'';
const out=path.resolve('docs/ui-checks/2026-10-15-master-deletion');
fs.mkdirSync(out,{recursive:true});
const fixture=path.join(root,'server.mjs');
fs.writeFileSync(fixture,`import {installAddressProvider} from ${JSON.stringify(pathToFileURL(path.resolve('tests/helpers/address-provider.mjs')).href)};installAddressProvider();await import(${JSON.stringify(pathToFileURL(path.resolve('server.mjs')).href)});\n`);
const child=spawn(process.execPath,[fixture],{env:{...process.env,PORT:port,DATA_DIR:path.join(root,'data'),APP_ORIGIN:origin,NODE_ENV:'test',DADATA_API_KEY:'synthetic-deletion-provider',DADATA_SECRET_KEY:'',ADDRESS_DAILY_LIMIT:'9000',PROMOTIONS_ENABLED:'0'},stdio:['ignore','pipe','pipe']});
let logs='',browser,page,current='startup',fixtureStopped=false;
const checks=[],pageErrors=[],layouts=[],observations=[];
child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);
function report(){fs.writeFileSync(path.join(out,prefix+'report.json'),JSON.stringify({at:new Date().toISOString(),mode:beforeFix?'before-fix reproduction':'acceptance',scope:'BUG-008 only; fresh synthetic SQLite and fake existing address provider; no production access or credentials recorded',origin,fixture:root,fixtureStopped,widths,checks,pageErrors,layouts,observations},null,2)+'\n');}
function pass(name){checks.push({name,pass:true});report();console.log('PASS '+name);}
async function api(context,url,body,method=body===undefined?'GET':'POST',expected=200){const response=await context.request.fetch(origin+'/api'+url,{method,headers:{Origin:origin},...(body===undefined?{}:{data:body})});assert.equal(response.status(),expected,url+' returned '+response.status());return response.json();}
async function upload(context,serviceId,caption,image){const response=await context.request.post(origin+'/api/works',{headers:{Origin:origin},multipart:{caption,service_id:serviceId,image:{name:'synthetic.png',mimeType:'image/png',buffer:image}}});assert.equal(response.status(),201,'Synthetic portfolio upload');return response.json();}
async function prepare(context,width,label,image){
 await api(context,'/auth/register',{login:'delete-'+label+'-'+width,password:'SyntheticDeletionPassword123',account_type:'master'},'POST',201);
 await api(context,'/profile/address',{city:'Новосибирск',address:'Громова 21'},'PUT');
 await api(context,'/profile',{name:'Проверка удаления '+label,slug:'delete-'+label+'-'+width,categories:['Макияж'],address_mode:'preserve',published:false},'PUT');
 const service=await api(context,'/services',{name:'Синтетическая услуга '+label,price:1800,duration:60,category:'Макияж'},'POST',201);
 const linked=await api(context,'/services',{name:'Услуга с работой '+label,price:2500,duration:90,category:'Макияж'},'POST',201);
 const work=await upload(context,linked.id,'Синтетическая работа '+label,image);
 await upload(context,linked.id,'Сохранённая работа '+label,image);
 const visit=await api(context,'/appointments',{service_id:service.id,client_name:'Синтетический визит',start:Date.now()+48*3600000,notes:'Изолированная проверка сохранности визита'},'POST',201);
 return {service,linked,work,visit};
}
function rowFor(kind,name){return kind==='service'?page.locator('.cabinet-service-item').filter({has:page.getByRole('heading',{name,exact:true})}):page.locator('.studio-work-grid article').filter({has:page.locator('p').filter({hasText:name})});}
function deleteButton(row,kind,name){return row.getByRole('button',{name:kind==='service'?'Удалить услугу '+name:'Удалить работу',exact:true});}
async function goto(kind){await page.goto(origin+'/v2/studio?tab='+(kind==='service'?'services':'works'));await expect(page.locator(kind==='service'?'.studio-services-panel':'.studio-works-panel')).toBeVisible();}
async function confirmedClick(button,accept=true){page.once('dialog',dialog=>accept?dialog.accept():dialog.dismiss());await button.click();}
async function capture(name){
 await page.evaluate(()=>document.fonts.ready);
 const overflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
 assert.equal(overflow,0,name+' horizontal overflow');
 const actions=await page.locator('.cabinet-service-remove,.studio-work-grid article button').evaluateAll(nodes=>nodes.map(node=>({label:node.getAttribute('aria-label'),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})).filter(node=>node.width&&node.height));
 assert.ok(actions.length,name+' delete actions are present');
 assert.ok(actions.every(node=>node.width>=44&&node.height>=44),name+' deletion targets must be at least 44 px');
 layouts.push({name,horizontalOverflow:overflow,actions});
 await page.screenshot({path:path.join(out,prefix+name+'.png'),fullPage:true});pass(name+'-layout');
}
async function unchanged(context,foreign,snapshot,ownBaseline){
 assert.deepEqual(await api(context,'/appointments'),ownBaseline,'Deleting objects must preserve existing visits');
 assert.deepEqual(await api(foreign,'/studio'),snapshot.studio,'Another master keeps all objects');
 assert.deepEqual(await api(foreign,'/appointments'),snapshot.visits,'Another master keeps visits');
}
async function objectStillExists(context,kind,id){const studio=await api(context,'/studio');assert.ok(studio[kind==='service'?'services':'works'].some(item=>item.id===id),kind+' must remain after cancellation/failure');}
async function failDelete(context,kind,id,name,width,mode){
 const url=origin+'/api/'+(kind==='service'?'services/':'works/')+id;
 const row=rowFor(kind,name),button=deleteButton(row,kind,name);
 let requests=0,release;
 const gate=mode==='delayed-double'?new Promise(resolve=>{release=resolve}):null;
 const handler=async route=>{
  if(route.request().method()!=='DELETE')return route.continue();
  requests++;
  if(gate)await gate;
  if(mode==='network')return route.abort('failed');
  return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Синтетический сбой удаления. Повторите попытку.'})});
 };
 await page.route(url,handler);
 try{
  page.once('dialog',dialog=>dialog.accept());
  if(mode==='delayed-double'){
   // Two synchronous activations exercise the guard before React commits disabled.
   await button.evaluate(node=>{node.click();node.click()});
   await expect.poll(()=>requests).toBe(1);await expect(button).toBeDisabled();
   await new Promise(resolve=>setTimeout(resolve,150));assert.equal(requests,1,'Repeated activation sends one DELETE');release();
  }else await button.click();
  await expect.poll(()=>requests).toBe(1);
  const alert=row.getByRole('alert');await expect(alert).toBeVisible();
  if(mode!=='network')await expect(alert).toHaveText('Синтетический сбой удаления. Повторите попытку.');
  else await expect(alert).not.toHaveText('Синтетический сбой удаления. Повторите попытку.');
  assert.ok((await alert.innerText()).trim());
  await expect(row).toBeVisible();await expect(button).toBeEnabled();
  await objectStillExists(context,kind,id);
  pass(kind+'-'+mode+'-visible-error-preserved-retry-enabled-'+width);
  if(mode==='server')await capture(kind+'-error-'+width);
 }finally{release?.();await page.unroute(url,handler);}
}
try{
 let ready=false;for(let n=0;n<100;n++){if(child.exitCode!==null)throw Error('Fixture server exited: '+logs);try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}assert.ok(ready,'Local fixture did not start: '+logs);
 const rules=JSON.parse(fs.readFileSync('lib/image-rules.json','utf8'));
 const image=await sharp({create:{width:900,height:1200,channels:3,background:'#6b1836'}}).png().toBuffer();
 assert.ok(image.length<rules.maxBytes);assert.ok(900*1200<rules.maxPixels);assert.ok(rules.mimeTypes.includes('image/png'));
 browser=await chromium.launch({channel:'chrome',headless:true});
 for(const width of widths){
  current='setup-'+width;
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},serviceWorkers:'block',reducedMotion:'reduce',extraHTTPHeaders:{'X-Forwarded-For':'198.51.100.'+({1440:14,390:39,320:32}[width])}});
  const foreign=await browser.newContext({serviceWorkers:'block',extraHTTPHeaders:{'X-Forwarded-For':'198.51.100.'+({1440:15,390:40,320:33}[width])}});
  await context.route('**/*',route=>route.request().url().startsWith(origin+'/')?route.continue():route.abort());
  const own=await prepare(context,width,'own',image),other=await prepare(foreign,width,'other',image);
  const snapshot={studio:await api(foreign,'/studio'),visits:await api(foreign,'/appointments')};
  const ownVisits=await api(context,'/appointments');assert.equal(ownVisits.length,1);
  page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
  pass('synthetic-fixture-ready-'+width);
  for(const [kind,id,name] of [['service',own.service.id,'Синтетическая услуга own'],['work',own.work.id,'Синтетическая работа own']]){
   current=kind+'-'+width;await goto(kind);
   let row=rowFor(kind,name),button=deleteButton(row,kind,name);await expect(row).toBeVisible();
   const url=origin+'/api/'+(kind==='service'?'services/':'works/')+id;
   if(beforeFix){
    const previousErrors=pageErrors.length;let requests=0;
    const handler=route=>{if(route.request().method()!=='DELETE')return route.continue();requests++;return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Синтетический сбой удаления. Повторите попытку.'})})};
    await page.route(url,handler);await confirmedClick(button);await expect.poll(()=>requests).toBe(1);await expect.poll(()=>pageErrors.length).toBeGreaterThan(previousErrors);
    await expect(row.getByRole('alert')).toHaveCount(0);await expect(row).toBeVisible();await objectStillExists(context,kind,id);
    observations.push({kind,width,deleteRequests:requests,visibleAlert:false,objectRetained:true,unhandledPageErrors:pageErrors.slice(previousErrors)});
    await capture(kind+'-missing-error-'+width);pass(kind+'-original-unhandled-rejection-and-missing-error-reproduced-'+width);await page.unroute(url,handler);continue;
   }
   let cancelRequests=0;const countRequest=request=>{if(request.url()===url&&request.method()==='DELETE')cancelRequests++};page.on('request',countRequest);
   await confirmedClick(button,false);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   assert.equal(cancelRequests,0,'Cancel must not send DELETE');page.off('request',countRequest);await expect(row).toBeVisible();await objectStillExists(context,kind,id);pass(kind+'-cancel-sends-zero-requests-'+width);
   for(const mode of ['server','network','delayed-double'])await failDelete(context,kind,id,name,width,mode);
   let refreshFailures=0,retryDeletes=0;
   const refreshHandler=route=>route.request().method()==='GET'&&refreshFailures++===0?route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Синтетический сбой обновления списка.'})}):route.continue();
   const countRetry=request=>{if(request.url()===url&&request.method()==='DELETE')retryDeletes++};page.on('request',countRetry);
   await page.route(origin+'/api/studio',refreshHandler);
   try{
    const responsePromise=page.waitForResponse(response=>response.url()===url&&response.request().method()==='DELETE');
    await confirmedClick(button);assert.equal((await responsePromise).status(),200);await expect(row).toHaveCount(0);
    const refreshAlert=page.locator('.studio-refresh-error');await expect(refreshAlert).toBeVisible();await expect(refreshAlert).toContainText('Синтетический сбой обновления списка.');
    await expect(page.getByRole('status').filter({hasText:kind==='service'?'Услуга удалена.':'Работа удалена.'})).toBeVisible();
    await refreshAlert.getByRole('button',{name:'Повторить обновление',exact:true}).click();await expect(refreshAlert).toHaveCount(0);await expect(row).toHaveCount(0);
    assert.equal(retryDeletes,1,'Refresh retry must not repeat acknowledged DELETE');
    pass(kind+'-acknowledged-delete-survives-refresh-failure-and-refresh-retry-'+width);await capture(kind+'-success-'+width);
   }finally{await page.unroute(origin+'/api/studio',refreshHandler);page.off('request',countRetry);}
   await page.reload();await expect(rowFor(kind,name)).toHaveCount(0);const studio=await api(context,'/studio');assert.equal(studio[kind==='service'?'services':'works'].some(item=>item.id===id),false);
   await unchanged(context,foreign,snapshot,ownVisits);pass(kind+'-retry-removes-object-persists-reload-preserves-visits-and-other-master-'+width);
  }
  if(!beforeFix){
   current='linked-service-conflict-'+width;await goto('service');
   const name='Услуга с работой own',row=rowFor('service',name),button=deleteButton(row,'service',name);
   const conflictPromise=page.waitForResponse(response=>response.url()===origin+'/api/services/'+own.linked.id&&response.request().method()==='DELETE');
   await confirmedClick(button);assert.equal((await conflictPromise).status(),409);
   await expect(row.getByRole('alert')).toHaveText('Эта услуга связана с работой. Сначала удалите работу или выберите для неё другую услугу.');
   await expect(button).toBeEnabled();await objectStillExists(context,'service',own.linked.id);await capture('linked-service-conflict-'+width);pass('real409-keeps-linked-service-visible-and-enabled-'+width);
   await api(context,'/services/'+other.service.id,undefined,'DELETE');await api(context,'/works/'+other.work.id,undefined,'DELETE',404);
   await unchanged(context,foreign,snapshot,ownVisits);pass('api-ownership-boundaries-and-visits-preserved-'+width);
  }
  await context.close();await foreign.close();
 }
 if(!beforeFix){assert.deepEqual(pageErrors,[]);pass('no-unhandled-javascript-errors');}
}catch(error){checks.push({name:current,pass:false,message:error.message});report();console.error('FAIL '+current+': '+error.message);process.exitCode=1;}
finally{
 await browser?.close();
 const stopped=child.exitCode===null?new Promise(resolve=>child.once('exit',resolve)):Promise.resolve();child.kill();await stopped;fixtureStopped=true;
 report();console.log('Fixture stopped; report '+path.relative(process.cwd(),path.join(out,prefix+'report.json')));
}
