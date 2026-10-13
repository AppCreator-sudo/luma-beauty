import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,SignJWT,createLocalJWKSet} from 'jose';
import {authProviders} from '../lib/auth-providers.mjs';

test('Yandex and VK exchange tokens server-side, validate VK device/state/user and request only login permissions',async t=>{
  const names=['YANDEX_CLIENT_ID','YANDEX_CLIENT_SECRET','VK_CLIENT_ID','VK_SERVICE_TOKEN'];const original=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  process.env.YANDEX_CLIENT_ID='ya-client';process.env.YANDEX_CLIENT_SECRET='SERVER_ONLY_SECRET';process.env.VK_CLIENT_ID='vk-client';process.env.VK_SERVICE_TOKEN='PRIVATE_SERVICE_TOKEN';
  t.after(()=>{for(const n of names)if(original[n]===undefined)delete process.env[n];else process.env[n]=original[n]});
  let state='test-state',vkUser='123';const calls=[];
  const providers=authProviders({fetchProvider:async(url,init)=>{
    calls.push({url,init});assert.equal(init.redirect,'error');assert.ok(init.signal);
    let data;
    if(url==='https://oauth.yandex.ru/token'){
      assert.equal(init.body.get('client_secret'),'SERVER_ONLY_SECRET');assert.equal(init.body.get('code_verifier'),'private-verifier');assert.equal(init.body.get('redirect_uri'),'https://site.example/auth/yandex/callback');data={access_token:'PRIVATE_ACCESS'};
    }else if(url.startsWith('https://login.yandex.ru/')){assert.equal(init.headers.Authorization,'OAuth PRIVATE_ACCESS');data={id:'456'}}
    else if(url==='https://id.vk.ru/oauth2/auth'){
      assert.equal(init.body.get('device_id'),'device');assert.equal(init.body.get('state'),'test-state');assert.equal(init.body.get('code_verifier'),'private-verifier');assert.equal(init.body.get('client_id'),'vk-client');assert.equal(init.body.get('service_token'),'PRIVATE_SERVICE_TOKEN');assert.equal(init.body.get('client_secret'),null);data={access_token:'PRIVATE_VK_ACCESS',state,user_id:'123'};
    }else {assert.equal(url,'https://id.vk.ru/oauth2/user_info');assert.equal(init.body.get('access_token'),'PRIVATE_VK_ACCESS');data={user:{user_id:vkUser}}}
    return {ok:true,json:async()=>data};
  }});
  const base={code:'server-code',verifier:'private-verifier',redirect:'https://site.example/auth/yandex/callback',state:'test-state',query:{device_id:'device'}};
  assert.equal(await providers.yandex.subject(base),'456');assert.equal(await providers.vk.subject({...base,redirect:'https://site.example/auth/vk/callback'}),'123');
  const url=new URL(providers.vk.authorize({state:'random',code_challenge:'challenge',code_challenge_method:'S256',redirect_uri:'https://site.example/auth/vk/callback'}));
  assert.equal(url.origin,'https://id.vk.ru');assert.equal(url.searchParams.get('scope'),'vkid.personal_info');assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(!url.href.includes('SERVER_ONLY_SECRET'));assert.ok(!url.href.includes('PRIVATE_SERVICE_TOKEN'));
  const before=calls.length;await assert.rejects(providers.vk.subject({...base,query:{}}));assert.equal(calls.length,before);
  state='wrong-state';await assert.rejects(providers.vk.subject(base));state='test-state';vkUser='different-user';await assert.rejects(providers.vk.subject(base));
});

test('Telegram verifies signature, issuer, audience, expiry, age and echoed nonce with trusted keys; never accepts decoded-only JWT',async t=>{
  const names=['TELEGRAM_CLIENT_ID','TELEGRAM_CLIENT_SECRET'],original=Object.fromEntries(names.map(n=>[n,process.env[n]]));
  process.env.TELEGRAM_CLIENT_ID='tg-client';process.env.TELEGRAM_CLIENT_SECRET='SERVER_ONLY_SECRET';
  t.after(()=>{for(const n of names)if(original[n]===undefined)delete process.env[n];else process.env[n]=original[n]});
  const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='trusted';
  const keys=createLocalJWKSet({keys:[jwk]});const now=Math.floor(Date.now()/1000);
  async function sign(changes={},key=privateKey){return new SignJWT({sub:'tg-subject',iss:'https://oauth.telegram.org',aud:'tg-client',iat:now,exp:now+600,nonce:'server-nonce',...changes}).setProtectedHeader({alg:'RS256',kid:'trusted'}).sign(key)}
  let token=await sign();let calls=0;
  const providers=authProviders({telegramKeys:keys,fetchProvider:async(url,init)=>{
    calls++;assert.equal(url,'https://oauth.telegram.org/token');assert.equal(init.headers.Authorization,'Basic '+Buffer.from('tg-client:SERVER_ONLY_SECRET').toString('base64'));
    assert.equal(init.body.get('code_verifier'),'server-verifier');assert.equal(init.body.get('redirect_uri'),'https://site.example/auth/telegram/callback');
    return {ok:true,json:async()=>({id_token:token,access_token:'PRIVATE_ACCESS'})};
  }});
  const args={code:'server-code',verifier:'server-verifier',redirect:'https://site.example/auth/telegram/callback',nonce:'server-nonce'};
  assert.equal(await providers.telegram.subject(args),'tg-subject');
  assert.equal(new URL(providers.telegram.authorize({state:'random'})).searchParams.get('scope'),'openid');
  for(const change of [{iss:'https://evil.example'},{aud:'other-app'},{exp:now-60},{iat:now-900},{nonce:'other-nonce'},{sub:undefined}]){token=await sign(change);await assert.rejects(providers.telegram.subject(args))}
  const attacker=await generateKeyPair('RS256');token=await sign({},attacker.privateKey);await assert.rejects(providers.telegram.subject(args));
  token=Buffer.from('{"alg":"none"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:'attacker',iss:'https://oauth.telegram.org',aud:'tg-client',iat:now,exp:now+600})).toString('base64url')+'.';await assert.rejects(providers.telegram.subject(args));
  assert.ok(calls>1);
});
