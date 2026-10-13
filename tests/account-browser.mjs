import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';

const origin=process.env.TEST_ORIGIN||'http://localhost:3102';
if(!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))throw Error('Account browser test must run locally');
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const id=Date.now(),login=`client_settings_${id}`,oldPassword='OldClientPassword123',newPassword='NewClientPassword123';
try{
  await page.goto(origin+'/me');
  await page.getByRole('button',{name:'Создать аккаунт клиента'}).click();
  await page.getByLabel('Я клиент').check();
  await page.getByLabel('Логин',{exact:true}).fill(login);
  await page.getByLabel('Пароль',{exact:true}).fill(oldPassword);
  await page.locator('form[data-form=auth]').getByRole('button',{name:'Создать аккаунт'}).click();
  await page.getByRole('heading',{name:'Сохраните код восстановления'}).waitFor();
  await page.getByRole('button',{name:'Я сохранил код'}).click();
  await page.getByRole('heading',{name:'Настройки',exact:true}).waitFor();
  await page.getByRole('button',{name:'Настройки аккаунта'}).click();
  await page.getByLabel('Текущий пароль').fill(oldPassword);
  await page.getByLabel('Новый пароль',{exact:true}).fill(newPassword);
  await page.getByLabel('Повторите новый пароль',{exact:true}).fill(newPassword);
  await page.getByRole('button',{name:'Сменить пароль'}).click();
  await page.locator('#toast').getByText('Пароль изменён',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Выйти из аккаунта'}).click();
  await page.getByRole('button',{name:'Войти'}).waitFor();
  await page.getByRole('button',{name:'Войти'}).click();
  await page.getByLabel('Логин',{exact:true}).fill(login);
  await page.getByLabel('Пароль',{exact:true}).fill(newPassword);
  await page.locator('form[data-form=auth]').getByRole('button',{name:'Войти'}).click();
  await page.getByRole('heading',{name:'Настройки',exact:true}).waitFor();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['client settings visible','password change requires current password','logout ends session','login accepts new password','mobile no overflow','no JS errors']}));
}finally{await browser.close()}
