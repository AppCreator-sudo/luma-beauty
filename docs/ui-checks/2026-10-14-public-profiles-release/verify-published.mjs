import {chromium,expect} from '@playwright/test';
import https from 'node:https';
import fs from 'node:fs';
const meta=JSON.parse(fs.readFileSync(new URL('./package-manifest.json',import.meta.url),'utf8')),origin=meta.baseline.origin,dir='docs/ui-checks/2026-10-14-public-profiles-release';fs.mkdirSync(dir,{recursive:true});
const report={at:new Date().toISOString(),tag:meta.tag,origin,scope:'Anonymous production GET/HEAD only; no accounts, fixtures, settings, bookings or reviews written',checks:[],pageErrors:[],blockedWrites:[]};
if(process.env.LUMA_PROFILE_RETRY==='1'){
 const previous=JSON.parse(fs.readFileSync(dir+'/production-report.json','utf8'));fs.writeFileSync(dir+'/first-attempt.json',JSON.stringify(previous,null,2)+'\n');
 report.checks=previous.checks;report.previousAt=previous.at;report.retry='Only unchecked scenarios repeated. Mobile map count is intentionally hidden with list panel; wait for loaded text instead of visibility. Application unchanged.';
 for(const key of Object.keys(previous).filter(k=>k.startsWith('mapWidth')))report[key]=previous[key];
}
const host=new URL(origin).hostname,ip='13.143.66.1';
const get=route=>new Promise((resolve,reject)=>{const r=https.get(origin+route,{lookup:(host,opts,done)=>opts.all?done(null,[{address:ip,family:4}]):done(null,ip,4),timeout:25000},res=>{let text='';res.setEncoding('utf8');res.on('data',v=>text+=v);res.on('end',()=>resolve({status:res.statusCode,text,json:()=>JSON.parse(text)}));});r.on('error',reject);r.on('timeout',()=>r.destroy(Error('HTTPS timeout')));});
async function check(name,fn){if(report.checks.some(c=>c.name===name))return;await fn();report.checks.push({name,status:'PASS'});fs.writeFileSync(dir+'/production-report.json',JSON.stringify(report,null,2)+'\n');}
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP '+host+' '+ip]});
try{
 await check('public build, SW, health and protected client API',async()=>{const entry=await get('/v2/');expect(entry.status).toBe(200);expect(entry.text).toContain(meta.entry);expect((await get('/sw.js')).text).toContain('luma-v2-shell-'+meta.tag);expect((await get('/api/health')).json().ok).toBe(true);expect((await get('/api/client/data')).status).toBe(401);});
 const places=(await get('/api/map/viewport?zoom=4')).json().items;
 const targets=['master','salon'].map(kind=>places.find(p=>p.kind===kind));expect(targets.every(Boolean)).toBe(true);
 for(const target of targets){await check(target.kind+' public API ratings and fields',async()=>{const data=(await get((target.kind==='salon'?'/api/public/salons/':'/api/profiles/')+encodeURIComponent(target.slug))).json();for(const key of ['theme','teaches','looking_models','reviews','rating','review_count'])expect(data).toHaveProperty(key);expect(data.rating).toBe(target.rating);expect(data.review_count).toBe(target.review_count);if(data.review_count===0){expect(data.rating).toBe(null);expect(data.reviews).toHaveLength(0)}if(target.kind==='salon')expect(data.saved).toBe(false);});}
 for(const [width,height] of [[1440,900],[390,844],[320,760]]){
  const c=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});await c.route('**/*',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.request().method())){report.blockedWrites.push({method:r.request().method(),path:new URL(r.request().url()).pathname});return r.abort()}return r.continue()});
  const p=await c.newPage();p.on('pageerror',e=>report.pageErrors.push(e.message));
  for(const target of targets){await check(target.kind+' profile '+width,async()=>{
   await p.goto(origin+'/v2/'+(target.kind==='salon'?'s/':'m/')+encodeURIComponent(target.slug));await expect(p.locator('.public-identity-title')).toHaveText(target.name,{timeout:25000});await p.evaluate(()=>document.fonts.ready);
   expect(await p.locator('.public-page-shell').count()).toBe(1);await expect(p.locator('.public-cover-heading')).toBeVisible();await expect(p.locator('.public-rating')).toContainText(target.review_count?'отзыв':'Пока без оценок');
   const label=target.kind==='salon'?'Добавить салон в избранное':'Подписаться на мастера';await expect(p.getByRole('button',{name:label,exact:true})).toBeVisible();
   const dims=await p.locator('.public-identity-actions>*').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return {width:r.width,height:r.height,top:r.top}}));expect(dims.every(r=>r.width>=43.5&&r.height>=43.5)).toBe(true);if(width===1440)expect(Math.max(...dims.map(r=>r.top))-Math.min(...dims.map(r=>r.top))).toBeLessThan(2);
   expect(await p.evaluate(()=>getComputedStyle(document.documentElement).scrollbarGutter)).toBe('auto');expect(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);expect(await p.locator('.bottom-nav').count()).toBe(0);
   await p.screenshot({path:dir+'/'+target.kind+'-'+width+'.png'});
   await p.getByRole('button',{name:/^Отзывы(?:\s+\d+)?$/}).click();await expect(p.getByRole('heading',{name:'Отзывы клиентов',exact:true})).toBeVisible();
  });}
  await check('natural map width '+width,async()=>{await p.goto(origin+'/v2/map');await expect(p.locator('.map-result-count')).toContainText('В этой области:',{timeout:25000});const dim=await p.evaluate(()=>({gutter:getComputedStyle(document.documentElement).scrollbarGutter,client:document.documentElement.clientWidth,inner:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth}));expect(dim.gutter).toBe('auto');expect(dim.client).toBe(dim.inner);expect(dim.overflow).toBe(false);report['mapWidth'+width]=dim;await p.screenshot({path:dir+'/map-'+width+'.png'});});
  if(width<760)await check('mobile menu and Back '+width,async()=>{await p.getByRole('button',{name:'Открыть меню',exact:true}).click();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toBeVisible();await p.goBack();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toHaveCount(0);expect(new URL(p.url()).pathname).toBe('/v2/map');});
  await c.close();
 }
 expect(report.pageErrors).toEqual([]);expect(report.blockedWrites).toEqual([]);report.result='PASS';
}catch(e){report.result='FAIL';report.error=e.message;process.exitCode=1}finally{await browser.close();fs.writeFileSync(dir+'/production-report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks.length,pageErrors:report.pageErrors,error:report.error}));}
