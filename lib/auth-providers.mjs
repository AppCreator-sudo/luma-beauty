import {createRemoteJWKSet,jwtVerify} from 'jose';

// Provider credentials and tokens are used only in this server module.
export function authProviders({fetchProvider=fetch,telegramKeys}={}){
  const keys=telegramKeys||createRemoteJWKSet(new URL('https://oauth.telegram.org/.well-known/jwks.json'),{timeoutDuration:10000});
  async function request(url,params,headers={}){
    const response=await fetchProvider(url,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',...headers},body:new URLSearchParams(params),signal:AbortSignal.timeout(10000),redirect:'error'});
    const data=await response.json();
    if(!response.ok||data.error)throw new Error('Provider request failed');
    return data;
  }
  const text=v=>typeof v==='string'?v:'';
  return {
    yandex:{
      ready:()=>Boolean(process.env.YANDEX_CLIENT_ID&&process.env.YANDEX_CLIENT_SECRET),
      authorize:params=>new URL('https://oauth.yandex.ru/authorize?'+new URLSearchParams({...params,client_id:process.env.YANDEX_CLIENT_ID})).href,
      async subject({code,verifier,redirect}){
        const token=await request('https://oauth.yandex.ru/token',{grant_type:'authorization_code',code,client_id:process.env.YANDEX_CLIENT_ID,client_secret:process.env.YANDEX_CLIENT_SECRET,code_verifier:verifier,redirect_uri:redirect});
        if(!text(token.access_token))throw new Error('Missing token');
        const response=await fetchProvider('https://login.yandex.ru/info?format=json',{headers:{Authorization:'OAuth '+token.access_token},signal:AbortSignal.timeout(10000),redirect:'error'});
        const info=await response.json();
        if(!response.ok)throw new Error('Provider request failed');
        return info.id;
      }
    },
    vk:{
      ready:()=>Boolean(process.env.VK_CLIENT_ID&&process.env.VK_SERVICE_TOKEN),
      authorize:params=>new URL('https://id.vk.ru/authorize?'+new URLSearchParams({...params,client_id:process.env.VK_CLIENT_ID,scope:'vkid.personal_info'})).href,
      async subject({code,verifier,redirect,state,query}){
        const device=text(query.device_id);
        if(!device||device.length>512)throw new Error('Missing device');
        const token=await request('https://id.vk.ru/oauth2/auth',{grant_type:'authorization_code',code,client_id:process.env.VK_CLIENT_ID,service_token:process.env.VK_SERVICE_TOKEN,code_verifier:verifier,redirect_uri:redirect,state,device_id:device});
        if(token.state!==state||!text(token.access_token))throw new Error('Token state mismatch');
        const info=await request('https://id.vk.ru/oauth2/user_info',{client_id:process.env.VK_CLIENT_ID,access_token:token.access_token});
        if(!info.user?.user_id||String(info.user.user_id)!==String(token.user_id))throw new Error('User mismatch');
        return info.user.user_id;
      }
    },
    telegram:{
      ready:()=>Boolean(process.env.TELEGRAM_CLIENT_ID&&process.env.TELEGRAM_CLIENT_SECRET),
      authorize:params=>new URL('https://oauth.telegram.org/auth?'+new URLSearchParams({...params,client_id:process.env.TELEGRAM_CLIENT_ID,scope:'openid'})).href,
      async subject({code,verifier,redirect,nonce}){
        const client=process.env.TELEGRAM_CLIENT_ID;
        const token=await request('https://oauth.telegram.org/token',{grant_type:'authorization_code',code,client_id:client,redirect_uri:redirect,code_verifier:verifier},{Authorization:'Basic '+Buffer.from(client+':'+process.env.TELEGRAM_CLIENT_SECRET).toString('base64')});
        if(!text(token.id_token))throw new Error('Missing ID token');
        const {payload}=await jwtVerify(token.id_token,keys,{issuer:'https://oauth.telegram.org',audience:client,algorithms:['RS256'],requiredClaims:['sub','iat','exp'],maxTokenAge:'10m',clockTolerance:5});
        // Some providers do not echo nonce in the code flow. PKCE and one-use
        // browser-bound state still bind the exchange; reject a mismatched echo.
        if(payload.nonce!==undefined&&payload.nonce!==nonce)throw new Error('Nonce mismatch');
        return payload.sub;
      }
    }
  };
}
