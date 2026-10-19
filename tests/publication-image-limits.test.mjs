import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import sharp from 'sharp';
import {DatabaseSync} from 'node:sqlite';

test('work uploads enforce both image-side boundaries and preserve saved work on atomic rejection',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'luma-publication-limits-'));
  const available=net.createServer();
  await new Promise((resolve,reject)=>{available.once('error',reject);available.listen(0,'127.0.0.1',resolve)});
  const port=available.address().port;await new Promise(resolve=>available.close(resolve));
  const origin='http://127.0.0.1:'+port,environment={PORT:String(port),DATA_DIR:directory,APP_ORIGIN:origin,NODE_ENV:'test'};
  for(const name of ['PATH','Path','SystemRoot','TEMP','TMP'])if(process.env[name])environment[name]=process.env[name];
  const child=spawn(process.execPath,['server.mjs'],{env:environment,stdio:['ignore','pipe','pipe']});
  let logs='',cookie='',db;
  child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  t.after(async()=>{
    db?.close();
    child.kill();if(child.exitCode===null&&child.signalCode===null)await new Promise(resolve=>child.once('exit',resolve));
    const resolved=await fs.realpath(directory),temporary=await fs.realpath(os.tmpdir());
    assert.ok(resolved.startsWith(temporary+path.sep),'Only the synthetic temporary directory may be removed');
    await fs.rm(directory,{recursive:true,force:true});
  });
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,logs);
  async function call(route,body,method='POST'){
    const multipart=body instanceof FormData;
    const response=await fetch(origin+'/api'+route,{method,headers:{Origin:origin,Cookie:cookie,'X-Forwarded-For':'198.51.100.167',...(multipart?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:multipart?body:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  }
  assert.equal((await call('/auth/register',{login:'publication-limits',password:'SyntheticPublicationLimits123',account_type:'master'})).status,201);
  assert.equal((await call('/profile',{name:'Synthetic publication limits',slug:'publication-limits',city:'Москва',categories:['Маникюр'],published:false},'PUT')).status,200);
  const service=await call('/services',{name:'Synthetic service',price:1200,duration:60});assert.equal(service.status,201);
  db=new DatabaseSync(path.join(directory,'atelie.sqlite'),{readOnly:true});
  const image=async(width,height)=>sharp({create:{width,height,channels:3,background:'#99754d'}}).png().toBuffer();
  function form(buffers){
    const body=new FormData();body.set('caption','Synthetic image limits');body.set('service_id',service.data.id);
    buffers.forEach((buffer,index)=>body.append('image',new Blob([buffer],{type:'image/png'}),'synthetic-'+index+'.png'));
    return body;
  }
  async function state(){
    const names=(await fs.readdir(path.join(directory,'uploads'))).sort();
    return {works:db.prepare('SELECT * FROM works ORDER BY id').all(),images:db.prepare('SELECT * FROM work_images ORDER BY id').all(),files:await Promise.all(names.map(async name=>({name,bytes:await fs.readFile(path.join(directory,'uploads',name))})))};
  }
  for(const [width,height] of [[10000,256],[256,10000]])await t.test('accepts the '+width+'x'+height+' boundary',async()=>{
    const before=await state(),response=await call('/works',form([await image(width,height)]));
    assert.equal(response.status,201,JSON.stringify(response.data));
    const after=await state();assert.equal(after.works.length,before.works.length+1);assert.equal(after.images.length,before.images.length+1);assert.equal(after.files.length,before.files.length+1);
    assert.deepEqual(after.files.filter(file=>before.files.some(old=>old.name===file.name)),before.files);
  });
  for(const [width,height] of [[10001,256],[256,10001]])await t.test('rejects '+width+'x'+height+' without changing saved rows or files',async()=>{
    const before=await state(),response=await call('/works',form([await image(width,height)]));
    assert.equal(response.status,400);assert.match(response.data.error,/10\s000 пикселей/);
    assert.deepEqual(await state(),before);
  });
  await t.test('removes earlier converted files when a later image exceeds the side limit',async()=>{
    const before=await state(),response=await call('/works',form([await image(360,640),await image(10001,256)]));
    assert.equal(response.status,400);assert.match(response.data.error,/10\s000 пикселей/);
    assert.deepEqual(await state(),before);
  });
  await t.test('rejects an oversize replacement without changing saved metadata, images or bytes',async()=>{
    const before=await state(),work=before.works[0];
    const retained=before.images.filter(photo=>photo.work_id===work.id).map(photo=>photo.id);
    assert.ok(retained.length,'The replacement must target an existing saved image');
    const body=form([await image(360,640),await image(10001,256)]);
    body.set('existing_images',JSON.stringify(retained));
    body.set('caption','This replacement must not be saved');
    const response=await call('/works/'+work.id,body,'PUT');
    assert.equal(response.status,400);assert.match(response.data.error,/10\s000 пикселей/);
    assert.deepEqual(await state(),before);
  });
  await t.test('invalid metadata returns a plain error and cleans the batch without replacing saved images',async()=>{
    const before=await state(),response=await call('/works',form([await image(360,640),Buffer.from('synthetic invalid photo')]));
    assert.equal(response.status,400);assert.equal(response.data.error,'Не удалось прочитать фото. Используйте JPEG, PNG или WebP.');
    assert.deepEqual(await state(),before);
  });
  assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});
