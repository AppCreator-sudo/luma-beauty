import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const origin=process.env.TEST_ORIGIN||'https://atelie-13-143-66-1.sslip.io';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
fs.mkdirSync('media/qa',{recursive:true});
try{
  const response=await page.request.get(origin+'/api/profiles');assert.equal(response.status(),200);
  const profiles=await response.json(),demos=profiles.filter(p=>p.is_demo);
  assert.equal(demos.length,3);assert.equal(demos.reduce((n,p)=>n+p.works.length,0),9);
  for(const p of demos)for(const w of p.works)assert.ok(w.images.length>1);
  await page.goto(origin+'/m/demo-anna',{waitUntil:'networkidle'});
  await page.getByRole('heading',{name:'Анна · пример страницы',exact:true}).waitFor();
  assert.ok((await page.locator('.notice').innerText()).includes('Демонстрационная'));
  await page.screenshot({path:'media/qa/live-demo-profile-mobile.png',fullPage:true});
  await page.getByRole('link',{name:/Открыть работу/}).first().click();
  await page.getByRole('button',{name:'Следующее фото'}).waitFor();
  await page.getByRole('button',{name:'Следующее фото'}).click();
  await page.locator('.gallery-count').filter({hasText:/2 \//}).waitFor();
  assert.equal(await page.getByRole('button',{name:/Хочу так же/}).count(),0);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
  await page.screenshot({path:'media/qa/live-gallery-mobile.png',fullPage:true});
  await page.goto(origin+'/feed');await page.getByRole('heading',{name:'Лента ваших подписок',exact:true}).waitFor();
  for(const asset of ['/media.js','/booking-draft.js'])assert.equal((await page.request.get(origin+asset)).status(),200);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,origin,checks:['3 labelled demo profiles','9 multi-photo publications','mobile profile','gallery next image','no demo booking button','guest feed entry','module assets','no overflow','no JS errors']}));
}finally{await browser.close()}
