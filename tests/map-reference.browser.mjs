import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(process.env.LUMA_MAP_TEST_ROOT || '.cache/u09-reference-test');
assert.ok(root.startsWith(path.resolve('.cache')+path.sep));
const fixture=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8')),base=fixture.origin;
assert.match(base,/^http:\/\/localhost:\d+$/);
const browser=await chromium.launch({channel:'chrome',headless:true});
const checks=[],errors=[];
const card=p=>p.getByRole('article',{name:'Карточка выбранного мастера или салона'});
const read=async route=>{const r=await fetch(base+'/api'+route);assert.equal(r.status,200);return r.json()};
async function geometry(p,width){
 const popup=card(p);await expect(popup).toBeVisible();
 await expect.poll(async()=>{const a=await popup.boundingBox(),b=await p.locator('.map-canvas').boundingBox(),m=await p.locator('.atelier-marker-selected').boundingBox();if(!a||!b||!m)return false;return a.x>=b.x-1&&a.y>=b.y-1&&a.x+a.width<=b.x+b.width+1&&a.y+a.height<=b.y+b.height+1&&m.x>=b.x&&m.y>=b.y&&m.x+m.width<=b.x+b.width+1&&m.y+m.height<=b.y+b.height+1&&(m.x+m.width<a.x||m.x>a.x+a.width||m.y+m.height<a.y||m.y>a.y+a.height)}, {message:'Card and selected marker separated inside map '+width,timeout:10000}).toBe(true);
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'page overflow '+width);
 assert.equal(await popup.evaluate(e=>e.scrollWidth>e.clientWidth),false,'card overflow '+width);
 const close=await popup.getByRole('button',{name:'Закрыть карточку'}).boundingBox();assert.ok(close.width>=44&&close.height>=44);
 const attribution=await p.locator('.leaflet-control-attribution').boundingBox(),box=await popup.boundingBox();assert.ok(box.y+box.height<=attribution.y,'OSM attribution uncovered');
}
try{
 for(const [width,height] of [[1440,900],[390,844],[320,568],[800,600]]){
  const c=await browser.newContext({viewport:{width,height},hasTouch:width<=800,isMobile:width<=390});
  // Deterministic test tiles; browser/API/data remain the real application.
  await c.route('https://*.tile.openstreetmap.org/**',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><path fill="#eeece3" d="M0 0h256v256H0z"/><path stroke="#fff" stroke-width="15" d="M0 128h256M128 0v256"/><path stroke="#d3deca" stroke-width="4" fill="none" d="M20 20h80v80H20zM150 150h80v80h-80z"/></svg>'}));
  const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
  await p.goto(base+'/v2/map?q='+encodeURIComponent(fixture.free.name));
  await expect(p.locator('.map-result-count')).toHaveText('В этой области: 1');
  await expect(p.locator('.public-reference-header')).toBeVisible();assert.equal(await p.locator('.bottom-nav').count(),0);assert.equal(await p.locator('.site-footer').count(),0);
  if(width<=800)await p.getByRole('button',{name:'Список',exact:true}).click();
  await p.getByRole('button',{name:'Открыть карточку: '+fixture.free.name,exact:true}).click();
  await expect(card(p).getByRole('link',{name:'Записаться'})).toBeVisible();await geometry(p,width);
  await expect(card(p).locator('.map-rating')).toContainText('4.5 · 2 отзыва');
  assert.equal(await p.locator('.atelier-marker-selected .map-pin-frame').evaluate(e=>getComputedStyle(e).transform),'none');
  await expect(p.locator('.atelier-marker-selected .map-pin-body')).toHaveCount(1);
  await p.evaluate(()=>{window.mapEmptyFlashes=[];window.mapEmptyObserver=new MutationObserver(()=>{const text=document.querySelector('.map-message')?.textContent;if(text?.includes('Здесь пока никого нет'))window.mapEmptyFlashes.push(text)});window.mapEmptyObserver.observe(document.querySelector('.map-canvas-wrap'),{subtree:true,childList:true,characterData:true})});
  const beforeZoom=await p.evaluate(()=>window.history.state.usr.mapView.view.zoom);await p.locator('.leaflet-control-zoom-in').click();await expect.poll(()=>p.evaluate(()=>window.history.state.usr.mapView.view.zoom)).toBeGreaterThan(beforeZoom);await geometry(p,width);
  await expect(p.locator('.map-result-count')).toHaveText('В этой области: 1');const count='В этой области: 1';
  assert.deepEqual(await p.evaluate(()=>{window.mapEmptyObserver.disconnect();return window.mapEmptyFlashes}),[],'No false empty flash while zooming selected place '+width);
  await p.screenshot({path:path.join(root,'map-'+width+'.png')});
  await p.getByRole('button',{name:'Список',exact:true}).click();await p.getByRole('button',{name:'Карта',exact:true}).click();await geometry(p,width);await expect(p.locator('.map-result-count')).toHaveText(count);
  if(width<=800){
   await p.getByRole('button',{name:'Открыть фильтры'}).click();await expect(p.getByRole('dialog',{name:'Фильтры'})).toBeVisible();await p.goBack();await expect(p.getByRole('dialog',{name:'Фильтры'})).toHaveCount(0);await expect(card(p)).toBeVisible();
   if(width<=760){await p.getByRole('button',{name:'Открыть меню'}).click();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toBeVisible();await p.mouse.wheel(0,700);await p.goBack();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toHaveCount(0);await geometry(p,width);}
  }
  await p.getByRole('button',{name:'Закрыть карточку'}).click();await expect(card(p)).toHaveCount(0);assert.match(p.url(),/\/v2\/map/);
  checks.push({width,height,selection:true,geometry:true,zoomWithoutEmptyFlash:true,viewPreserved:true,noOldNavigation:true,history:true});
  await c.close();console.log('PASS geometry/views/history '+width+'x'+height);
 }
 const c=await browser.newContext({viewport:{width:390,height:844}}),p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto(base+'/v2/map?q='+encodeURIComponent('Москва'));await p.getByRole('button',{name:'Список',exact:true}).click();
 await expect(p.locator('.map-entry')).toHaveCount(24);await p.getByRole('button',{name:'Показать ещё',exact:true}).click();await expect(p.locator('.map-entry')).toHaveCount(48);const names=await p.locator('.map-result').evaluateAll(es=>es.map(e=>e.getAttribute('aria-label')));assert.equal(new Set(names).size,names.length);
 await p.getByRole('button',{name:'Карта',exact:true}).click();await p.getByRole('button',{name:'Список',exact:true}).click();assert.equal(await p.locator('.map-entry').count(),48);
 await p.getByRole('button',{name:'Открыть фильтры'}).click();await p.locator('#map-mobile-category').selectOption('Макияж');await p.getByRole('dialog').getByRole('checkbox').check();await p.getByRole('button',{name:'Показать результаты'}).click();await expect(p.locator('.map-result-count')).toHaveText('В этой области: 2');
 await p.goto(base+'/v2/map?q='+encodeURIComponent(fixture.salon.name));await expect(p.locator('.map-result-count')).toHaveText('В этой области: 1');await p.getByRole('button',{name:'Список',exact:true}).click();await p.getByRole('button',{name:'Открыть карточку: '+fixture.salon.name,exact:true}).click();await expect(card(p).getByRole('link',{name:'Записаться'})).toBeVisible();
 await expect(card(p).locator('.map-rating')).toContainText('4.5 · 2 отзыва');const book=card(p).getByRole('link',{name:'Записаться'}),href=await book.getAttribute('href'),url=new URL(href,base);assert.equal(url.searchParams.get('master'),fixture.salonStaff.id);assert.ok(url.searchParams.get('service'));assert.ok(Number(url.searchParams.get('start'))>Date.now()-1000);await book.click();await expect(p.locator('.booking-reference')).toBeVisible();await p.goBack();await expect(p.getByRole('searchbox',{name:'Поиск на карте'})).toHaveValue(fixture.salon.name);await expect(card(p)).toBeVisible();
 await p.goto(base+'/v2/map?q='+encodeURIComponent('Тату мастер'));await expect(p.locator('.map-result-count')).toHaveText('В этой области: 30');await p.locator('.atelier-cluster').first().click();await expect(p.locator('.map-group-reset')).toBeVisible();await expect(p.getByRole('button',{name:'Список',exact:true})).toHaveAttribute('aria-pressed','true');await p.getByRole('button',{name:'Открыть карточку: Тату мастер 00',exact:true}).click();await expect(card(p)).toBeVisible();await p.goBack();await expect(card(p)).toHaveCount(0);await expect(p.locator('.map-group-reset')).toBeVisible();
 await p.goto(base+'/v2/map?q=zzzz-no-match');await p.getByRole('button',{name:'Список',exact:true}).click();await expect(p.getByRole('heading',{name:'Здесь пока никого нет'})).toBeVisible();
 await p.route('**/api/map/viewport?**',r=>r.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Тест недоступности API'})}));await p.getByRole('searchbox',{name:'Поиск на карте'}).fill('Москва');await expect(p.getByRole('heading',{name:'Не удалось загрузить места'})).toBeVisible();await p.unroute('**/api/map/viewport?**');await p.getByRole('button',{name:'Повторить',exact:true}).click();await expect(p.locator('.map-entry').first()).toBeVisible();
 await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
 await c.grantPermissions([], {origin:base});
 await p.goto(base+'/v2/map?q='+encodeURIComponent(fixture.ordinary.name));await expect(p.locator('.map-result-count')).toHaveText('В этой области: 1');await p.getByRole('button',{name:'Найти мастеров рядом'}).click();await expect(p.locator('.map-message')).toContainText('Не удалось определить местоположение');
 let release;const blocked=new Promise(resolve=>release=resolve);await p.route('**/api/map/details?**',async route=>{await blocked;await route.continue()});
 await p.getByRole('button',{name:'Список',exact:true}).click();await p.getByRole('button',{name:'Открыть карточку: '+fixture.ordinary.name,exact:true}).click();await expect(card(p).locator('.map-rating')).toHaveText('Пока без оценок');await expect(card(p).getByRole('status')).toHaveText('Ищем ближайшее время…');release();await expect(card(p).getByRole('link',{name:'Записаться'})).toBeVisible();await p.unroute('**/api/map/details?**');
 await p.route('**/api/map/details?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Проверочная ошибка карточки'})}));
 await p.getByRole('button',{name:'Закрыть карточку'}).click();await p.getByRole('button',{name:'Список',exact:true}).click();await p.getByRole('button',{name:'Открыть карточку: '+fixture.ordinary.name,exact:true}).click();await expect(card(p).getByRole('alert')).toContainText('Проверочная ошибка карточки');await expect(card(p).getByRole('link',{name:'Записаться'})).toHaveCount(0);await expect(card(p).getByRole('link',{name:'Страница мастера'})).toBeVisible();await p.unroute('**/api/map/details?**');await card(p).getByRole('button',{name:'Повторить'}).click();await expect(card(p).getByRole('link',{name:'Записаться'})).toBeVisible();
 const noTime=fixture.records.find(x=>x.slug==='card-no-time');await p.goto(base+'/v2/map?q='+encodeURIComponent(noTime.name));await expect(p.locator('.map-result-count')).toHaveText('В этой области: 1');await p.getByRole('button',{name:'Список',exact:true}).click();await p.getByRole('button',{name:'Открыть карточку: '+noTime.name,exact:true}).click();await expect(card(p)).toContainText('Нет свободного времени в ближайшие 7 дней');await expect(card(p).getByRole('link',{name:'Посмотреть расписание'})).toBeVisible();
 await p.route('https://*.tile.openstreetmap.org/**',route=>route.abort());await p.reload();await expect(p.locator('.map-message')).toContainText('Подложка карты временно недоступна');await expect(p.getByRole('button',{name:'Открыть список'})).toBeVisible();
 checks.push({ratingsMasterAndSalon:true,unrated:true,svgDropMarkers:true,detailsLoading:true,detailsErrorRetry:true,noTimeFromRealCalendar:true,geolocationDenied:true,tileFailure:true});
 checks.push({paging:true,uniqueRows:true,filters:true,salonEmployeeLink:true,bookingAndBack:true,coincidentGroup:true,empty:true,retry:true,reducedMotion:true});
 assert.deepEqual(errors,[]);await c.close();
 fs.writeFileSync(path.join(root,'browser-report.json'),JSON.stringify({at:new Date().toISOString(),origin:base,data:'fresh isolated synthetic SQLite; no production data',checks,pageErrors:errors},null,2)+'\n');
 console.log('PASS real API: paging/filters/salon booking/back/group/empty/error/reduced motion');
}finally{await browser.close()}
