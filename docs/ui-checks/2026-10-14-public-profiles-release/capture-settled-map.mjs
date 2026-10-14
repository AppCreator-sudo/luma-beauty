import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const dir='docs/ui-checks/2026-10-14-public-profiles-release',meta=JSON.parse(fs.readFileSync(dir+'/package-manifest.json','utf8')),origin=meta.baseline.origin;
const b=await chromium.launch({channel:'chrome',headless:true,args:['--host-resolver-rules=MAP '+new URL(origin).hostname+' 13.143.66.1']});const checks=[];
try{for(const width of [1440,390,320]){const p=await b.newPage({viewport:{width,height:width===1440?900:844},serviceWorkers:'block'});await p.route('**/*',r=>['GET','HEAD','OPTIONS'].includes(r.request().method())?r.continue():r.abort());await p.goto(origin+'/v2/map');await expect(p.locator('.map-result-count')).toContainText('В этой области:',{timeout:30000});await expect(p.locator('.map-skeletons')).toHaveCount(0,{timeout:30000});
 await expect.poll(()=>p.locator('.leaflet-tile-loaded').count(),{timeout:25000}).toBeGreaterThan(0);await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:dir+'/map-'+width+'.png'});checks.push({width,placesLoaded:true,loadedTiles:await p.locator('.leaflet-tile-loaded').count()});await p.close();}
 fs.writeFileSync(dir+'/map-settled.json',JSON.stringify({at:new Date().toISOString(),checks,result:'PASS'},null,2)+'\n');console.log('PASS settled OSM/data snapshots:',checks.length);
}finally{await b.close()}
