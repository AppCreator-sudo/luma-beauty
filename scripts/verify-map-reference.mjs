// Fresh synthetic database + real application + Chrome; never production.
import {spawn} from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
const root=path.resolve('.cache/map-reference-'+Date.now());
const listener=net.createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));
const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
const env={...process.env,LUMA_MAP_TEST_ROOT:root,LUMA_MAP_TEST_PORT:String(port)};
const server=spawn(process.execPath,['tests/fixtures/map-reference-server.mjs'],{env,stdio:['ignore','pipe','pipe','ipc']});
let logs='',done=false;
const exited=new Promise(resolve=>server.once('exit',code=>{done=true;resolve(code)}));
try{
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Local map fixture did not become ready: '+logs.slice(-1500))),20000);
  const collect=value=>{logs+=value;if(logs.includes('MAP CARD FIXTURE READY')){clearTimeout(timer);resolve()}};
  server.stdout.on('data',collect);server.stderr.on('data',collect);server.once('error',reject);server.once('exit',code=>{clearTimeout(timer);reject(Error('Fixture exited '+code+': '+logs.slice(-1500))) });
 });
 const code=await new Promise((resolve,reject)=>{const test=spawn(process.execPath,['tests/map-reference.browser.mjs'],{env,stdio:'inherit'});test.once('error',reject);test.once('exit',resolve)});
 if(code!==0)throw Error('Map browser acceptance failed: '+code);
 console.log('MAP REFERENCE PASS; report and screenshots: '+root);
}finally{if(!done&&server.connected)server.send('stop');await exited}
