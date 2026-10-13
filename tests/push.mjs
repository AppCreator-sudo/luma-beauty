import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{
 const context=await browser.newContext({permissions:['notifications']});
 const page=await context.newPage();
 await page.goto('http://localhost:3100');
 await page.evaluate(()=>navigator.serviceWorker.ready);
 const worker=context.serviceWorkers()[0];
 await worker.evaluate(()=>self.dispatchEvent(new PushEvent('push',{data:JSON.stringify({title:'Ателье — проверка',body:'Проверка обработчика Web Push',url:'/calendar'})})));
 let notifications=[];
 for(let i=0;i<20;i++){notifications=await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return (await r.getNotifications()).map(n=>({title:n.title,body:n.body,url:n.data.url}))});if(notifications.length)break;await new Promise(r=>setTimeout(r,100))}
 assert.equal(notifications[0]?.title,'Ателье — проверка');assert.equal(notifications[0]?.url,'/calendar');
 await page.evaluate(async()=>{for(const n of await (await navigator.serviceWorker.ready).getNotifications())n.close()});
 console.log('PASS: push event -> service worker -> notification with calendar link. External push delivery is not simulated as verified.');
}finally{await browser.close()}
