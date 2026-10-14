// Browser acceptance against a disposable synthetic map fixture only.
import {chromium} from 'playwright';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(process.env.LUMA_PROFILE_TEST_ROOT||'.cache/profile-page-browser-20261014');
assert.ok(root.startsWith(path.resolve('.cache')+path.sep),'Synthetic fixture must stay in .cache');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),origin=manifest.origin;
assert.match(origin,/^http:\/\/localhost:\d+$/);
const output=path.resolve('docs/ui-checks/2026-10-14-public-profiles');fs.mkdirSync(output,{recursive:true});
const db=new DatabaseSync(path.join(root,'data/atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const master=manifest.free,salon=manifest.salon;
const owner=db.prepare('SELECT owner_user_id id FROM workspaces WHERE id=?').get(salon.id).id;
db.prepare("UPDATE profiles SET theme='green',looking_models=1,teaches=1 WHERE user_id=?").run(master.id);
db.prepare("UPDATE workspaces SET theme='green',looking_models=1,teaches=1 WHERE id=?").run(salon.id);
const client=randomUUID();db.prepare("INSERT INTO users(id,login,password,recovery,created,account_type) VALUES(?,?,'disabled','disabled',?,'client')").run(client,'visual-client-'+client,Date.now());
function token(id){const value=randomUUID();db.prepare('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)').run(createHash('sha256').update(value).digest('hex'),id,Date.now()+3600000,Date.now());return value}
const tokens={owner:token(owner),master:token(master.id),client:token(client)};
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[];
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'}),page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
const report=()=>fs.writeFileSync(path.join(output,'browser-report.json'),JSON.stringify({at:new Date().toISOString(),scope:'Local app + real API on synthetic .cache SQLite only',checks,pageErrors:errors},null,2)+'\n');
async function capture(name){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(700);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overflow');await page.screenshot({path:path.join(output,name+'.png')});checks.push({name,overflow:false});report()}
async function login(role){await context.clearCookies();if(role)await context.addCookies([{name:'atelie_session',value:tokens[role],url:origin}]);}
try{
 for(const width of [1440,800,390,320]){
  await page.setViewportSize({width,height:width>760?1000:844});
  for(const [kind,route,label] of [['master','/m/'+master.slug,'Ищу моделей'],['salon','/s/'+salon.slug,'Ищем моделей']]){
   await page.goto(origin+'/v2'+route);await page.locator('.public-identity').waitFor();await page.getByText(label,{exact:true}).waitFor();
   const targets=await page.locator('.public-identity-actions :is(button,a)').evaluateAll(els=>els.map(e=>e.getBoundingClientRect()).map(r=>({width:r.width,height:r.height})));assert.ok(targets.every(r=>r.width>=43.5&&r.height>=43.5),'Actions have 44 px targets');
   if(width===1440){const rects=await page.locator('.public-identity-actions>*').evaluateAll(els=>els.map(e=>({top:e.getBoundingClientRect().top,bottom:e.getBoundingClientRect().bottom})));assert.ok(Math.max(...rects.map(r=>r.top))-Math.min(...rects.map(r=>r.top))<2,'Actions in one row');}
   await capture(kind+'-'+width);
   await page.getByRole('button',{name:/^Отзывы(?:\s+\d+)?$/}).click();await page.getByRole('heading',{name:'Отзывы клиентов'}).waitFor();assert.equal(await page.locator('.public-reviews article').count(),2);
  }
 }
 await page.setViewportSize({width:390,height:844});await page.goto(origin+'/v2/s/'+salon.slug);await page.getByRole('button',{name:'Добавить салон в избранное'}).click();await page.waitForURL('**/v2/auth?next=*');checks.push({name:'anonymous-save-login-return-url'});
 await login('client');await page.goto(origin+'/v2/s/'+salon.slug);await page.getByRole('button',{name:'Добавить салон в избранное'}).click();await page.getByRole('button',{name:'Убрать салон из избранного'}).waitFor();await page.reload();await page.getByRole('button',{name:'Убрать салон из избранного'}).waitFor();
 await page.goto(origin+'/v2/m/'+master.slug);await page.getByRole('button',{name:'Подписаться на мастера'}).click();await page.getByRole('button',{name:'Отписаться от мастера'}).waitFor();
 await page.goto(origin+'/v2/me?tab=masters');await page.getByRole('heading',{name:'Мастера и салоны',exact:true}).waitFor();assert.equal(await page.locator('.client-master-card').count(),2);await capture('client-collection-390');
 await page.getByRole('button',{name:'Убрать из избранного',exact:true}).click();await page.getByRole('button',{name:'Убрать из избранного',exact:true}).waitFor({state:'detached'});assert.equal(await page.locator('.client-master-card').count(),1);checks.push({name:'salon-save-reload-collection-remove-master-preserved'});
 for(const role of ['owner','master']){
  await login(role);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/v2/'+(role==='owner'?'salon':'studio'));
  await page.getByRole('button',{name:role==='owner'?'Страница салона':'Оформление',exact:true}).first().click();
  await page.locator('.appearance-theme-options').waitFor();
  for(const [theme,label] of [['wine','Винный'],['cream','Светлый'],['green','Зелёный']]){
   await page.getByRole('radio',{name:label,exact:true}).check();
   await page.locator('.public-page-preview .public-cover-'+theme).waitFor();
   await page.getByRole('button',{name:role==='owner'?'Сохранить страницу':'Сохранить цвет фона',exact:true}).click();
   await page.waitForTimeout(250);await page.reload();
   // Cabinet section history is intentionally in browser history, not the reload URL.
   if(await page.locator('.appearance-theme-options').count()===0)await page.getByRole('button',{name:role==='owner'?'Страница салона':'Оформление',exact:true}).first().click();
   await page.getByRole('radio',{name:label,exact:true}).waitFor();assert.equal(await page.getByRole('radio',{name:label,exact:true}).isChecked(),true);
   assert.ok(await page.getByRole('radio',{name:label,exact:true}).evaluate(e=>e.getBoundingClientRect().height<=20),'Radio itself stays compact inside the full label target');
   const pathName=role==='owner'?'/s/'+salon.slug:'/m/'+master.slug;
   const profile=await context.newPage();await profile.goto(origin+'/v2'+pathName);await profile.locator('.public-cover-'+theme).waitFor();assert.equal(await profile.locator('.public-cover-pattern').evaluate(e=>getComputedStyle(e).backgroundRepeat),'no-repeat');await profile.screenshot({path:path.join(output,role+'-'+theme+'-1440.png')});await profile.close();
  }
  if(role==='owner'){
   await page.getByRole('checkbox',{name:'Обучаем',exact:true}).uncheck();await page.getByRole('checkbox',{name:'Ищем моделей',exact:true}).uncheck();await page.getByRole('button',{name:'Сохранить страницу',exact:true}).click();await page.waitForTimeout(300);
   const response=await context.request.get(origin+'/api/public/salons/'+salon.slug);const updated=await response.json();assert.equal(updated.teaches,0);assert.equal(updated.looking_models,0);
  }
  await capture(role+'-appearance-1440');await page.setViewportSize({width:320,height:844});await capture(role+'-appearance-320');checks.push({name:role+'-three-palettes-save-reload-public-preview'});
 }
 // Empty ratings use the same label for both public types.
 await login();await page.goto(origin+'/v2/m/'+manifest.ordinary.slug);await page.getByText('Пока без оценок',{exact:true}).waitFor();
 db.prepare("UPDATE appointments SET status='pending' WHERE master_id=?").run(manifest.salonStaff.id);
 await page.goto(origin+'/v2/s/'+salon.slug);await page.getByText('Пока без оценок',{exact:true}).waitFor();await page.getByRole('button',{name:'Отзывы',exact:true}).click();await page.getByRole('heading',{name:'Отзывов пока нет'}).waitFor();await capture('salon-no-reviews-320');
 db.prepare("UPDATE appointments SET status='done' WHERE master_id=?").run(manifest.salonStaff.id);checks.push({name:'both-types-empty-rating-and-salon-empty-reviews'});
 // Master models checkbox is in page settings, independently of appearance controls.
 await login('master');await page.goto(origin+'/v2/studio');await page.getByRole('button',{name:'Открыть меню кабинета',exact:true}).click();await page.getByRole('button',{name:'Настройки',exact:true}).first().click();await page.getByRole('checkbox',{name:'Ищу моделей',exact:true}).waitFor();await capture('master-settings-320');
 await login();await page.goto(origin+'/v2/s/'+salon.slug);await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.public-identity').waitFor();assert.equal(await page.locator('.public-avatar').evaluate(e=>getComputedStyle(e).animationName),'none');checks.push({name:'reduced-motion'});
 assert.deepEqual(errors,[]);report();console.log('PASS public profiles browser:',checks.length,'checks; page errors',errors.length);
}finally{db.close();await browser.close();report()}
