// Real UI/API acceptance on a local, synthetic map-reference fixture only.
import {chromium,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(process.env.LUMA_POLISH_TEST_ROOT||'.cache/profile-service-browser-20261015');
assert.ok(root.startsWith(path.resolve('.cache')+path.sep));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),origin=fixture.origin;
assert.match(origin,/^http:\/\/localhost:\d+$/);
const output=path.resolve('docs/ui-checks/2026-10-15-profile-service-polish');fs.mkdirSync(output,{recursive:true});
const db=new DatabaseSync(path.join(root,'data/atelie.sqlite'));db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');
const master=fixture.free,salon=fixture.salon,owner=db.prepare('SELECT owner_user_id id FROM workspaces WHERE id=?').get(salon.id).id;
const staff=db.prepare('SELECT id FROM performers WHERE workspace_id=? ORDER BY created,id').all(salon.id);
db.prepare("UPDATE users SET account_type='salon' WHERE id=?").run(owner);
db.prepare("UPDATE profiles SET theme='green',teaches=1,looking_models=1 WHERE user_id=?").run(master.id);
db.prepare("UPDATE workspaces SET teaches=1,looking_models=1 WHERE id=?").run(salon.id);
db.prepare('INSERT OR IGNORE INTO profile_categories VALUES(?,?)').run(master.id,'Маникюр');
db.prepare('INSERT OR IGNORE INTO profile_categories VALUES(?,?)').run(staff[0].id,'Макияж');
function token(id){const value=randomUUID();db.prepare('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)').run(createHash('sha256').update(value).digest('hex'),id,Date.now()+3600000,Date.now());return value}
const auth={master:token(master.id),owner:token(owner),stranger:token(fixture.ordinary.id)};
const checks=[],errors=[];
const report=()=>fs.writeFileSync(path.join(output,'report.json'),JSON.stringify({at:new Date().toISOString(),scope:'Real local app/API, disposable synthetic SQLite only',checks,pageErrors:errors},null,2)+'\n');
async function request(route,method='GET',body,role,expected=200){
  const response=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(role?{Cookie:'atelie_session='+auth[role]}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();assert.equal(response.status,expected,route+': '+JSON.stringify(data));return data;
}
async function offer(user,role,name,category,price,duration){
  const endpoint=user===master.id?'/services':'/performers/'+user+'/services';
  const existing=db.prepare('SELECT id FROM services WHERE user_id=? AND name=?').get(user,name);
  if(existing){await request(endpoint+'/'+existing.id+'/direction','PATCH',{category},role);return existing.id}
  return (await request(endpoint,'POST',{name,price,duration,category},role,201)).id;
}

await request('/services/'+master.serviceId+'/direction','PATCH',{category:'Макияж'},'master');
const nail=await offer(master.id,'master','Маникюр с покрытием','Маникюр',2900,90);
const nailShort=await offer(master.id,'master','Маникюр без покрытия','Маникюр',1900,45);
const face=await offer(master.id,'master','Вечерний макияж','Макияж',3400,60);
const salonNail=await offer(staff[0].id,'owner','Маникюр с покрытием','Маникюр',2700,75);
await offer(staff[0].id,'owner','Макияж для события','Макияж',4000,120);
await request('/services/'+master.serviceId+'/direction','PATCH',{category:'Татуировки'},'master',400);
await request('/services/'+master.serviceId+'/direction','PATCH',{category:'Маникюр'},'stranger',404);
await request('/performers/'+staff[0].id+'/services/'+salonNail+'/direction','PATCH',{category:'Макияж'},'stranger',404);
const anonymous=await fetch(origin+'/api/services/'+master.serviceId+'/direction',{method:'PATCH',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({category:'Маникюр'})});assert.equal(anonymous.status,401);
assert.equal((await request('/studio','GET',undefined,'master')).services.find(s=>s.id===nail).category,'Маникюр');
const filtered=await request('/map/details?'+new URLSearchParams({kind:'master',id:master.id,category:'Маникюр'}));
assert.deepEqual(new Set(filtered.services.map(s=>s.id)),new Set([nail,nailShort]));assert.ok([nail,nailShort].includes(filtered.selected_service));
const exact=await request('/map/details?'+new URLSearchParams({kind:'master',id:master.id,category:'Маникюр',service:nail}));
assert.equal(exact.availability.service.id,nail);assert.equal(exact.availability.service.duration,90);assert.equal(exact.availability.service.price,2900);
await request('/map/details?'+new URLSearchParams({kind:'master',id:master.id,category:'Маникюр',service:face}),'GET',undefined,undefined,409);
const salonDetails=await request('/map/details?'+new URLSearchParams({kind:'salon',id:salon.id,category:'Макияж'}));
assert.ok(salonDetails.services.length);assert.ok(salonDetails.services.every(s=>s.category==='Макияж'));assert.ok(salonDetails.availability?.performer.id);
const publicSalon=await request('/public/salons/'+salon.slug);assert.ok(publicSalon.services.some(s=>s.id===salonDetails.selected_service));
checks.push({name:'real-api-save-reload-rights-category-filter-duration-price-and-salon-group-id',pass:true});report();

const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000},serviceWorkers:'block'}),page=await context.newPage();
page.on('pageerror',error=>errors.push(error.message));
async function login(role){await context.clearCookies();if(role)await context.addCookies([{name:'atelie_session',value:auth[role],url:origin}])}
async function capture(name){await page.evaluate(()=>document.fonts.ready);await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,name+' overflow');await page.screenshot({path:path.join(output,name+'.png')});checks.push({name,pass:true});report()}
try{
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:width>760?1000:844});
    for(const [kind,route] of [['master','/m/'+master.slug],['salon','/s/'+salon.slug]]){
      await page.goto(origin+'/v2'+route);await page.locator('.public-identity').waitFor();
      const address=await page.locator('.public-identity .public-address').innerText();assert.match(address,/дом|д\s|Тестовая/);assert.ok(address.includes('Москва'));
      assert.equal(await page.locator('.public-identity-actions .button-wine').count(),0);
      const own=page.getByRole('link',{name:'Или выбрать своё время',exact:true});await own.waitFor();
      assert.equal(new URL(await own.getAttribute('href'),origin).searchParams.has('start'),false);
      const primary=page.getByRole('link',{name:'Выбрать это время',exact:true});await primary.waitFor();
      const first=await primary.boundingBox(),second=await own.boundingBox();assert.ok(second.y>=first.y+first.height);assert.ok(Math.abs(first.width-second.width)<1);assert.ok(Math.abs(first.height-second.height)<1);
      const ownService=new URL(await own.getAttribute('href'),origin).searchParams.get('service');assert.ok(ownService);
      assert.equal(await page.locator('.public-cover-pattern').evaluate(el=>getComputedStyle(el).backgroundRepeat),'no-repeat');
      assert.equal(await page.locator('.bottom-nav:visible').count(),0);
      await capture(kind+'-'+width);
      await page.getByRole('button',{name:kind==='master'?'О мастере':'О салоне',exact:true}).click();
      assert.equal(await page.locator('.public-panel .public-address').count(),0);
      await page.locator('.site-footer').scrollIntoViewIfNeeded();assert.ok(await page.locator('.site-footer').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom))<=32);
      if(width===390)await capture(kind+'-footer-390');
    }
  }
  db.prepare("UPDATE profiles SET city='Москва, проверка макета' WHERE user_id IN (?,?)").run(master.id,fixture.ordinary.id);
  db.prepare("UPDATE profiles SET name='Анна — мастер с длинным названием студии и несколькими направлениями' WHERE user_id=?").run(fixture.ordinary.id);
  db.prepare("UPDATE workspaces SET city='Москва, проверка макета' WHERE id=?").run(salon.id);
  await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/v2/masters?q='+encodeURIComponent('проверка макета'));await page.locator('.compact-master-card').first().waitFor();
  const cards=page.locator('.compact-master-card');await expect(cards).toHaveCount(3);await expect(page.locator('.compact-master-card-salon .compact-master-rating')).toContainText('4.5');await expect(page.locator('.compact-master-card-salon .compact-master-location')).toContainText('корпус 3');
  assert.equal(await cards.locator('.compact-master-rating').count(),await cards.count());
  assert.ok((await cards.first().locator('.compact-master-location').innerText()).length>15);
  await page.evaluate(()=>document.fonts.ready);
  const shapes=await cards.evaluateAll(els=>els.map(el=>({title:el.querySelector('h3').getBoundingClientRect().bottom,badges:el.querySelector('.profile-badges').getBoundingClientRect().top})));assert.ok(shapes.every(shape=>shape.badges>=shape.title-1),'Title and badges do not overlap after fonts load');
  const rows=await cards.evaluateAll(els=>els.map(el=>({top:Math.round(el.getBoundingClientRect().top),bottom:el.getBoundingClientRect().bottom,action:el.querySelector('.compact-master-footer').getBoundingClientRect().top})));
  for(const row of rows){const peers=rows.filter(other=>other.top===row.top);assert.ok(Math.max(...peers.map(x=>x.action))-Math.min(...peers.map(x=>x.action))<2)}
  await capture('catalog-1440');await page.setViewportSize({width:320,height:844});await capture('catalog-320');
  const mobileRows=await cards.evaluateAll(els=>els.map(el=>({rating:el.querySelector('.compact-master-rating').getBoundingClientRect().bottom,address:el.querySelector('.compact-master-location').getBoundingClientRect().top})));assert.ok(mobileRows.every(row=>row.address>=row.rating-1),'Mobile salon rating and address occupy separate rows');
  db.prepare("UPDATE profiles SET city='Москва' WHERE user_id IN (?,?)").run(master.id,fixture.ordinary.id);db.prepare("UPDATE workspaces SET city='Москва' WHERE id=?").run(salon.id);

  for(const [role,route,section] of [['master','/studio','Услуги'],['owner','/salon','Услуги и графики']]){
    await login(role);await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/v2'+route);
    await page.getByRole('button',{name:section,exact:true}).first().click();await page.locator('.service-direction-editor').first().waitFor();
    const editor=page.locator('.service-direction-editor').first(),select=editor.locator('select');
    const options=await select.locator('option').evaluateAll(els=>els.map(el=>el.value).filter(Boolean));
    if(options.length>1){const old=await select.inputValue(),next=options.find(option=>option!==old);const saved=page.waitForResponse(response=>response.url().endsWith('/direction')&&response.request().method()==='PATCH'&&response.status()===200);await select.selectOption(next);await saved;await page.reload();await page.getByRole('button',{name:section,exact:true}).first().click();await expect(page.locator('.service-direction-editor select').first()).toHaveValue(next)}
    await capture(role+'-services-1440');await page.setViewportSize({width:390,height:844});await capture(role+'-services-390');
  }
  await request('/services/'+master.serviceId+'/direction','PATCH',{category:'Макияж'},'master');
  const firstEmployeeService=db.prepare('SELECT id FROM services WHERE user_id=? ORDER BY rowid').get(staff[0].id);await request('/performers/'+staff[0].id+'/services/'+firstEmployeeService.id+'/direction','PATCH',{category:'Маникюр'},'owner');
  await login();
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:width>760?1000:844});await page.goto(origin+'/v2/map');
    if(width<=760){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox').selectOption('Маникюр');await dialog.getByRole('button',{name:/Показать/}).click();await page.getByRole('button',{name:'Список',exact:true}).click()}
    else await page.getByRole('combobox',{name:'Направление на карте'}).selectOption('Маникюр');
    await page.getByRole('button',{name:'Открыть карточку: '+master.name,exact:true}).click();
    const select=page.locator('.map-service-picker select');await select.waitFor();
    assert.equal(await select.locator('option').count(),2);await select.selectOption(nail);
    await expect(page.locator('.map-selected-card')).toHaveAttribute('aria-busy','false');
    await expect(page.locator('.map-card-price')).toContainText('90 мин');await expect(page.locator('.map-card-price')).toContainText('2 900');
    await capture('map-service-'+width);
    const book=page.locator('.map-card-book');const href=new URL(await book.getAttribute('href'),origin);assert.equal(href.searchParams.get('service'),nail);assert.ok(href.searchParams.get('start'));
    await book.click();await page.waitForURL('**/book/**');await page.goBack();await page.locator('.map-service-picker select').waitFor();await expect(page.locator('.map-service-picker select')).toHaveValue(nail);
    checks.push({name:'map-service-booking-back-'+width,pass:true});report();
  }
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:width>760?1000:844});await page.goto(origin+'/v2/map');
    if(width<=760){await page.getByRole('button',{name:'Открыть фильтры',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.getByRole('combobox').selectOption('Макияж');await dialog.getByRole('button',{name:/Показать/}).click();await page.getByRole('button',{name:'Список',exact:true}).click()}
    else await page.getByRole('combobox',{name:'Направление на карте'}).selectOption('Макияж');
    await page.getByRole('button',{name:'Открыть карточку: '+salon.name,exact:true}).click();await page.locator('.map-service-picker select').waitFor();await expect(page.locator('.map-selected-card')).toHaveAttribute('aria-busy','false');
    assert.equal(await page.locator('.map-service-picker option').count(),1);await expect(page.locator('.map-card-price')).toContainText('120 мин');
    const target=new URL(await page.locator('.map-card-book').getAttribute('href'),origin);assert.equal(target.searchParams.get('service'),salonDetails.selected_service);assert.equal(target.searchParams.get('master'),salonDetails.availability.performer.id);
    await expect(page.locator('.map-selected-card .profile-badges')).toContainText('Ищем моделей');await capture('salon-map-service-'+width);
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);assert.deepEqual(errors,[]);report();console.log('PROFILE SERVICE POLISH PASS: '+checks.length+' checks; '+output);
}finally{report();await browser.close();db.close()}
