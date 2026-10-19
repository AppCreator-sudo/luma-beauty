import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

async function availablePort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  const {port} = listener.address();
  await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return port;
}

test('master publication uses the saved working pattern and preserves profile and existing visits', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luma-master-publication-'));
  const port = await availablePort();
  const origin = `http://127.0.0.1:${port}`;
  const fixture = path.join(dir, 'server.mjs');
  fs.writeFileSync(fixture, `import {installAddressProvider} from ${JSON.stringify(pathToFileURL(path.resolve('tests/helpers/address-provider.mjs')).href)};installAddressProvider();await import(${JSON.stringify(pathToFileURL(path.resolve('server.mjs')).href)});`);
  const child = spawn(process.execPath, [fixture], {
    env: {...process.env, PORT: String(port), DATA_DIR: dir, APP_ORIGIN: origin, NODE_ENV: 'test', DADATA_API_KEY: 'fake-master-publication-key', DADATA_SECRET_KEY: ''},
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '', db;
  child.stdout.on('data', value => logs += value);
  child.stderr.on('data', value => logs += value);
  t.after(async () => {
    db?.close();
    const exited = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    child.kill();
    await exited;
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dir).startsWith('luma-master-publication-'));
    fs.rmSync(dir, {recursive: true, force: true});
  });
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  db = new DatabaseSync(path.join(dir, 'atelie.sqlite'), {readOnly: true});
  function client() {
    return {cookie: '', async call(url, body, method = body === undefined ? 'GET' : 'POST', source = origin) {
      const response = await fetch(origin + '/api' + url, {
        method,
        headers: {Origin: source, Cookie: this.cookie, 'Content-Type': 'application/json'},
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
      return {status: response.status, data: await response.json()};
    }};
  }
  const master = client(), buyer = client(), salon = client(), outsider = client(), guest = client();
  for (const [account, login, account_type] of [[master, 'publication-master', 'master'], [buyer, 'publication-client', 'client'], [salon, 'publication-salon', 'salon'], [outsider, 'publication-outsider', 'master']]) {
    assert.equal((await account.call('/auth/register', {login, password: 'PublicationTest123', account_type})).status, 201);
  }
  const open = account => account.call('/profile/publication', {published: true}, 'PATCH');
  const hide = () => master.call('/profile/publication', {published: false}, 'PATCH');
  assert.equal((await open(master)).status, 400, 'Publication cannot implicitly create a profile');
  assert.equal((await master.call('/profile/address', {city: 'Новосибирск', address: 'Громова 21'}, 'PUT')).status, 200);
  const created = await master.call('/profile', {
    name: 'Новый мастер', slug: 'publication-pattern', categories: ['Маникюр'], bio: 'Сохранить описание',
    experience_months: 37, teaches: true, looking_models: true, address_mode: 'preserve',
  }, 'PUT');
  assert.equal(created.status, 200);
  assert.equal(created.data.published, 0);
  const id = created.data.user_id;
  const profile = () => ({...db.prepare('SELECT * FROM profiles WHERE user_id=?').get(id)});
  const profileBefore = profile();
  function assertProfile(visible) { assert.deepEqual(profile(), {...profileBefore, published: Number(visible)}); }
  assert.equal((await open(master)).status, 400, 'No service means opening is rejected');
  assertProfile(false);
  const service = await master.call('/services', {name: 'Маникюр', category: 'Маникюр', price: 1800, duration: 60});
  assert.equal(service.status, 201);
  assert.equal((await master.call('/studio')).data.schedule_configured, false);
  assert.equal((await open(master)).status, 400, 'Default hours do not replace an explicitly saved schedule');
  assertProfile(false);
  const weekly = {opening: 600, closing: 1080, utc_offset: 420, weekdays: [1, 2, 3, 4, 5], mode: 'weekly', exceptions: []};
  assert.equal((await outsider.call('/profile/address', {city: 'Новосибирск', address: 'Громова 21'}, 'PUT')).status, 200);
  assert.equal((await outsider.call('/profile', {name: 'Другой мастер', slug: 'publication-outsider', categories: ['Маникюр'], address_mode: 'preserve'}, 'PUT')).status, 200);
  assert.equal((await outsider.call('/schedule', weekly, 'PUT')).status, 200);
  assert.equal((await open(outsider)).status, 400, 'An explicitly saved working schedule still requires a service');
  assert.equal((await outsider.call('/studio')).data.profile.published, 0);
  assert.equal((await master.call('/schedule', {...weekly, weekdays: []}, 'PUT')).status, 200);
  assert.equal((await open(master)).status, 400, 'A saved schedule without working days stays hidden');
  assertProfile(false);
  assert.equal((await master.call('/schedule', weekly, 'PUT')).status, 200);
  const studio = (await master.call('/studio')).data;
  const slot = studio.availability.find(value => value.start > Date.now() + 86400000);
  assert.ok(slot);
  const visit = await master.call('/appointments', {master_id: id, service_id: service.data.id, client_name: 'Существующий визит', start: slot.start});
  assert.equal(visit.status, 201);
  const visitsBefore = db.prepare('SELECT * FROM appointments WHERE master_id=? ORDER BY id').all(id).map(row => ({...row}));
  assert.equal(visitsBefore.length, 1);
  const tomorrow = new Date(Date.now() + 86400000 + 420 * 60000).toISOString().slice(0, 10);
  const cases = [
    ['weekly days', weekly],
    ['cycle 2/2', {...weekly, weekdays: [], mode: 'cycle', cycle_start: tomorrow, work_days: 2, rest_days: 2}],
    ['weekly days with a date override', {...weekly, exceptions: [{date: tomorrow, working: false}]}],
    ['only an explicitly working date', {...weekly, weekdays: [], exceptions: [{date: tomorrow, working: true, opening: 660, closing: 900}]}],
  ];
  for (const [label, schedule] of cases) await t.test(label, async () => {
    assert.equal((await hide()).status, 200);
    assert.equal((await master.call('/schedule', schedule, 'PUT')).status, 200);
    const reloaded = (await master.call('/studio')).data;
    assert.equal(reloaded.schedule_configured, true);
    assert.equal(reloaded.schedule.mode, schedule.mode);
    assert.deepEqual(reloaded.schedule.exceptions, schedule.exceptions);
    assert.ok(reloaded.availability.length > 0, 'The saved pattern offers real working intervals');
    assert.equal((await guest.call('/profiles/publication-pattern')).status, 404);
    const published = await open(master);
    assert.equal(published.status, 200, `${label}: ${JSON.stringify(published.data)}`);
    assertProfile(true);
    const publicPage = await guest.call('/profiles/publication-pattern');
    assert.equal(publicPage.status, 200);
    assert.equal(publicPage.data.user_id, id);
    assert.ok(publicPage.data.availability.length > 0);
    assert.deepEqual(db.prepare('SELECT * FROM appointments WHERE master_id=? ORDER BY id').all(id).map(row => ({...row})), visitsBefore);
    assert.equal((await hide()).status, 200);
    assert.equal((await master.call('/studio')).data.profile.published, 0);
    assert.equal((await guest.call('/profiles/publication-pattern')).status, 404);
    assertProfile(false);
  });
  await t.test('publication remains scoped to the authenticated master', async () => {
    assert.equal((await hide()).status, 200);
    assert.equal((await open(guest)).status, 401);
    assert.equal((await open(buyer)).status, 403);
    assert.equal((await open(salon)).status, 403);
    assert.equal((await outsider.call('/profile/publication', {published: true, user_id: id}, 'PATCH')).status, 400);
    assert.equal((await master.call('/profile/publication', {published: 'true'}, 'PATCH')).status, 400);
    assert.equal((await master.call('/profile/publication', {published: true}, 'PATCH', 'https://foreign.invalid')).status, 403);
    assertProfile(false);
    assert.deepEqual(db.prepare('SELECT * FROM appointments WHERE master_id=? ORDER BY id').all(id).map(row => ({...row})), visitsBefore);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  });
});
