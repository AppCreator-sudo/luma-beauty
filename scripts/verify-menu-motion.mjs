// BUG-019: isolated menu motion and lifecycle acceptance; no production access.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const before=process.env.MENU_BEFORE==='1', origin='http://localhost:3274';
const folder=path.resolve('.cache/menu-motion-'+Date.now()),out=path.resolve('docs/ui-checks/2026-10-19-menu-motion',before?'before':'after');
fs.mkdirSync(folder,{recursive:true});fs.mkdirSync(out,{recursive:true});
try { await fetch(origin+'/api/health');throw Error('Port in use'); } catch(e){if(e.message==='Port in use')throw e;}
const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:'3274',APP_ORIGIN:origin,DATA_DIR:folder,DADATA_API_KEY:'',DADATA_SECRET_KEY:'',PROMOTIONS_ENABLED:'0'},stdio:'ignore'});
const checks=[],measurements=[],errors=[],writes=[];let browser,stopped=false,browserVersion;
function pass(name){checks.push({name,pass:true});}
async function settle(page){await page.evaluate(async()=>{await document.fonts.ready;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));});}
async function idle(page){await page.waitForTimeout(900);}
try{
 for(let n=0;n<100;n++){try{if((await fetch(origin+'/api/health')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({channel:'chrome',headless:true});browserVersion=browser.version();
 const cases=[['auth',390,844,'/v2/auth',false],['home',390,844,'/v2/',false],['client',390,844,'/v2/me',false],...before?[]:[['narrow',320,568,'/v2/auth',false],['desktop',1440,900,'/v2/',false],['reduced',390,844,'/v2/auth',true]]];
 for(const [name,width,height,url,reduce] of cases.filter(c=>!process.env.MENU_CASE||c[0]===process.env.MENU_CASE)){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block',reducedMotion:reduce?'reduce':'no-preference'});
  await context.route('**/*',route=>{
   const req=route.request(),p=new URL(req.url()).pathname;
   if(!req.url().startsWith(origin+'/'))return route.abort();
   if(!['GET','HEAD'].includes(req.method())){writes.push(p);return route.abort();}
   let value;
   if(name==='client'){
    if(p==='/api/me')value={user:{id:'menu-only',login:'menu-only',account_type:'client'},profile:null,workspaces:[],providers:{}};
    if(p==='/api/client/appointments')value=[];
    if(p==='/api/library')value={masters:[],works:[]};
    if(p==='/api/client/notices')value={items:[],next:null,unread:0};
    if(p==='/api/client/profile')value={name:'Тест меню',avatar:null};
   }
   return value!==undefined?route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(value)}):route.continue();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push({name,message:e.message}));
  await page.goto(origin+url);const toggle=page.locator('button[aria-expanded][aria-label*="Открыть"]').filter({visible:true}).last();await expect(toggle).toBeVisible();await settle(page);
  const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Performance.enable');
  const start=await cdp.send('Performance.getMetrics');
  await page.evaluate(()=>{window.__menuFrames=[];let prev=performance.now(),end=prev+900;const tick=now=>{window.__menuFrames.push(now-prev);prev=now;if(now<end)requestAnimationFrame(tick);};requestAnimationFrame(tick);});
  await toggle.click();await expect(page.locator('dialog.luma-menu-layer')).toBeVisible();await idle(page);
  const end=await cdp.send('Performance.getMetrics');const frames=await page.evaluate(()=>window.__menuFrames);
  const metrics=Object.fromEntries(end.metrics.filter(m=>['TaskDuration','LayoutDuration','RecalcStyleDuration'].includes(m.name)).map(m=>[m.name,m.value-(start.metrics.find(v=>v.name===m.name)?.value||0)]));
  const dialog=page.locator('dialog.luma-menu-layer');
  const layout=await dialog.evaluate(node=>({overflow:document.documentElement.scrollWidth-innerWidth,scrollLock:document.documentElement.style.overflow,blur:getComputedStyle(node.querySelector('.luma-menu-scrim')).backdropFilter,backdropBlur:getComputedStyle(node,'::backdrop').backdropFilter,radius:getComputedStyle(node.querySelector('.luma-drawer-panel,.luma-navigation-panel')).borderRadius,buttons:[...node.querySelectorAll('button.luma-menu-close')].map(b=>({width:b.getBoundingClientRect().width,height:b.getBoundingClientRect().height})),animations:node.getAnimations({subtree:true}).length}));
  assert.equal(layout.overflow,0);assert.equal(layout.scrollLock,'hidden');assert.ok(layout.buttons.every(b=>b.width>=44&&b.height>=44));if(!before){assert.equal(layout.radius,'8px');if(width<=800)assert.equal(layout.backdropBlur,'blur(5px)');if(reduce)assert.equal(layout.animations,0);}pass(name+'-open-layout-scroll-lock-touch');
  await page.screenshot({path:path.join(out,name+'-open.png'),fullPage:true});
  const close=dialog.locator('button.luma-menu-close');await close.click();
  const closing=await page.evaluate(()=>{const d=document.querySelector('dialog.luma-menu-layer'),t=document.querySelector('button[aria-controls="'+(d?.querySelector('[id]')?.id||'')+'"]');const candidates=[...document.querySelectorAll('button[aria-expanded="false"]')].filter(n=>getComputedStyle(n).visibility!=='hidden'&&n.getBoundingClientRect().width>0);return {dialogPresent:!!d,visibleHamburgers:candidates.filter(n=>n.querySelector('svg.lucide-menu')).length};});
  measurements.push({name,width,height,cpuThrottle:4,reducedMotion:reduce,metrics,frames:{count:frames.length,over34ms:frames.filter(v=>v>34).length,max:Math.max(...frames)},layout,closing});
  if(!before&&!reduce){assert.ok(!closing.dialogPresent||closing.visibleHamburgers===0);pass(name+'-no-hamburger-before-exit');}
  await expect(dialog).toHaveCount(0);await expect(toggle).toBeVisible();await expect(toggle).toBeFocused();assert.notEqual(await page.evaluate(()=>document.documentElement.style.overflow),'hidden');pass(name+'-close-restores-focus-scroll');
  if(!before){
   await toggle.click();await expect(dialog).toBeVisible();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);pass(name+'-escape');
   await toggle.click();await expect(dialog).toBeVisible();await page.goBack();await expect(dialog).toHaveCount(0);pass(name+'-browser-back');
   await toggle.click();await expect(dialog).toBeVisible();await page.evaluate(()=>{document.querySelector('.luma-menu-close').click();document.querySelector('.luma-menu-close')?.click();});await expect(dialog).toHaveCount(0);await expect(toggle).toBeVisible();pass(name+'-rapid-close');
  }
  if(!before&&name==='auth'){
   await toggle.click();await expect(dialog).toBeVisible();await page.locator('.luma-menu-scrim').click({position:{x:2,y:height-2}});await expect(dialog).toHaveCount(0);pass('auth-backdrop-close');
   await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));await toggle.click();await expect(dialog).toBeVisible();await dialog.locator('.home-menu-links a').first().click();await expect(page).toHaveURL(/\/v2\/masters/);await expect(dialog).toHaveCount(0);await page.goBack();await expect(page).toHaveURL(/\/v2\/auth/);await expect(dialog).toHaveCount(0);pass('auth-menu-navigation-back-does-not-reopen');
  }
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);pass('no-js-errors-or-writes');
}catch(e){checks.push({name:'runner',pass:false,message:e.message});process.exitCode=1;}
finally{
 if(browser)await browser.close();child.kill();await new Promise(r=>child.once('exit',r));stopped=true;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({at:new Date().toISOString(),before,browserVersion,entry:fs.readFileSync('public/v2/index.html','utf8').match(/index-[\w-]+\.js/)?.[0],scope:'Isolated SQLite; browser-only client mocks; 4x CPU Chrome desktop emulation, not physical phone performance proof',checks,measurements,errors,writes,stopped},null,2)+'\n');
 console.log(JSON.stringify({before,pass:checks.filter(c=>c.pass).length,failed:checks.filter(c=>!c.pass),stopped}));
}
