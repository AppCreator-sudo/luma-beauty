// Focused UI verification on an existing disposable synthetic fixture only.
import {chromium,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID,createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(process.env.LUMA_CABINET_TEST_ROOT||'.cache/cabinet-refinement-20261015b');assert.ok(root.startsWith(path.resolve('.cache')+path.sep));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),origin=fixture.origin;assert.match(origin,/^http:\/\/localhost:\d+$/);
const out='docs/ui-checks/2026-10-15-service-prices';fs.mkdirSync(out,{recursive:true});
const db=new DatabaseSync(path.join(root,'data/atelie.sqlite')),snapshot=()=>JSON.stringify({services:db.prepare('SELECT * FROM services ORDER BY id').all(),visits:db.prepare('SELECT * FROM appointments ORDER BY id').all()}),before=snapshot();
const roles={master:fixture.free.id,owner:db.prepare('SELECT owner_user_id id FROM workspaces WHERE id=?').get(fixture.salon.id).id,client:fixture.ordinary.id},tokens={};
for(const [role,id] of Object.entries(roles)){const token=randomUUID();tokens[role]=token;db.prepare('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)').run(createHash('sha256').update(token).digest('hex'),id,Date.now()+3600000,Date.now())}
const report={at:new Date().toISOString(),scope:'Local synthetic fixture. No production access. Existing service and appointment rows compared before/after.',checks:[],pageErrors:[]};
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 for(const width of [1440,390,320]){
  const context=await browser.newContext({viewport:{width,height:width===1440?1000:844},serviceWorkers:'block',reducedMotion:'reduce'}),page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));
  async function go(route,role){await context.clearCookies();if(role)await context.addCookies([{name:'atelie_session',value:tokens[role],url:origin}]);await page.goto(origin+'/v2'+route);await page.evaluate(()=>document.fonts.ready)}
  async function check(name,fn){await fn();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1)).toBe(false);report.checks.push({name:name+' '+width,status:'PASS'});fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n')}
  async function geometry(){const row=page.locator('.cabinet-service-item').first();await expect(row).toBeVisible();const name=row.locator('.cabinet-service-heading :is(h3,b)'),price=row.locator('.cabinet-service-heading strong'),remove=row.locator('.cabinet-service-remove');await expect(price).toHaveText(/^от\s[\d\s]+₽$/);const n=await name.boundingBox(),p=await price.boundingBox(),b=await remove.boundingBox();if(p.y<n.y+n.height-4){expect(p.x-n.x-n.width).toBeGreaterThanOrEqual(0);expect(p.x-n.x-n.width).toBeLessThanOrEqual(18)}else{expect(Math.abs(p.x-n.x)).toBeLessThanOrEqual(1);expect(p.y-n.y-n.height).toBeLessThanOrEqual(10)}expect(b.width).toBeGreaterThanOrEqual(44);expect(b.height).toBeGreaterThanOrEqual(44)}
  await go('/studio?tab=services','master');await check('master service price near name and single prefix',async()=>{await geometry();await page.screenshot({path:out+'/master-'+width+'.png'})});
  await check('long name and maximum price wrap without overlap',async()=>{const heading=page.locator('.cabinet-service-heading').first();await heading.locator('h3').evaluate(el=>el.textContent='Сложное окрашивание и восстановление длинных волос с дополнительным уходом');await heading.locator('strong').evaluate(el=>el.textContent='от 1 000 000 ₽');await geometry();await page.screenshot({path:out+'/master-long-'+width+'.png'})});
  await go('/salon','owner');await page.locator('.master-cabinet').waitFor();if(width<=800)await page.locator('.cabinet-menu-toggle').click();await page.getByRole('button',{name:'Услуги и графики',exact:true}).click();await page.locator('.salon-select-staff select').selectOption(fixture.salonStaff.id);await page.getByRole('button',{name:'Услуги',exact:true}).click();await check('salon service price near name and single prefix',async()=>{await geometry();await page.screenshot({path:out+'/salon-'+width+'.png'})});
  await go('/m/'+fixture.free.slug);await page.locator('.public-window-price strong').waitFor();await check('public master window and price list use from',async()=>{await expect(page.locator('.public-window-price strong')).toHaveText(/^от\s/);await page.getByRole('button',{name:'Услуги',exact:true}).click();await expect(page.locator('.public-service-list strong').first()).toHaveText(/^от\s/);await page.screenshot({path:out+'/public-master-'+width+'.png'})});
  const book=page.locator('.public-window-actions a').last();await book.click();await check('booking offer summary uses from',async()=>{await expect(page.locator('.booking-reference')).toBeVisible();await expect(page.locator('.desktop-summary .total strong')).toHaveText(/^от\s/)});
  await go('/me?tab=visits','client');await check('stored visit prices remain fixed',async()=>{await expect(page.locator('.client-visit-row').first()).toBeVisible();expect(await page.locator('.client-visit-row').first().innerText()).not.toMatch(/от\s[\d\s]+₽/)});
  await context.close();
 }
 assert.equal(snapshot(),before,'Service/appointment data changed');expect(report.pageErrors).toEqual([]);report.numeric_data_unchanged=true;report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.message;process.exitCode=1}
finally{await browser.close();db.close();fs.writeFileSync(out+'/report.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,checks:report.checks.length,pageErrors:report.pageErrors,error:report.error}))}
