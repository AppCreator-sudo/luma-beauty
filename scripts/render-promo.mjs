import {chromium} from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const root=path.resolve('.'),mediaDir=path.join(root,'media'),outputDir=path.join(mediaDir,'.rendered');
if(path.dirname(outputDir)!==mediaDir)throw Error('Unsafe render directory');
fs.rmSync(outputDir,{recursive:true,force:true});fs.mkdirSync(outputDir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:outputDir,size:{width:1280,height:720}}});
const page=await context.newPage(),video=page.video();
await page.goto(pathToFileURL(path.join(root,'media','promo-assembly.html')).href,{waitUntil:'load'});
await page.waitForTimeout(8000);
await context.close();await browser.close();
const source=await video.path(),target=path.join(root,'media','atelie-assembly-promo.webm');
fs.copyFileSync(source,target);fs.rmSync(outputDir,{recursive:true,force:true});
console.log(target);
