// Targeted maintenance only. Default is read-only; --apply takes a backup first.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const target = 'atelie-demo-0';
const apply = process.argv.includes('--apply');
const data = path.resolve(process.env.DATA_DIR || 'data');
const file = path.join(data, 'atelie.sqlite');
if (!fs.existsSync(file)) throw new Error('Database does not exist');
const db = new DatabaseSync(file, { readOnly: !apply });
db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000');
const all = (sql, ...args) => db.prepare(sql).all(...args);
const get = (sql, ...args) => db.prepare(sql).get(...args);
const relations = {
  users: ['id=?', target], profiles: ['user_id=?', target],
  services: ['user_id=?', target], works: ['user_id=?', target],
  work_images: ['work_id IN (SELECT id FROM works WHERE user_id=?)', target],
  availability_slots: ['master_id=?', target], master_schedules: ['master_id=?', target],
  appointments: ['master_id=? OR client_id=?', target, target],
  saved_works: ['user_id=? OR work_id IN (SELECT id FROM works WHERE user_id=?)', target, target],
  follows: ['user_id=? OR master_id=?', target, target],
  reviews: ['client_id=? OR master_id=?', target, target],
  sessions: ['user_id=?', target], notices: ['user_id=?', target], identities: ['user_id=?', target], pushes: ['user_id=?', target],
};
const tables = new Set(all("SELECT name FROM sqlite_master WHERE type='table'").map(row => row.name));
const counts = () => Object.fromEntries(Object.entries(relations).map(([table, [where, ...args]]) => [table, tables.has(table) ? get(`SELECT COUNT(*) n FROM ${table} WHERE ${where}`, ...args).n : 0]));
const validate = () => {
  const profile = get('SELECT slug,is_demo FROM profiles WHERE user_id=?', target);
  if (!profile || profile.slug !== 'demo-anna' || profile.is_demo !== 1) throw new Error('Expected demo identity not found; refusing deletion');
};
// These rows must remain byte-for-byte unchanged during the transaction.
const protectedRows = () => JSON.stringify([
  all('SELECT * FROM users WHERE id<>? ORDER BY id', target),
  all('SELECT * FROM profiles WHERE user_id<>? ORDER BY user_id', target),
  all('SELECT * FROM services WHERE user_id<>? ORDER BY id', target),
  all('SELECT * FROM works WHERE user_id<>? ORDER BY id', target),
  all('SELECT * FROM appointments WHERE master_id<>? AND (client_id IS NULL OR client_id<>?) ORDER BY id', target, target),
]);
try {
  if (!get('SELECT id FROM users WHERE id=?', target)) { console.log('Demo account is absent; no changes.'); }
  else {
    validate();
    const before = counts();
    console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', target, relatedRows: before }));
    if (apply) {
      const backup = path.join(data, 'maintenance-backups', 'remove-demo-anna-' + new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(backup, { recursive: true, mode: 0o700 });
      db.prepare('VACUUM INTO ?').run(path.join(backup, 'atelie.sqlite'));
      const media = new Set(Array.from({ length: 10 }, (_, i) => `demo-media-${i + 1}.webp`));
      db.exec('BEGIN IMMEDIATE');
      try {
        validate();
        assert.deepEqual(all('PRAGMA foreign_key_check'), []);
        const protectedBefore = protectedRows();
        for (const row of all('SELECT avatar image FROM profiles WHERE user_id=? UNION SELECT image FROM works WHERE user_id=? UNION SELECT wi.image FROM work_images wi JOIN works w ON w.id=wi.work_id WHERE w.user_id=?', target, target, target)) {
          if (row.image?.startsWith('/uploads/')) media.add(path.basename(row.image));
        }
        db.prepare('DELETE FROM appointments WHERE client_id=?').run(target);
        assert.equal(db.prepare('DELETE FROM users WHERE id=?').run(target).changes, 1);
        assert.equal(protectedRows(), protectedBefore);
        assert.deepEqual(all('PRAGMA foreign_key_check'), []);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      const references = new Set(all('SELECT avatar image FROM profiles UNION SELECT image FROM works UNION SELECT image FROM work_images').map(row => row.image));
      const moved = [], retained = [];
      for (const name of media) {
        if (references.has('/uploads/' + name)) { retained.push(name); continue; }
        const source = path.join(data, 'uploads', name);
        if (!fs.existsSync(source)) continue;
        // Only known files in this database's uploads directory; backup is not served.
        assert.equal(path.dirname(source), path.join(data, 'uploads'));
        fs.renameSync(source, path.join(backup, name));
        moved.push(name);
      }
      const report = { target, removedRows: before, removedUploads: moved.length, sharedUploadsRetained: retained.length, backup };
      fs.writeFileSync(path.join(backup, 'report.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
    }
  }
} finally { db.close(); }
