import {chromium,expect} from '@playwright/test';
import fs from 'node:fs';
const fixture=JSON.parse(fs.readFileSync('.cache/map-provider-comparison-20261014/manifest.json','utf8'));
const dir='docs/ui-concepts/2026-10-14-luma/map-provider-review-01';fs.mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true}),reports=[];
try{
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:width===1440?900:844},bypassCSP:true});
  const page=await context.newPage();await page.goto(fixture.origin+'/v2/map?q='+encodeURIComponent('Москва'));
  await expect(page.locator('.map-entry').first()).toBeAttached();
  await page.getByRole('button',{name:'Список',exact:true}).click();
  for(let n=0;n<3&&!await page.getByRole('button',{name:'Открыть карточку: '+fixture.free.name,exact:true}).count();n++)await page.getByRole('button',{name:'Показать ещё',exact:true}).click();
  await page.getByRole('button',{name:'Открыть карточку: '+fixture.free.name,exact:true}).click();await expect(page.locator('.map-selected-card .map-rating')).toContainText('4.5');
  await page.locator('.map-sidebar').evaluate(e=>e.scrollTo({top:0,behavior:'instant'}));
  for(let n=0;n<3;n++){const previous=await page.evaluate(()=>window.history.state.usr.mapView.view.zoom);await page.locator('.leaflet-control-zoom-in').click();await expect.poll(()=>page.evaluate(()=>window.history.state.usr.mapView.view.zoom)).toBeGreaterThan(previous);await page.waitForTimeout(500)}
  await expect(page.locator('.map-result-count')).not.toHaveText('Ищем на карте…');await page.waitForTimeout(900);await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:dir+'/current-'+width+'.png'});
  await page.addStyleTag({url:'https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.css'});
  const report=await page.evaluate(async()=>{
   const {Map:VectorMap}=await import('https://unpkg.com/maplibre-gl@6.14.0/dist/maplibre-gl.mjs');
   const response=await fetch('https://tiles.openfreemap.org/styles/positron');if(!response.ok)throw Error('OpenFreeMap style '+response.status);const style=await response.json();
   const hidden=[];
   for(const layer of style.layers){
    const id=layer.id.toLowerCase();layer.paint||={};
    if(layer.type==='background')layer.paint['background-color']='#faf7f1';
    if(layer.type==='fill'){
     if(/water/.test(id))layer.paint['fill-color']='#c9dcd8';
     else if(/park|wood|forest|grass|green/.test(id))layer.paint['fill-color']='#e0e7d9';
     else if(/building/.test(id)){layer.paint['fill-color']='#ece6da';layer.paint['fill-outline-color']='#dfd6c7'}
     else if(/landcover|landuse|residential/.test(id))layer.paint['fill-color']='#f1ede4';
    }
    if(layer.type==='line'&&/road|highway|tunnel|bridge/.test(id))layer.paint['line-color']=/casing/.test(id)?'#dfd6c7':'#fffdf7';
    if(layer.type==='symbol'){
     if(id.startsWith('highway-name')){layer.minzoom=Math.min(layer.minzoom||0,12);layer.layout['text-size']=12;}
     if(/poi|airport|transit|housenumber/.test(id)){layer.layout={...layer.layout,visibility:'none'};hidden.push(layer.id)}
     else if(layer.layout?.['text-field']){layer.paint['text-color']='#69796e';layer.paint['text-halo-color']='#faf7f1';layer.paint['text-halo-width']=1.4;if(JSON.stringify(layer.layout['text-field']).includes('name'))layer.layout['text-field']=['coalesce',['get','name:ru'],['get','name_ru'],['get','name:nonlatin'],['get','name'],['get','name:latin']];}
    }
   }
   const host=document.querySelector('.map-canvas'),div=document.createElement('div');div.id='maplibre-comparison';Object.assign(div.style,{position:'absolute',inset:'0',zIndex:'0',pointerEvents:'none'});host.prepend(div);
   const saved=window.history.state.usr.mapView.view;const box=saved.bbox;
   const map=new VectorMap({container:div,style,center:[(box[0]+box[2])/2,(box[1]+box[3])/2],zoom:saved.zoom-1,interactive:false,attributionControl:false,canvasContextAttributes:{preserveDrawingBuffer:true}});
   map.fitBounds([[box[0],box[1]],[box[2],box[3]]],{padding:0,animate:false});
   const errors=[];map.on('error',e=>errors.push(String(e.error?.message||e.error)));
   await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('MapLibre comparison load timed out: '+errors.join(' | '))),45000);map.once('idle',()=>{clearTimeout(timer);resolve()})});
   document.querySelector('.leaflet-tile-pane').style.visibility='hidden';
   document.querySelector('.leaflet-control-attribution').innerHTML='<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · Data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
   return {engine:'MapLibre GL JS 6.14.0',styleSource:'https://tiles.openfreemap.org/styles/positron',bbox:box,hiddenLayers:hidden,style,errors,loaded:map.loaded()};
  });
  await page.screenshot({path:dir+'/openfreemap-'+width+'.png'});fs.writeFileSync(dir+'/luma-positron.style.json',JSON.stringify(report.style,null,2)+'\n');delete report.style;reports.push({width,...report});console.log('PASS real OpenFreeMap comparison '+width+'; loaded='+report.loaded+'; errors='+report.errors.length);await context.close();
 }
 fs.writeFileSync(dir+'/comparison-check.json',JSON.stringify({at:new Date().toISOString(),scope:'Preview-only background overlay on synthetic local UI; not production integration',reports},null,2)+'\n');
}finally{await browser.close()}
