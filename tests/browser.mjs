import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const origin=process.env.TEST_ORIGIN||'http://localhost:3100';
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto(origin);await page.getByRole('heading',{name:'Найдите своего мастера.'}).waitFor();
 await page.screenshot({path:'desktop-check.png',fullPage:true});
 await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
 const login='qa_'+Date.now();
 await page.getByLabel('Я мастер').check();await page.getByLabel('Логин',{exact:true}).fill(login);await page.getByLabel('Пароль',{exact:true}).fill('BrowserTestPassword123');await page.locator('form[data-form="auth"] button[type=submit]').click();
 await page.getByRole('heading',{name:'Сохраните код восстановления'}).waitFor();await page.getByRole('button',{name:'Я сохранил код'}).click();await page.goto(origin+'/studio');
 await page.getByLabel('Имя / название студии').fill('Анна Тестовая');await page.getByLabel('Город',{exact:true}).fill('Новосибирск');await page.getByLabel('Адрес страницы').fill(login.replaceAll('_','-'));await page.getByLabel('О себе',{exact:true}).fill('Проверка сценария мастера');await page.getByLabel('Винное').check();await page.getByLabel('Опубликовать страницу в каталоге').check();await page.getByRole('button',{name:'Сохранить страницу'}).click();
 await page.getByRole('heading',{name:'Здравствуйте, Анна.'}).waitFor();
 await page.getByRole('button',{name:'Добавить',exact:true}).click();await page.getByLabel('Название',{exact:true}).fill('Маникюр с покрытием');await page.getByLabel('Стоимость, ₽').fill('2400');await page.getByRole('button',{name:'Добавить услугу'}).click();await page.getByRole('heading',{name:'Маникюр с покрытием'}).waitFor();
 await page.getByRole('button',{name:'Добавить работу'}).click();await page.locator('input[type=file]').setInputFiles('public/icon-512.png');await page.getByLabel('Подпись').fill('Тестовое изображение');await page.getByLabel('Связанная услуга').selectOption({index:1});await page.getByRole('button',{name:'Опубликовать работу'}).click();await page.getByText('Тестовое изображение',{exact:true}).waitFor();
 await page.getByRole('link',{name:'Мои записи',exact:true}).click();await page.getByRole('button',{name:'Новая запись'}).click();await page.getByLabel('Имя клиента').fill('Мария');await page.locator('select[name=service_id]').selectOption({index:1});await page.getByRole('button',{name:'Сохранить запись'}).click();await page.getByRole('heading',{name:'Мария',exact:true}).waitFor();
 const bookedDate=await page.locator('#date-jump').inputValue();await page.screenshot({path:'calendar-check.png',fullPage:true});
 await page.reload();await page.locator('#date-jump').fill(bookedDate);await page.locator('#date-jump').dispatchEvent('change');await page.getByRole('heading',{name:'Мария',exact:true}).waitFor();
 await page.getByRole('button',{name:'Перенести',exact:true}).click();await page.getByRole('heading',{name:'Перенести запись'}).waitFor();await page.getByRole('button',{name:'Закрыть',exact:true}).click();
 const reg=await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;return {scope:r.scope,active:!!r.active}});assert.equal(reg.active,true);
 await page.goto(origin+'/map');await page.locator('.leaflet-control-zoom-in').waitFor();
 const clientContext=await browser.newContext({viewport:{width:390,height:844}}),clientPage=await clientContext.newPage();clientPage.on('pageerror',e=>errors.push('client: '+e.message));
 await clientPage.goto(origin);await clientPage.getByRole('button',{name:'Войти',exact:true}).click();await clientPage.getByRole('button',{name:'Создать аккаунт',exact:true}).click();
 const clientLogin='client_'+Date.now();await clientPage.getByLabel('Я клиент').check();await clientPage.getByLabel('Логин',{exact:true}).fill(clientLogin);await clientPage.getByLabel('Пароль',{exact:true}).fill('BrowserTestPassword123');await clientPage.locator('form[data-form="auth"] button[type=submit]').click();await clientPage.getByRole('heading',{name:'Сохраните код восстановления'}).waitFor();await clientPage.getByRole('button',{name:'Я сохранил код'}).click();
 await clientPage.goto(origin+'/m/'+login.replaceAll('_','-'));await clientPage.getByRole('button',{name:/Подписаться/}).click();await clientPage.getByRole('button',{name:/Вы подписаны/}).waitFor();
 await clientPage.getByRole('link',{name:/Открыть работу/}).click();await clientPage.getByRole('heading',{name:'Тестовое изображение'}).waitFor();await clientPage.getByRole('button',{name:/Сохранить/}).click();await clientPage.getByRole('button',{name:/Сохранено/}).waitFor();
 await clientPage.getByRole('button',{name:/Хочу так же/}).click();await clientPage.getByLabel('Ваше имя').fill('Елена');await clientPage.locator('input[name=date]').evaluate(el=>{const d=new Date(el.value),pad=n=>String(n).padStart(2,'0');d.setDate(d.getDate()+2);d.setHours(14,0,0,0);el.value=`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T14:00`});await clientPage.getByRole('button',{name:/Отправить заявку/}).click();await clientPage.getByRole('heading',{name:'Анна Тестовая'}).waitFor();const clientBookedDate=await clientPage.locator('#date-jump').inputValue();
 await page.goto(origin+'/calendar');await page.locator('#date-jump').fill(clientBookedDate);await page.locator('#date-jump').dispatchEvent('change');await page.getByText(/Хочет работу «Тестовое изображение»/).first().waitFor();const request=page.locator('.appointment').filter({hasText:'Елена'}).first();await request.getByRole('button',{name:'Подтвердить'}).click();await request.getByRole('button',{name:'Завершить'}).click();
 await clientPage.goto(origin+'/me');await clientPage.getByRole('heading',{name:'Сохранённые работы'}).waitFor();await clientPage.getByText('Тестовое изображение',{exact:true}).waitFor();await clientPage.getByRole('heading',{name:'Анна Тестовая'}).last().waitFor();await clientPage.getByRole('button',{name:'Оставить отзыв'}).click();await clientPage.getByLabel('Ваш отзыв').fill('Прекрасный результат и внимательный мастер');await clientPage.getByRole('button',{name:/Опубликовать отзыв/}).click();await clientPage.locator('#toast').getByText('Отзыв опубликован',{exact:true}).waitFor();await clientPage.screenshot({path:'client-library-check.png',fullPage:true});await clientPage.goto(origin+'/m/'+login.replaceAll('_','-'));await clientPage.getByText('Прекрасный результат и внимательный мастер',{exact:true}).waitFor();await clientContext.close();
 await page.setViewportSize({width:390,height:844});await page.goto(origin);await page.getByRole('heading',{name:'Найдите своего мастера.'}).waitFor();await page.screenshot({path:'mobile-check.png',fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow');
 await page.goto(origin+'/studio');await page.getByRole('heading',{name:'Здравствуйте, Анна.'}).waitFor();
 await page.screenshot({path:'mobile-studio-check.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,checks:['role selection','master dashboard','client dashboard','desktop','mobile 390px','profile','service','linked portfolio work','client follow','save work','book from reference','visit history','verified review','calendar reference','persistence after reload','map','service worker','no JS errors'],testLogin:login,clientLogin}));
}catch(e){await page.screenshot({path:'browser-failure.png',fullPage:true});console.error(await page.locator('body').innerText());throw e}finally{await browser.close()}


