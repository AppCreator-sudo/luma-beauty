import {chromium,expect} from '@playwright/test';
import https from 'node:https';
import fs from 'node:fs';
const dir=new URL('./',import.meta.url),meta=JSON.parse(fs.readFileSync(new URL('package-manifest.json',dir),'utf8')),origin=meta.baseline.origin;
const report={at:new Date().toISOString(),tag:meta.tag,origin,scope:'Anonymous production GET/HEAD only. Invitation preview POST requests are intentionally aborted in the browser. No login, uploads, settings, accounts, appointments or reviews written.',checks:[],pageErrors:[],blockedReadPreviews:[],blockedWrites:[]};
const host=new URL(origin).hostname,ip='13.143.66.1';
const get=route=>new Promise((resolve,reject)=>{const request=https.get(origin+route,{lookup:(_host,opts,done)=>opts.all?done(null,[{address:ip,family:4}]):done(null,ip,4),timeout:25000},res=>{let text='';res.setEncoding('utf8');res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,text,json:()=>JSON.parse(text)}))});request.on('error',reject);request.on('timeout',()=>request.destroy(Error('HTTPS timeout')))});
async function check(name,fn){await fn();report.checks.push({name,status:'PASS'});fs.writeFileSync(new URL('production-report.json',dir),JSON.stringify(report,null,2)+'\n')}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP '+host+' '+ip]});
try{
 await check('published build, PWA cache, health and protected data',async()=>{expect((await get('/v2/')).text).toContain(meta.entry);expect((await get('/sw.js')).text).toContain('luma-v2-shell-'+meta.tag);expect((await get('/api/health')).json().ok).toBe(true);expect((await get('/api/client/data')).status).toBe(401)});
 const places=(await get('/api/map/viewport?zoom=4')).json().items,targets=['master','salon'].map(kind=>places.find(p=>p.kind===kind));expect(targets.every(Boolean)).toBe(true);
 for(const target of targets)await check(target.kind+' actual availability, schedule and eligible staff API',async()=>{
  const profile=(await get((target.kind==='salon'?'/api/public/salons/':'/api/profiles/')+encodeURIComponent(target.slug))).json();expect(profile.rating).toBe(target.rating);expect(profile.review_count).toBe(target.review_count);expect(profile.services.length).toBeGreaterThan(0);
  if(target.kind==='master'){expect(profile.schedule.mode).toBe('weekly');expect(Array.isArray(profile.schedule.weekdays)).toBe(true)}
  else for(const service of profile.services){const data=(await get('/api/public/salons/'+encodeURIComponent(target.slug)+'/availability?'+new URLSearchParams({service:service.id}))).json();for(const slot of data.slots){expect(slot.master_ids.length).toBeGreaterThan(0);expect(slot.master_ids.every(id=>service.master_ids.includes(id))).toBe(true)}}
 });
 for(const [width,height] of [[1440,1000],[390,844],[320,844]]){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});await context.route('**/*',route=>{if(!['GET','HEAD','OPTIONS'].includes(route.request().method())){const request={method:route.request().method(),path:new URL(route.request().url()).pathname};if(request.method==='POST'&&request.path==='/api/invitations/preview')report.blockedReadPreviews.push(request);else report.blockedWrites.push(request);return route.abort()}return route.continue()});
  const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  const compact=async()=>{expect(await page.locator('.bottom-nav').count()).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);expect(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollbarGutter)).toBe('auto')};
  for(const target of targets)await check(target.kind+' nearest window selects locally then continues with chosen time '+width,async()=>{
   await page.goto(origin+'/v2/'+(target.kind==='salon'?'s/':'m/')+encodeURIComponent(target.slug));await expect(page.locator('.public-identity-title')).toHaveText(target.name,{timeout:25000});await page.evaluate(()=>document.fonts.ready);
   const chips=page.locator('.public-window-times button');await expect(chips.first()).toBeVisible({timeout:25000});const chip=chips.nth((await chips.count())>1?1:0),url=page.url();await chip.click();await expect(chip).toHaveAttribute('aria-pressed','true');expect(page.url()).toBe(url);
   const clock=await chip.innerText(),primary=page.getByRole('link',{name:'Выбрать это время',exact:true}),href=new URL(await primary.getAttribute('href'),origin),start=href.searchParams.get('start');expect(Number(start)).toBeGreaterThan(Date.now());expect(href.searchParams.get('service')).toBeTruthy();await compact();await page.screenshot({path:new URL(target.kind+'-window-'+width+'.png',dir).pathname.replace(/^\/(?:([A-Z]:))/, '$1')});
   await primary.click();
   if(target.kind==='salon'){
    await expect(page.locator('.progress [aria-current="step"]')).toContainText('Мастер');await expect(page.locator('.people .person').first()).toBeVisible({timeout:25000});await page.locator('.people .person').first().click();
   }
   await expect(page.locator('.progress [aria-current="step"]')).toContainText('Контакт',{timeout:25000});await expect(page.locator('.contact-form')).toBeVisible();await expect(page.locator('.desktop-summary')).toContainText(clock);expect(new URL(page.url()).searchParams.get('start')).toBe(start);await page.locator('.reference-step').evaluate(async el=>{await Promise.all(el.getAnimations({subtree:true}).map(animation=>animation.finished.catch(()=>{})))});await compact();await page.screenshot({path:new URL(target.kind+'-contact-'+width+'.png',dir).pathname.replace(/^\/(?:([A-Z]:))/, '$1')});
  });
  for(const [name,route] of [['login','auth'],['new-master','studio'],['new-salon','salon'],['guest-calendar','calendar'],['access','access'],['join','join']])await check(name+' shared header and compact responsive shell '+width,async()=>{await page.goto(origin+'/v2/'+route);await expect(page.locator('header').first()).toBeVisible();await page.evaluate(()=>document.fonts.ready);await compact();await page.screenshot({path:new URL(name+'-'+width+'.png',dir).pathname.replace(/^\/(?:([A-Z]:))/, '$1')})});
  await context.close();
 }
 expect(report.pageErrors).toEqual([]);expect(report.blockedWrites).toEqual([]);report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1}
finally{await browser.close();fs.writeFileSync(new URL('production-report.json',dir),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks.length,pageErrors:report.pageErrors,error:report.error}))}
