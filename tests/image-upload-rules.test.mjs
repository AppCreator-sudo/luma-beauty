import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {spawn} from 'node:child_process';
import {createImageUpload} from '../lib/image-upload.mjs';

async function fixture(t){
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'atelie-image-rules-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const media=createImageUpload({dataDir:directory,fail:message=>{throw Object.assign(new Error(message),{status:400})}});
  return {directory,media,files:async()=>{try{return (await fs.readdir(path.join(directory,'uploads'))).sort()}catch(error){if(error.code==='ENOENT')return [];throw error}}};
}
async function photo(width,height,format='jpeg',orientation){
  let image=sharp({create:{width,height,channels:3,background:'#b68370'}});
  if(orientation)image=image.withMetadata({orientation});
  return {buffer:await image[format]().toBuffer(),mimetype:format==='jpeg'?'image/jpeg':'image/'+format};
}

test('avatar and logo accept supported images at the minimum without changing portrait proportions',async t=>{
  const {directory,media}=await fixture(t);
  for(const [kind,format,width,height] of [['portrait','jpeg',256,256],['logo','png',256,256],['portrait','webp',360,640]]){
    const file=await photo(width,height,format),url=await media.save(file,kind);
    const metadata=await sharp(await fs.readFile(path.join(directory,url))).metadata();
    assert.equal(metadata.format,'webp');assert.equal(metadata.width,width);assert.equal(metadata.height,height);
  }
});

test('invalid replacements preserve the previous image and leave no temporary or generated artifacts',async t=>{
  const {directory,media,files}=await fixture(t),previous=await media.save(await photo(256,256),'portrait');
  const before=await files(),original=await fs.readFile(path.join(directory,previous));
  for(const [kind,file,pattern] of [
    ['portrait',await photo(255,640),/256 × 256/],
    ['logo',await photo(640,255,'png'),/256 × 256/],
    ['cover',await photo(799,450),/800 × 450/],
    ['cover',await photo(900,1600),/горизонтальное/],
    ['cover',await photo(800,800),/горизонтальное/],
    ['portrait',await photo(10001,256,'png'),/10 000/],
    ['portrait',await photo(7600,5300,'png'),/40 мегапикселей/],
    ['portrait',{buffer:Buffer.from('broken image'),mimetype:'image/jpeg'},/JPG, PNG или WebP/],
    ['portrait',{...await photo(256,256,'png'),mimetype:'image/jpeg'},/JPG, PNG или WebP/],
    ['portrait',{buffer:Buffer.alloc(8*1024*1024+1),mimetype:'image/jpeg'},/8 МБ/],
  ]){
    await assert.rejects(media.save(file,kind),error=>error.status===400&&pattern.test(error.message));
    assert.deepEqual(await files(),before);
    assert.deepEqual(await fs.readFile(path.join(directory,previous)),original);
  }
});

test('cover validates dimensions after EXIF orientation and stores the correctly oriented image',async t=>{
  const {directory,media,files}=await fixture(t);
  const rotated=await photo(450,800,'jpeg',6),saved=await media.save(rotated,'cover');
  const metadata=await sharp(await fs.readFile(path.join(directory,saved))).metadata();
  assert.equal(metadata.width,800);assert.equal(metadata.height,450);assert.equal(metadata.orientation,undefined);
  const before=await files();
  await assert.rejects(media.save(await photo(800,450,'jpeg',6),'cover'),/800 × 450/);
  assert.deepEqual(await files(),before);
});


test('all avatar and cover endpoints enforce limits without replacing stored photos',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'atelie-image-api-')),origin='http://localhost:3229';
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'3229',APP_ORIGIN:origin,DATA_DIR:directory,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
  let logs='';child.stdout.on('data',chunk=>logs+=chunk);child.stderr.on('data',chunk=>logs+=chunk);
  t.after(async()=>{child.kill();if(child.exitCode===null)await new Promise(resolve=>child.once('exit',resolve));await fs.rm(directory,{recursive:true,force:true})});
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    try{if((await fetch(origin+'/api/health')).ok){ready=true;break}}catch{}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(ready,logs);
  let nextIP=70;
  const client=()=>({cookie:'',ip:'198.51.100.'+nextIP++,async call(url,body,method='POST'){
    const form=body instanceof FormData,response=await fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:this.cookie,'X-Forwarded-For':this.ip,...(form?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:form?body:JSON.stringify(body)});
    if(response.headers.get('set-cookie'))this.cookie=response.headers.get('set-cookie').split(';')[0];
    return {status:response.status,data:await response.json()};
  }});
  const master=client(),owner=client();
  for(const [user,login,account_type] of [[master,'image-rules-master','master'],[owner,'image-rules-owner','salon']])assert.equal((await user.call('/auth/register',{login,password:'ImageRulesTestPassword123',account_type})).status,201);
  assert.equal((await master.call('/profile',{name:'Мастер',slug:'image-rules-master',city:'Москва',categories:['Маникюр'],published:false},'PUT')).status,200);
  const salon=await owner.call('/salons',{name:'Салон',city:'Москва'});assert.equal(salon.status,201);
  const staff=await owner.call('/salons/'+salon.data.id+'/staff',{name:'Анна',categories:['Маникюр'],draft:true});assert.equal(staff.status,201);
  const form=file=>{const body=new FormData();body.set('image',new Blob([file.buffer],{type:file.mimetype}),'photo.jpg');return body};
  const avatar=await photo(360,640),cover=await photo(800,450),tiny=await photo(200,300),saved=[];
  for(const [user,route,file] of [
    [master,'/avatar',avatar],
    [master,'/profile/cover',cover],
    [owner,'/salons/'+salon.data.id+'/logo',avatar],
    [owner,'/salons/'+salon.data.id+'/cover',cover],
    [owner,'/performers/'+staff.data.id+'/avatar',avatar],
  ]){
    const response=await user.call(route,form(file));assert.equal(response.status,200,JSON.stringify(response.data));
    saved.push({user,route,image:response.data.image,bytes:Buffer.from(await(await fetch(origin+response.data.image)).arrayBuffer())});
  }
  const before=(await fs.readdir(path.join(directory,'uploads'))).sort();
  for(const {user,route,image,bytes} of saved){
    const rejected=await user.call(route,form(tiny));assert.equal(rejected.status,400,route);assert.match(rejected.data.error,/256 × 256|800 × 450/);
    const stored=await fetch(origin+image);assert.equal(stored.status,200);assert.deepEqual(Buffer.from(await stored.arrayBuffer()),bytes);
  }
  const rejectedLarge=await master.call('/avatar',form({buffer:Buffer.alloc(8*1024*1024+1),mimetype:'image/jpeg'}));
  assert.equal(rejectedLarge.status,413);assert.match(rejectedLarge.data.error,/8 МБ/);
  assert.deepEqual((await fs.readdir(path.join(directory,'uploads'))).sort(),before);
  const personal=(await master.call('/studio',undefined,'GET')).data.profile,salonState=(await owner.call('/salons/'+salon.data.id,undefined,'GET')).data;
  assert.equal(personal.avatar,saved[0].image);assert.equal(personal.cover,saved[1].image);
  assert.equal(salonState.workspace.logo,saved[2].image);assert.equal(salonState.workspace.cover,saved[3].image);
  assert.equal(salonState.staff[0].profile.avatar,saved[4].image);
});
