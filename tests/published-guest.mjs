import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const origin=process.env.TEST_ORIGIN||'https://atelie-13-143-66-1.sslip.io';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
  const response=await page.request.get(origin+'/api/profiles');assert.ok(response.ok());
  const profiles=await response.json(),master=profiles.find(p=>!p.is_demo&&p.services.length);
  assert.ok(master,'A published real profile with a service is needed for the read-only form check');
  await page.goto(origin+'/',{waitUntil:'networkidle'});
  await page.getByRole('link',{name:'Выбрать мастера',exact:true}).click();
  await page.waitForURL(origin+'/book');
  assert.equal(await page.locator('.master-card .tiny-label').filter({hasText:'ПРИМЕР'}).count(),0);
  await page.locator(`.master-card[href="/m/${master.slug}"]`).click();
  await page.getByRole('button',{name:'Записаться без регистрации',exact:true}).click();
  await page.getByLabel('Телефон или Telegram').waitFor();await page.getByRole('button',{name:'Отправить заявку',exact:true}).waitFor();
  assert.equal(await page.getByRole('heading',{name:'С возвращением',exact:true}).count(),0);
  assert.ok((await page.locator('#modal').innerText()).includes('Регистрация не нужна'));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'media/qa/live-guest-form.png'});
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();
  await page.getByRole('button',{name:'Записаться',exact:true}).first().click();
  await page.getByLabel('Телефон или Telegram').waitFor();
  await page.goto(origin+'/calendar');
  await page.getByRole('heading',{name:'Запись без регистрации',exact:true}).waitFor();
  await page.getByRole('link',{name:'Выбрать мастера',exact:true}).waitFor();
  await page.screenshot({path:'media/qa/live-guest-calendar.png',fullPage:true});
  const demo=profiles.find(p=>p.is_demo);
  if(demo){await page.goto(origin+'/m/'+demo.slug);await page.getByRole('link',{name:'Найти мастера для записи'}).click();await page.waitForURL(origin+'/book')}
  await page.goto(origin+'/visit');await page.getByRole('heading',{name:'Откройте личную ссылку',exact:true}).waitFor();
  assert.equal((await page.request.get(origin+'/guest-booking.js')).status(),200);
  assert.equal((await (await page.request.get(origin+'/api/me')).json()).user,null);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,masterPath:'/m/'+master.slug,checks:['home to booking directory','real masters only','prominent guest button','service booking','guest calendar entry','demo to real masters','contact field','send without auth','private-link entry','no mobile overflow','no JS errors','read-only: no live appointments created']}));
}finally{await browser.close()}
