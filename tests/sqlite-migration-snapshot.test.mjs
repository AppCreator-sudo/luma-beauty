import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { exportSnapshot, verifySnapshot } from '../scripts/sqlite-migration-snapshot.mjs';

const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const root = path.resolve('.cache');
fs.mkdirSync(root, { recursive: true });
function removeFixture(directory) {
  const resolved = path.resolve(directory);
  assert.ok(resolved.startsWith(root + path.sep) && /^sqlite(?:-v2)?-export-test-/.test(path.basename(resolved)), 'Cleanup must stay inside the fixture workspace');
  fs.rmSync(resolved, { recursive: true, force: true });
}
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(root, 'sqlite-export-test-'));
  t.after(() => removeFixture(directory));
  const source = path.join(directory, 'fixture.sqlite');
  const db = new DatabaseSync(source);
  db.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users(id TEXT PRIMARY KEY,password TEXT NOT NULL); INSERT INTO users VALUES('person','private-test-hash');
    CREATE TABLE performers(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id)); INSERT INTO performers VALUES('solo','person'),('salon','person');
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY REFERENCES performers(id),latitude REAL,longitude REAL,published INTEGER);
    INSERT INTO profiles VALUES('solo',54.9,82.9,1);
    CREATE TABLE profile_categories(user_id TEXT NOT NULL REFERENCES profiles(user_id),category TEXT NOT NULL,PRIMARY KEY(user_id,category));
    INSERT INTO profile_categories VALUES('solo','Татуировки'),('solo','Маникюр');
    CREATE INDEX categories_lookup ON profile_categories(category,user_id);
    CREATE TABLE appointments(id TEXT PRIMARY KEY,master_id TEXT NOT NULL REFERENCES performers(id),start INTEGER NOT NULL,end INTEGER NOT NULL,status TEXT NOT NULL,reminded INTEGER NOT NULL DEFAULT 0);
    INSERT INTO appointments(id,master_id,start,end,status) VALUES('a','solo',100,200,'pending'),('b','salon',200,300,'confirmed'),('c','salon',100,200,'cancelled');
    CREATE TABLE master_schedules(master_id TEXT PRIMARY KEY REFERENCES performers(id),weekdays TEXT NOT NULL);
    INSERT INTO master_schedules VALUES('solo','[1,2,3]');
    CREATE TABLE custom_cells(id INTEGER PRIMARY KEY,blob_value BLOB,big_integer INTEGER,unicode_text TEXT,optional_value TEXT);
    CREATE VIEW category_view AS SELECT * FROM profile_categories;
    CREATE TRIGGER custom_trigger AFTER UPDATE ON custom_cells BEGIN SELECT 1; END;
    CREATE TABLE compound_keys(a TEXT NOT NULL,b TEXT NOT NULL,PRIMARY KEY(a,b)) WITHOUT ROWID;
    INSERT INTO compound_keys VALUES('key','другой');`);
  db.prepare('INSERT INTO custom_cells VALUES(?,?,?,?,?)').run(7, Buffer.from([0, 255, 34, 10]), 9223372036854775807n, 'Строка\n["integer","7"]', null);
  db.close();
  return { directory, source, output: path.join(directory, 'snapshot') };
}

test('exports a read-only complete snapshot, row order, int64/blob/Unicode, keys and permissions without altering SQLite', async t => {
  const { source, output } = fixture(t);
  const before = sha(source);
  const summary = exportSnapshot(source, output);
  assert.equal(summary.dataChecksPassed, true);
  assert.equal(sha(source), before);
  assert.deepEqual(await verifySnapshot(output), { tables: summary.tables, rows: summary.rows, derivedTables: 0, derivedRows: 0, verified: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  const cells = manifest.tables.find(table => table.name === 'custom_cells');
  const row = JSON.parse(fs.readFileSync(path.join(output, cells.filename), 'utf8').trim());
  assert.deepEqual(row.cells[1], ['blob', 'AP8iCg==']);
  assert.deepEqual(row.cells[2], ['integer', '9223372036854775807']);
  assert.deepEqual(row.cells[3], ['text', 'Строка\n["integer","7"]']);
  assert.equal(row.cells[4], null);
  const categories = manifest.tables.find(table => table.name === 'profile_categories');
  assert.deepEqual(categories.primaryKey, ['user_id', 'category']);
  assert.equal(categories.foreignKeys[0].table, 'profiles');
  assert.ok(categories.indexes.some(index => index.name === 'categories_lookup'));
  const categoryRows = fs.readFileSync(path.join(output, categories.filename), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(categoryRows.map(record => record.cells[1][1]), ['Татуировки', 'Маникюр']);
  assert.deepEqual(categoryRows.map(record => record.sqliteRowid), ['1', '2']);
  assert.equal(manifest.tables.find(table => table.name === 'compound_keys').preservesRowid, false);
  const schema = JSON.parse(fs.readFileSync(path.join(output, 'schema.json')));
  assert.ok(schema.objects.some(object => object.type === 'view' && object.name === 'category_view'));
  assert.ok(schema.objects.some(object => object.type === 'trigger' && object.name === 'custom_trigger'));
  if (process.platform === 'win32') {
    const script = '& { param($snapshotPath) $acl=[System.IO.Directory]::GetAccessControl($snapshotPath); [pscustomobject]@{protected=$acl.AreAccessRulesProtected; rules=@($acl.Access | ForEach-Object {[pscustomobject]@{sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; inherited=$_.IsInherited}})} | ConvertTo-Json -Compress }';
    const acl = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', script, output], { encoding: 'utf8', windowsHide: true }));
    assert.equal(acl.protected, true);
    assert.equal(acl.rules.length, 2);
    assert.ok(acl.rules.every(rule => !rule.inherited));
    assert.ok(acl.rules.some(rule => rule.sid === 'S-1-5-18'));
  } else {
    assert.equal(fs.statSync(output).mode & 0o777, 0o700);
    for (const file of fs.readdirSync(output)) assert.equal(fs.statSync(path.join(output, file)).mode & 0o777, 0o600);
  }
  const command = execFileSync(process.execPath, ['scripts/sqlite-migration-snapshot.mjs', 'verify', '--dir', output], { encoding: 'utf8' });
  assert.ok(!command.includes('private-test-hash'));
  assert.equal(JSON.parse(command).verified, true);
  assert.throws(() => exportSnapshot(source, output), /OUTPUT_ALREADY_EXISTS/);
});

test('reports shared-person overlapping calendars, invalid geo/flags and broken references as failed readiness without silently repairing data', async t => {
  const { source, output } = fixture(t);
  const db = new DatabaseSync(source);
  db.exec(`PRAGMA foreign_keys=OFF; INSERT INTO appointments(id,master_id,start,end,status) VALUES('overlap','salon',150,250,'confirmed');
    UPDATE profiles SET longitude=NULL,published=2;
    UPDATE master_schedules SET weekdays='not-json';
    INSERT INTO performers VALUES('orphan','missing-account');`);
  db.close();
  const before = sha(source);
  assert.equal(exportSnapshot(source, output).dataChecksPassed, false);
  const report = JSON.parse(fs.readFileSync(path.join(output, 'readiness.json')));
  assert.equal(report.activeOverlapPairs, 2); // Shared person across solo and salon, plus overlap within salon.
  assert.equal(report.foreignKeyViolations.length, 1);
  assert.equal(report.invalidCoordinates[0].count, 1);
  assert.equal(report.invalidFlags[0].count, 1);
  assert.equal(report.invalidWeekdays, 1);
  assert.equal(report.postgresMigrationImplemented, false);
  assert.equal(sha(source), before);
  assert.equal((await verifySnapshot(output)).verified, true); // Export is sound; source is not ready to migrate.
});

test('rejects public output and detects private snapshot tampering', async t => {
  const { source, output } = fixture(t);
  const forbidden = path.resolve('public', 'never-create-migration-data');
  assert.throws(() => exportSnapshot(source, forbidden), /OUTPUT_NOT_PRIVATE/);
  assert.equal(fs.existsSync(forbidden), false);
  exportSnapshot(source, output);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  fs.appendFileSync(path.join(output, manifest.tables[0].filename), '\n');
  await assert.rejects(verifySnapshot(output));
});

test('inventories approved rebuildable RTree tables without exporting their storage, rejecting other virtual tables', async t => {
  const { directory, source, output } = fixture(t);
  const db = new DatabaseSync(source);
  db.exec(`CREATE TABLE map_locations(id INTEGER PRIMARY KEY,kind TEXT,target_id TEXT,latitude REAL,longitude REAL);
    CREATE VIRTUAL TABLE map_spatial USING rtree(id,min_longitude,max_longitude,min_latitude,max_latitude);
    INSERT INTO map_locations VALUES(1,'master','solo',54.9,82.9);
    INSERT INTO map_spatial VALUES(1,82.9,82.9,54.9,54.9);`);
  db.close();
  const summary = exportSnapshot(source, output);
  assert.equal(summary.derivedTables, 5);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  const derived = manifest.tables.filter(table => table.exportMode === 'inventory-only-derived');
  assert.ok(derived.every(table => !table.filename && !table.sha256));
  assert.equal((await verifySnapshot(output)).derivedTables, 5);
  const mutate = new DatabaseSync(source);
  mutate.exec('CREATE VIRTUAL TABLE unknown_index USING rtree(id,min_x,max_x,min_y,max_y)');
  mutate.close();
  assert.throws(() => exportSnapshot(source, path.join(directory, 'unknown-virtual')), /VIRTUAL_TABLE_REQUIRES_REVIEW/);
});

test('exports and verifies the real v2 application schema from a closed isolated server fixture', async t => {
  const directory = fs.mkdtempSync(path.join(root, 'sqlite-v2-export-test-'));
  const data = path.join(directory, 'data');
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), DATA_DIR: data, APP_ORIGIN: origin, NODE_ENV: 'test', DADATA_API_KEY: '', PROMOTIONS_ENABLED: '0', YANDEX_CLIENT_ID: '', VK_CLIENT_ID: '', TELEGRAM_CLIENT_ID: '' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stopped = false, logs = '';
  child.stdout.on('data', data => logs += data); child.stderr.on('data', data => logs += data);
  const exited = new Promise(resolve => child.once('exit', () => { stopped = true; resolve(); }));
  t.after(async () => { if (!stopped) child.kill(); await exited; removeFixture(directory); });
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {}
    if (stopped) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, logs);
  function client() { return { cookie: '', async call(url, body, method = 'POST') {
    const response = await fetch(origin + '/api' + url, { method, headers: { Origin: origin, 'Content-Type': 'application/json', Cookie: this.cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (response.headers.get('set-cookie')) this.cookie = response.headers.get('set-cookie').split(';')[0];
    return { status: response.status, data: await response.json() };
  } }; }
  const master = client(), owner = client();
  for (const [person, login, account_type] of [[master, 'export-master', 'master'], [owner, 'export-salon', 'salon']]) assert.equal((await person.call('/auth/register', { login, account_type, password: 'IsolatedExportPassword123' })).status, 201);
  assert.equal((await master.call('/profile', { name: 'Экспорт', slug: 'export-master', city: 'Новосибирск', categories: ['Татуировки', 'Маникюр'], teaches: true, published: false }, 'PUT')).status, 200);
  const salon = await owner.call('/salons', { name: 'Изолированный салон', city: 'Москва' });
  assert.equal(salon.status, 201);
  const staff = await owner.call(`/salons/${salon.data.id}/staff`, { name: 'Сотрудник без аккаунта', categories: ['Маникюр'] });
  assert.equal(staff.status, 201);
  assert.equal((await owner.call(`/performers/${staff.data.id}/invitations`, {})).status, 201);
  assert.equal((await owner.call('/appointments', { master_id: staff.data.id, client_name: 'Тестовая запись', start: Date.now() + 86400000, duration: 60 })).status, 201);
  child.kill(); await exited;
  const source = path.join(data, 'atelie.sqlite'), output = path.join(directory, 'snapshot');
  const before = sha(source), summary = exportSnapshot(source, output);
  assert.equal(summary.dataChecksPassed, true);
  assert.equal(summary.derivedTables, 5);
  assert.equal(sha(source), before);
  const result = await verifySnapshot(output);
  assert.equal(result.rows, summary.rows);
  const manifest = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json')));
  for (const table of ['users', 'identities', 'sessions', 'profiles', 'services', 'work_images', 'appointments', 'workspaces', 'performers', 'staff_invitations', 'booking_venues', 'guest_bookings', 'address_choices', 'promotions']) assert.ok(manifest.tables.some(item => item.name === table), table);
  const profile = manifest.tables.find(table => table.name === 'profiles');
  assert.equal(profile.foreignKeys.find(key => key.from === 'user_id').table, 'performers');
  assert.equal(manifest.tables.find(table => table.name === 'appointments').rows, 1);
  assert.equal(manifest.tables.find(table => table.name === 'users').rows, 2);
  assert.equal(manifest.tables.find(table => table.name === 'staff_invitations').rows, 1);
});
