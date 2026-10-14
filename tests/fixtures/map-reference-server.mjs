// Isolated synthetic acceptance fixture. Never reads or writes ./data or production.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';

const root = path.resolve(process.env.LUMA_MAP_TEST_ROOT || '.cache/u09-reference-test');
const data = path.join(root, 'data');
const port = String(process.env.LUMA_MAP_TEST_PORT || '3249');
if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535) throw Error('Invalid local test port');
const origin = 'http://localhost:' + port;
assert.ok(root.startsWith(path.resolve('.cache') + path.sep));
if (fs.existsSync(data)) throw Error('Refusing to reuse an existing map-card fixture database');
try { await fetch(origin + '/api/health'); throw Error('Port 3249 is already in use'); }
catch (error) { if (error.message === 'Port 3249 is already in use') throw error; }
fs.mkdirSync(data, { recursive: true });
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: port, DATA_DIR: data, APP_ORIGIN: origin, NODE_ENV: 'test',
    DADATA_API_KEY: '', DADATA_SECRET_KEY: '', PROMOTIONS_ENABLED: '0' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let logs = '', stopping = false;
child.stdout.on('data', value => logs += value);
child.stderr.on('data', value => logs += value);
function stop() { if (stopping) return; stopping = true; child.kill(); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
process.on('message', value => { if (value === 'stop') stop(); });
child.on('exit', code => { if (code && !stopping) console.error(logs); process.exit(stopping ? 0 : code || 0); });
let ready = false;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 100));
}
if (!ready) { stop(); throw Error(logs); }

const now = Date.now();
const db = new DatabaseSync(path.join(data, 'atelie.sqlite'));
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
const user = db.prepare("INSERT INTO users(id,login,password,recovery,created,account_type) VALUES(?,?,'disabled','disabled',?,'master')");
const workspace = db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,name,city,created) VALUES(?,'solo',?,?,?,?)");
const performer = db.prepare('INSERT INTO performers(id,workspace_id,user_id,name,created,bookable) VALUES(?,?,?,?,?,1)');
const profile = db.prepare('INSERT INTO profiles(user_id,slug,name,city,category,bio,avatar,address,latitude,longitude,published,is_demo,teaches) VALUES(?,?,?,?,?,?,?,?,?,?,?,0,?)');
const category = db.prepare('INSERT INTO profile_categories VALUES(?,?)');
const service = db.prepare('INSERT INTO services(id,user_id,name,price,duration) VALUES(?,?,?,?,?)');
const schedule = db.prepare('INSERT INTO master_schedules VALUES(?,0,1440,180,?)');
const work = db.prepare('INSERT INTO works(id,user_id,image,caption,created,service_id) VALUES(?,?,?,?,?,?)');
const appointment = db.prepare("INSERT INTO appointments(id,master_id,client_name,service,start,end,price,status) VALUES(?,?,'Синтетическая занятость','Перерыв',?,?,0,'confirmed')");
const promotion = db.prepare('INSERT INTO promotions(id,master_id,salon_id,category,catalog,map,starts,ends,priority,advertiser,erid,created) VALUES(?,?,?,\'\',0,1,?,?,?,?,?,?)');
fs.copyFileSync(path.resolve('public/v2/hero-v2.webp'), path.join(data, 'uploads', 'card-cover.webp'));
const image = '/uploads/card-cover.webp';
const records = [];
function master(slug, name, lat, lon, selected = 'Макияж', options = {}) {
  const id = randomUUID(), serviceId = randomUUID(), city = options.city || 'Москва';
  user.run(id, 'synthetic-' + slug, now);
  const wid = options.salon || 'solo:' + id;
  if (!options.salon) workspace.run(wid, id, name, city, now);
  performer.run(id, wid, options.salon ? null : id, name, now);
  const bio = options.bio || 'Синтетическая анкета для проверки карты. Длинное описание безопасно выводится обычным текстом.';
  profile.run(id, slug, name, city, selected, bio, image,
    options.address || 'улица Тестовая, дом 21, корпус 2', lat, lon, options.salon ? 0 : 1, Number(Boolean(options.teaches)));
  category.run(id, selected);
  service.run(serviceId, id, selected, 2200, options.duration || 30);
  schedule.run(id, JSON.stringify([0, 1, 2, 3, 4, 5, 6]));
  work.run(randomUUID(), id, image, 'Демонстрационное фото из локальных файлов проекта', now, serviceId);
  if (options.busy) appointment.run(randomUUID(), id, now - 5 * 60000, now + 2 * 3600000);
  if (options.premium) promotion.run(randomUUID(), id, null, now - 60000, now + 2 * 3600000, options.priority || 50, 'Тестовый рекламодатель', 'syntheticMapOnly', now);
  const record = { id, slug, name, kind: 'master', latitude: lat, longitude: lon, category: selected, serviceId, busy: Boolean(options.busy), premium: Boolean(options.premium) };
  if (!options.salon) records.push(record);
  return record;
}
try {
  const free = master('card-elite-free', 'Елена Миронова', 55.75, 37.61, 'Макияж', { premium: true, priority: 95, teaches: true });
  const busy = master('card-elite-busy', 'Мария Занята', 55.749, 37.616, 'Макияж', { premium: true, priority: 90, busy: true });
  const ordinary = master('card-regular-free', 'Ольга Лебедева', 55.753, 37.615);
  const ordinaryBusy = master('card-regular-busy', 'Наталья Смирнова', 55.747, 37.613, 'Макияж', { busy: true });
  const noTime = master('card-no-time', 'Мастер без ближайших окон', 55.755, 37.614, 'Волосы');
  appointment.run(randomUUID(), noTime.id, now - 60000, now + 8 * 86400000);
  const salonId = randomUUID(), ownerId = randomUUID();
  user.run(ownerId, 'synthetic-salon-owner', now);
  db.prepare("INSERT INTO workspaces(id,kind,owner_user_id,name,city,created,slug,bio,address,latitude,longitude,published,utc_offset) VALUES(?,'salon',?,'Студия Линия','Москва',?,'card-salon','Синтетическая команда из двух сотрудников','Очень длинное название улицы для проверки переноса, дом 24, корпус 3',55.752,37.618,1,180)").run(salonId, ownerId, now);
  const salonStaff = master('card-salon-free-staff', 'Алина Сотрудник', 55.752, 37.618, 'Маникюр', { salon: salonId });
  master('card-salon-busy-staff', 'Полина Сотрудник', 55.752, 37.618, 'Маникюр', { salon: salonId, busy: true });
  promotion.run(randomUUID(), null, salonId, now - 60000, now + 2 * 3600000, 85, 'Тестовый рекламодатель салона', 'syntheticSalonOnly', now);
  records.push({ id: salonId, slug: 'card-salon', name: 'Студия Линия', kind: 'salon', latitude: 55.752, longitude: 37.618, category: 'Маникюр', premium: true });
  const reviewClient=randomUUID();
  db.prepare("INSERT INTO users(id,login,password,recovery,created,account_type) VALUES(?,?,'disabled','disabled',?,'client')").run(reviewClient,'rating-client-'+reviewClient,now);
  function verifiedReview(person,rating,place=null){
    const id=randomUUID(),start=now-2*86400000;
    db.prepare('INSERT INTO appointments(id,master_id,client_id,client_name,service,start,end,price,status) VALUES(?,?,?,?,?,?,?,?,?)').run(id,person.id,reviewClient,'Тестовый клиент','Прошлый визит',start,start+1800000,2200,'done');
    db.prepare('INSERT INTO reviews(id,appointment_id,client_id,master_id,rating,text,created) VALUES(?,?,?,?,?,?,?)').run(randomUUID(),id,reviewClient,person.id,rating,'Приватный тестовый текст',now-86400000);
    if(place)db.prepare('INSERT INTO booking_venues(appointment_id,workspace_id,slug,name,city,address,utc_offset) VALUES(?,?,?,?,?,?,?)').run(id,place,'test-venue','Салон теста','Москва','Тестовый адрес',180);
  }
  verifiedReview(free,4);verifiedReview(free,5);
  verifiedReview(salonStaff,4,salonId);verifiedReview(salonStaff,5,salonId);
  verifiedReview(salonStaff,1); // A personal visit must not lower the salon rating.
  const hostile = master('card-hostile', '<img src=x onerror=window.__map_xss=1>', 55.754, 37.62, 'Брови', {
    city: 'Тест HTML', bio: '<svg onload=window.__map_xss=2> Никаких HTML-элементов в описании',
    address: '<script>window.__map_xss=3</script> улица Тестовая, дом 1',
  });
  for (let i = 0; i < 30; i++) master('card-page-' + i, 'Мастер списка ' + String(i).padStart(2, '0'), 55.741 + (i % 6) * .001, 37.601 + Math.floor(i / 6) * .001, 'Маникюр');
  for (let i = 0; i < 30; i++) master('card-cluster-' + i, 'Тату мастер ' + String(i).padStart(2, '0'), 55.76, 37.622, 'Татуировки', { premium: i === 0 });
  const remote = master('card-other-city', 'Мастер другого города', 55, 82.885, 'Маникюр', { city: 'Новосибирск' });
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.exec('COMMIT');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  db.close();
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify({ origin, created: now, total: records.length, free, busy, ordinary, ordinaryBusy, hostile, salon: records.find(row => row.kind === 'salon'), salonStaff, remote, records }, null, 2));
  console.log('MAP CARD FIXTURE READY ' + origin + ' | ' + records.length + ' synthetic public cards | separate .cache database | provider keys disabled');
  process.stdin.resume();
} catch (error) { try { db.exec('ROLLBACK'); db.close(); } catch {} stop(); throw error; }
