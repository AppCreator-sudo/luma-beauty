import {chromium} from 'playwright';
import {pathToFileURL} from 'node:url';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='docs/ui-concepts/2026-10-14-luma/map-review-01';
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],checks=[];
try{
 const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
 const base=pathToFileURL(process.cwd()+'/'+dir+'/index.html').href;
 for(const [width,height,state,name] of [[1440,900,'selected','desktop'],[390,844,'selected','mobile-map'],[390,844,'list','mobile-list'],[390,844,'filters','mobile-filters'],[390,844,'group','mobile-group'],[390,844,'empty','mobile-empty'],[390,844,'error','mobile-error'],[390,844,'details-error','mobile-details-error'],[390,844,'no-time','mobile-no-time'],[390,844,'loading','mobile-loading'],[390,844,'geo-denied','mobile-geo-denied'],[390,844,'tiles-error','mobile-tiles-error'],[390,844,'details-loading','mobile-details-loading'],[1440,900,'master','desktop-master'],[320,568,'long','small-long'],[800,600,'selected','short-landscape']]){
  await page.setViewportSize({width,height});await page.goto(base+'?state='+state);await page.evaluate(()=>document.fonts.ready);
  if(name==='desktop'||name==='mobile-map')await page.waitForTimeout(2500);else await page.waitForTimeout(200);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overflow');
  const small=await page.locator('button:visible').evaluateAll(els=>els.map(el=>({name:el.getAttribute('aria-label')||el.textContent.trim(),rect:el.getBoundingClientRect()})).filter(x=>x.rect.height<43.5));
   assert.deepEqual(small,[],name+' targets');
  if(!['small-long','short-landscape'].includes(name))await page.screenshot({path:dir+'/'+name+'.png'});
  checks.push({name,width,height,overflow:false});
  console.log('PASS '+name);
 }
 await page.setViewportSize({width:390,height:844});await page.goto(base+'?state=selected');
 await page.getByRole('button',{name:'Список',exact:true}).click();assert.equal(await page.locator('.sidebar').isVisible(),true);
 await page.getByRole('button',{name:'Открыть фильтры'}).click();await page.locator('#category-select').selectOption({label:'Маникюр'});await page.locator('#soon-select').check();await page.locator('#apply').click();assert.equal(await page.locator('.toolbar select').inputValue(),'Маникюр');assert.equal(await page.locator('.toolbar .soon input').isChecked(),true);
 await page.getByRole('button',{name:'Карта',exact:true}).click();await page.getByRole('button',{name:'Закрыть карточку'}).click();assert.equal(await page.locator('.card').count(),0);
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
 for(const board of ['mobile-board','states-board']){await page.setViewportSize({width:board==='mobile-board'?1284:1280,height:1100});await page.goto(pathToFileURL(process.cwd()+'/'+dir+'/'+board+'.html').href);await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:dir+'/'+board+'.png',fullPage:true})}
 assert.deepEqual(errors,[]);
 fs.writeFileSync(dir+'/prototype-check.json',JSON.stringify({at:new Date().toISOString(),scope:'Standalone proposed UI only; not app/API verification',checks,interactions:['map/list','filter apply','card close','reduced motion'],pageErrors:errors},null,2)+'\n');
}finally{await browser.close()}
