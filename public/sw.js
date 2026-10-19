const CACHE='luma-v2-shell-20261019-v2-stories-avatar-fix';
const SHELL=['/v2/','/v2/hero-v2.webp','/assets/ornament.webp','/favicon.svg','/icon-192.png','/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(SHELL);const html=await (await cache.match('/v2/')).text();const assets=[...html.matchAll(/(?:src|href)="(\/v2\/assets\/[^\"]+)"/g)].map(match=>match[1]);if(assets.length)await cache.addAll(assets)})());self.skipWaiting()});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const u=new URL(e.request.url);
 if(e.request.method!=='GET'||u.origin!==location.origin||u.pathname.startsWith('/api/')||u.pathname.startsWith('/auth/')||u.pathname.startsWith('/uploads/'))return;
 if(e.request.mode==='navigate'&&u.pathname.startsWith('/v2/')){e.respondWith(fetch(e.request).catch(()=>caches.match('/v2/')));return}
 if(u.pathname.startsWith('/v2/assets/')){e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(response=>{if(response.ok){const copy=response.clone();void caches.open(CACHE).then(cache=>cache.put(e.request,copy))}return response})));return}
 if(SHELL.includes(u.pathname))e.respondWith(fetch(e.request).then(r=>{if(r.ok){const c=r.clone();caches.open(CACHE).then(x=>x.put(e.request,c))}return r}).catch(()=>caches.match(e.request)));
});
self.addEventListener('push',e=>{let d={title:'РђС‚РµР»СЊРµ',body:'РЈ РІР°СЃ РЅРѕРІРѕРµ СѓРІРµРґРѕРјР»РµРЅРёРµ',url:'/v2/calendar'};try{Object.assign(d,e.data.json())}catch{}e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'/icon-192.png',badge:'/icon-192.png',tag:d.tag||'atelie',data:{url:d.url}}))});
self.addEventListener('notificationclick',e=>{e.notification.close();let u=new URL(e.notification.data?.url||'/',location.origin);if(u.origin!==location.origin)u=new URL('/',location.origin);e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async list=>{for(const c of list){await c.navigate(u.href);return c.focus()}return clients.openWindow(u.href)}))});
