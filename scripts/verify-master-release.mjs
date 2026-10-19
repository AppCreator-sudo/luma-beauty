// Post-release read-only browser acceptance. Run only after the authorized release.
// The temporary session is opened/closed remotely by the release operator.
import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const expectedEntry='index-Bsde624L.js',expectedTag='20261015-v2-master-refinement';
const sessionPath=path.resolve('.cache/master-refinement-release/qa-session.json');
const out=path.resolve('docs/ui-checks/2026-10-15-master-release');
const widths=[1440,390,320],checks=[],skips=[],layouts=[],pageErrors=[];
const accounting={attemptedWriteRequests:0,blockedWriteRequests:0,forwardedWriteRequests:0,mockedDeletes:0,blockedExternalRequests:0,forwardedReadRequests:0};
const mockedRequests=new WeakSet();
let browser,context,page,current='configuration',origin='',cookieCleared=false,browserClosed=false;
function report(){fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'production-report.json'),JSON.stringify({at:new Date().toISOString(),scope:'Read-only production browser verification of deployed master fixes; DELETE failures are fulfilled inside the browser and never sent to server; no production objects or contacts retained',origin,expectedEntry,expectedTag,widths,checks,skips,layouts,pageErrors,accounting,cookieCleared,browserClosed},null,2)+'\n')}
function pass(name){checks.push({name,pass:true});report();console.log('PASS '+name)}
function skip(name,reason){skips.push({name,reason});report();console.log('SKIP '+name+': '+reason)}
async function capture(name,controlSelector){
 await page.evaluate(()=>document.fonts.ready);
 const horizontalOverflow=await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth));
 assert.equal(horizontalOverflow,0,'Horizontal overflow');assert.equal(await page.locator('.bottom-nav').count(),0,'Bottom navigation unexpectedly present');
 const controls=controlSelector?await page.locator(controlSelector).evaluateAll(nodes=>nodes.map(node=>({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height})).filter(node=>node.width&&node.height)):[];
 assert.ok(controls.every(node=>node.width>=44&&node.height>=44),'Target below 44 px');
 layouts.push({name,horizontalOverflow,controls});
 // Mask account identity, real titles and images. No client appointments are opened.
 await page.screenshot({path:path.join(out,name+'.png'),fullPage:true,mask:[page.locator('.cabinet-owner h2,.cabinet-account,.cabinet-avatar,.cabinet-service-heading h3,.studio-work-grid article p,.studio-work-grid article img,.reference-catalog .catalog-card h2,.reference-catalog .catalog-card img')],maskColor:'#d8d1c2'});
 pass(name+'-layout');
}
async function gotoCabinet(kind){await page.goto(origin+'/v2/studio?tab='+(kind==='service'?'services':'works'));await expect(page.locator(kind==='service'?'.studio-services-panel':'.studio-works-panel')).toBeVisible();assert.equal(new URL(page.url()).origin,origin)}
async function mockedDeleteFailure(kind,width){
 const rows=page.locator(kind==='service'?'.cabinet-service-item':'.studio-work-grid article');
 if(!await rows.count()){skip(kind+'-mocked-delete-'+width,'Existing production master has no '+(kind==='service'?'services':'portfolio works')+'; no synthetic production data created');return}
 const row=rows.first(),button=row.locator(kind==='service'?'.cabinet-service-remove':'button[aria-label="Удалить работу"]'),before=await rows.count();
 await expect(button).toBeEnabled();let intercepted=0;
 // Page routes run before the context guard. This one NEVER calls continue for DELETE.
 const matcher=origin+'/api/'+(kind==='service'?'services':'works')+'/*';
 const handler=async route=>{
  if(route.request().method()!=='DELETE')return route.fallback();
  intercepted++;accounting.mockedDeletes++;mockedRequests.add(route.request());
  return route.fulfill({status:500,contentType:'application/json',body:JSON.stringify({error:'Проверка отказа удаления. Данные сохранены. Повторите попытку.'})});
 };
 await page.route(matcher,handler);
 try{
  page.once('dialog',dialog=>dialog.accept());await button.click();await expect.poll(()=>intercepted).toBe(1);
  await expect(row.getByRole('alert')).toHaveText('Проверка отказа удаления. Данные сохранены. Повторите попытку.');await expect(row).toBeVisible();await expect(button).toBeEnabled();assert.equal(await rows.count(),before);
  pass(kind+'-browser-mocked500-inline-alert-row-retained-retry-enabled-'+width);
  await capture(kind+'-mocked-error-'+width,kind==='service'?'.cabinet-service-remove':'.studio-work-grid article button');
 }finally{await page.unroute(matcher,handler)}
 await page.reload();await expect(page.locator(kind==='service'?'.studio-services-panel':'.studio-works-panel')).toBeVisible();await expect(rows.first()).toBeVisible();assert.equal(await rows.count(),before);await expect(page.locator('.studio-removal-feedback[role="alert"]')).toHaveCount(0);pass(kind+'-reload-clears-local-mock-error-keeps-production-row-'+width);
}
try{
 const session=JSON.parse(fs.readFileSync(sessionPath,'utf8').replace(/^\uFEFF/,''));
 assert.equal(typeof session.origin,'string','Missing QA origin');const parsed=new URL(session.origin);assert.equal(parsed.protocol,'https:','Production verification requires HTTPS');assert.equal(parsed.username,'');assert.equal(parsed.password,'');assert.equal(parsed.search,'');assert.equal(parsed.hash,'');assert.equal(parsed.pathname,'/');origin=parsed.origin;
 assert.equal(typeof session.token,'string','Missing temporary QA session');assert.ok(session.token.length>=20,'Invalid temporary QA session');
 current='browser-start';browser=await chromium.launch({channel:'chrome',headless:true});context=await browser.newContext({serviceWorkers:'block',reducedMotion:'reduce',viewport:{width:1440,height:1000}});
 await context.addCookies([{name:'atelie_session',value:session.token,url:origin,httpOnly:true,secure:true,sameSite:'Lax'}]);
 context.on('request',request=>{if(!['GET','HEAD'].includes(request.method()))accounting.attemptedWriteRequests++});
 context.on('response',response=>{const request=response.request();if(!['GET','HEAD'].includes(request.method())&&!mockedRequests.has(request))accounting.forwardedWriteRequests++});
 await context.route('**/*',route=>{
  const request=route.request();let requestOrigin;try{requestOrigin=new URL(request.url()).origin}catch{accounting.blockedExternalRequests++;return route.abort('blockedbyclient')}
  if(requestOrigin!==origin){accounting.blockedExternalRequests++;return route.abort('blockedbyclient')}
  if(!['GET','HEAD'].includes(request.method())){accounting.blockedWriteRequests++;return route.abort('blockedbyclient')}
  accounting.forwardedReadRequests++;return route.continue();
 });
 page=await context.newPage();page.on('pageerror',error=>pageErrors.push({phase:current,type:error.name||'Error'}));
 current='deployed-version';await page.goto(origin+'/v2/');const entries=await page.locator('script[type="module"][src]').evaluateAll(nodes=>nodes.map(node=>new URL(node.src).pathname));assert.ok(entries.includes('/v2/assets/'+expectedEntry),'Unexpected deployed entry');
 const sw=await page.evaluate(async()=>{const response=await fetch('/sw.js',{cache:'no-store'});return {ok:response.ok,text:await response.text()}});assert.equal(sw.ok,true);assert.ok(sw.text.includes('luma-v2-shell-'+expectedTag),'Unexpected deployed service-worker cache tag');pass('deployed-entry-and-service-worker-tag-match-release');
 for(const width of widths){
  await page.setViewportSize({width,height:width===1440?1000:844});
  for(const kind of ['service','work']){
   current=kind+'-load-'+width;await gotoCabinet(kind);await page.reload();await expect(page.locator(kind==='service'?'.studio-services-panel':'.studio-works-panel')).toBeVisible();pass(kind+'-authenticated-load-and-reload-'+width);
   if(kind==='service')await page.locator('.service-create').evaluate(node=>{node.open=true});
   await capture(kind+'-loaded-'+width,kind==='service'?'.inline-service-form button,.inline-service-form input,.inline-service-form select,.cabinet-service-remove,.service-direction-editor select':'.studio-add-work-toggle,.studio-work-grid article button');
   current=kind+'-mock-'+width;await mockedDeleteFailure(kind,width);
  }
  current='public-catalog-'+width;await page.goto(origin+'/v2/masters');await expect(page.getByRole('heading',{name:'Мастера и салоны',exact:true})).toBeVisible();assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);pass('public-catalog-load-no-overflow-'+width);
  current='public-map-'+width;await page.goto(origin+'/v2/map');await expect(page.locator('.map-page')).toBeVisible();await expect(page.locator('.leaflet-container')).toBeVisible();assert.equal(await page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-innerWidth)),0);pass('public-map-shell-load-no-overflow-'+width);
 }
 assert.deepEqual(pageErrors,[],'Unhandled JavaScript page error');pass('no-unhandled-javascript-page-errors');assert.equal(accounting.forwardedWriteRequests,0,'A non-mocked write received a server response');assert.equal(accounting.blockedWriteRequests,0,'Unexpected write was attempted');assert.equal(accounting.attemptedWriteRequests,accounting.mockedDeletes,'Every attempted write must be a browser-only mocked DELETE');pass('production-forwarded-write-requests-zero');
}catch(error){checks.push({name:current,pass:false,message:'Verification failed in this phase; no server data or credentials included'});report();console.error('FAIL '+current);process.exitCode=1}
finally{
 try{if(context){try{await context.clearCookies();cookieCleared=(await context.cookies()).length===0}finally{await context.close()}}}
 finally{try{if(browser){await browser.close();browserClosed=true}}finally{report();console.log('Browser cleanup complete; sanitized production-report.json saved. Remote temporary-session cleanup remains the release operator responsibility.')}}
}
