import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const origin=process.env.TEST_ORIGIN||'http://localhost:3100';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
try{
 const health=await page.request.get(origin+'/api/health');assert.equal(health.ok(),true);
 await page.goto(origin,{waitUntil:'networkidle'});await page.getByRole('heading',{name:/Мастера|Найдите своего мастера/}).waitFor();
 assert.ok(await page.evaluate(()=>document.body.innerText.trim().length>0));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.goto(origin+'/me',{waitUntil:'networkidle'});await page.getByRole('heading',{name:'Красота, которую вы выбрали.'}).waitFor();
 await page.getByRole('button',{name:'Войти',exact:true}).last().click();await page.getByRole('heading',{name:'С возвращением'}).waitFor();
 await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();await page.getByLabel('Я клиент').waitFor();await page.getByLabel('Я мастер').waitFor();
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,origin,checks:['https health','home content','mobile overflow','client entry','role selection','auth dialog','no page errors']}));
}finally{await browser.close()}
