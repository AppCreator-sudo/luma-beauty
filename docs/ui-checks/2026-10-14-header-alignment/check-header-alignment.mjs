import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const origin=process.env.LUMA_HEADER_ORIGIN||'http://localhost:3250',phase=process.env.LUMA_HEADER_PHASE||'after',out='.cache/header-alignment-'+phase+'.json';
const args=['--disable-features=OverlayScrollbar,OverlayScrollbars'];if(origin.startsWith('https:'))args.push('--host-resolver-rules=MAP atelie-13-143-66-1.sslip.io 13.143.66.1');
const browser=await chromium.launch({channel:'chrome',headless:true,ignoreDefaultArgs:['--hide-scrollbars'],args}),results=[];
try{
 for(const width of [1365,1440,800,390,320].filter(w=>!process.env.LUMA_HEADER_WIDTHS||process.env.LUMA_HEADER_WIDTHS.split(',').map(Number).includes(w))){
  const c=await browser.newContext({viewport:{width,height:Number(process.env.LUMA_HEADER_HEIGHT)||(width<=390?844:900)}}),p=await c.newPage();await c.route('**/*',r=>['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort());
  const metrics=[];await p.goto(origin+'/v2/masters');await expect(p.locator('.public-header-inner')).toBeVisible({timeout:25000});
  for(const route of ['masters','inspiration','map','masters']){
   if(width>760)await p.locator('.public-header-inner>nav a[href="/v2/'+route+'"]').click();else await p.goto(origin+'/v2/'+route);
   await expect(p.locator('.public-header-inner')).toBeVisible({timeout:25000});await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);
   metrics.push(await p.evaluate(route=>{const box=e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width,right:r.right}};return{route,viewport:innerWidth,client:document.documentElement.clientWidth,gutter:getComputedStyle(document.documentElement).scrollbarGutter,brand:box(document.querySelector('.public-header-inner .cabinet-brand')),nav:[...document.querySelectorAll('.public-header-inner>nav>a')].map(box),actions:box(document.querySelector('.public-header-actions')),overflow:document.documentElement.scrollWidth>innerWidth}},route));
  }
  const deltas=metrics.map(m=>({route:m.route,nav:m.nav.map((n,i)=>n.x-metrics[0].nav[i].x),brand:m.brand.x-metrics[0].brand.x,actions:m.actions.x-metrics[0].actions.x}));
  if(phase!=='before'){for(const m of metrics)expect(m.gutter).toBe('stable');for(const m of deltas){expect(Math.abs(m.brand)).toBeLessThan(.6);expect(Math.abs(m.actions)).toBeLessThan(.6);for(const d of m.nav)expect(Math.abs(d)).toBeLessThan(.6)}}
  expect(metrics.some(m=>m.overflow)).toBe(false);
  if(width<=760){const before=metrics.at(-1);await p.getByRole('button',{name:'Открыть меню'}).click();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toBeVisible();await p.goBack();await expect(p.getByRole('dialog',{name:'Навигация Luma Beauty'})).toHaveCount(0);expect(await p.locator('.public-header-inner .cabinet-brand').evaluate(e=>e.getBoundingClientRect().x)).toBeCloseTo(before.brand.x,1)}
  if(phase!=='before'){await p.goto(origin+'/v2/');await expect(p.locator('.home-menu-toggle')).toBeVisible({timeout:25000});expect(await p.evaluate(()=>getComputedStyle(document.documentElement).scrollbarGutter)).toBe('auto')}
  results.push({width,metrics,deltas});console.log(JSON.stringify({width,scrollbarWidths:metrics.map(m=>m.viewport-m.client),deltas}));await c.close();
 }
 fs.writeFileSync(out,JSON.stringify({at:new Date().toISOString(),origin,phase,results},null,2)+'\n');
}finally{await browser.close()}
