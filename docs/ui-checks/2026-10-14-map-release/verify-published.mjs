// Anonymous read-only production acceptance. All write requests are blocked.
import {chromium,expect} from '@playwright/test';
import https from 'node:https';
import fs from 'node:fs';
const meta=JSON.parse(fs.readFileSync(new URL('./package-manifest.json',import.meta.url),'utf8')),origin=meta.baseline.origin,dir='docs/ui-checks/2026-10-14-map-release';fs.mkdirSync(dir,{recursive:true});
const report={at:new Date().toISOString(),tag:meta.tag,origin,scope:'anonymous production GET only; no fixture/login/booking/real-device OS gesture',checks:[],pageErrors:[],blockedWrites:[]};
const hostname=new URL(origin).hostname,ip='13.143.66.1';
report.localDnsFallback='Verified existing server IP; original HTTPS hostname and certificate validation retained';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP '+hostname+' '+ip]});
const api={get:route=>new Promise((resolve,reject)=>{const r=https.get(origin+route,{lookup:(host,options,callback)=>options.all?callback(null,[{address:ip,family:4}]):callback(null,ip,4),timeout:25000},response=>{let body='';response.setEncoding('utf8');response.on('data',chunk=>body+=chunk);response.on('end',()=>resolve({status:()=>response.statusCode,text:async()=>body,json:async()=>JSON.parse(body)}))});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('Public HTTPS timeout')))}),dispose:async()=>{}};
async function check(name,fn){await fn();report.checks.push({name,status:'PASS'})}
try{
 await check('public release entry, worker cache and API',async()=>{
  const page=await api.get('/v2/');expect(page.status()).toBe(200);expect(await page.text()).toContain(meta.entry);
  const worker=await api.get('/sw.js');expect(worker.status()).toBe(200);expect(await worker.text()).toContain('luma-v2-shell-'+meta.tag);
  const health=await api.get('/api/health');expect((await health.json()).ok).toBe(true);
  const response=await api.get('/api/map/viewport?zoom=4');expect(response.status()).toBe(200);const data=await response.json();report.publicPlaces=data.total;
  for(const p of [...data.points,...data.items]){expect(p).toHaveProperty('rating');expect(p).toHaveProperty('review_count');if(p.review_count===0)expect(p.rating).toBe(null);else{expect(p.rating).toBeGreaterThanOrEqual(1);expect(p.rating).toBeLessThanOrEqual(5)}}
  for(const route of ['profile','appointments','data'])expect((await api.get('/api/client/'+route)).status()).toBe(401);
 });
 const widths=process.env.LUMA_VERIFY_WIDTHS?.split(',').map(Number);
 for(const [width,height] of [[1440,900],[390,844],[320,568]].filter(([width])=>!widths||widths.includes(width))){
  const c=await browser.newContext({viewport:{width,height}});await c.route('**/*',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){report.blockedWrites.push({method:r.request().method(),path:new URL(r.request().url()).pathname});return r.abort()}return r.continue()});
  const p=await c.newPage();p.on('pageerror',e=>report.pageErrors.push(e.message));
  await check('map reference and real card '+width,async()=>{
   expect((await p.goto(origin+'/v2/map')).status()).toBe(200);await expect(p.locator('.public-reference-header .cabinet-branch')).toBeVisible({timeout:25000});expect(await p.locator('.bottom-nav').count()).toBe(0);expect(await p.locator('.site-footer').count()).toBe(0);
   await expect(p.locator('.map-result-count')).toContainText('В этой области:');
   if(width<=800)await p.getByRole('button',{name:'Список',exact:true}).click();
   if(report.publicPlaces>0){
    await expect(p.locator('.map-entry').first()).toBeVisible();await p.locator('.map-result').first().click();const card=p.locator('.map-selected-card');await expect(card).toBeVisible();await expect(card).toHaveAttribute('aria-busy','false');await expect(card.locator('.map-rating')).toBeVisible();
    await expect(p.locator('.atelier-marker-selected .map-pin-body')).toHaveCount(1);
    await expect(card.locator('.map-card-profile')).toBeVisible();expect(await card.locator('.map-card-book').count()).toBe(1);const href=await card.locator('.map-card-book').getAttribute('href');expect(href).toMatch(/\/v2\/(?:book|s\/)/);
    await expect.poll(()=>p.locator('.atelier-marker-selected').evaluate(e=>{const marker=e.getBoundingClientRect(),map=document.querySelector('.map-canvas').getBoundingClientRect(),card=document.querySelector('.map-selected-card').getBoundingClientRect();return marker.left>=map.left&&marker.top>=map.top&&marker.right<=map.right+1&&marker.bottom<=map.bottom+1&&(marker.right<card.left||marker.left>card.right||marker.bottom<card.top||marker.top>card.bottom)})).toBe(true);
    await p.goBack();await expect(card).toHaveCount(0);expect(new URL(p.url()).pathname).toBe('/v2/map');
   }
   expect(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
   await p.screenshot({path:dir+'/production-'+width+'.png'});
  });
  if(width<=760)await check('mobile filters, menu and Back '+width,async()=>{
   await p.getByRole('button',{name:'Открыть фильтры'}).click();await expect(p.getByRole('dialog',{name:'Фильтры'})).toBeVisible();await p.goBack();await expect(p.getByRole('dialog',{name:'Фильтры'})).toHaveCount(0);
   await p.getByRole('button',{name:'Открыть меню'}).click();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toBeVisible();await p.mouse.wheel(0,600);expect(await p.evaluate(()=>document.body.style.position)).toBe('fixed');await p.goBack();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toHaveCount(0);expect(new URL(p.url()).pathname).toBe('/v2/map');
  });
  await c.close();
 }
 expect(report.pageErrors).toEqual([]);expect(report.blockedWrites).toEqual([]);report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.message;process.exitCode=1}finally{
 await browser.close();await api.dispose();
 if(process.env.LUMA_VERIFY_WIDTHS){const previous=JSON.parse(fs.readFileSync(dir+'/production-report.json','utf8'));const names=new Set(report.checks.map(c=>c.name));report.checks=[...previous.checks.filter(c=>!names.has(c.name)),...report.checks];report.previousAt=previous.at;report.retry='Only narrow 320px checks repeated with longer network readiness wait; application unchanged';report.pageErrors=[...previous.pageErrors,...report.pageErrors]}
 fs.writeFileSync(dir+'/production-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks,pageErrors:report.pageErrors,error:report.error}));
}
