import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

// Additive migration: existing images, reviews, follows and appointments stay intact.
export function migratePageOptions(db, {backupDir} = {}) {
  if (db.prepare('SELECT 1 FROM schema_migrations WHERE name=?').get('profile-page-options-v1')) return;
  if (backupDir) {
    fs.mkdirSync(backupDir, {recursive:true, mode:0o700});
    fs.chmodSync(backupDir, 0o700);
    const file = path.join(backupDir, 'before-profile-page-options-' + Date.now() + '-' + randomUUID() + '.sqlite');
    db.prepare('VACUUM INTO ?').run(file); fs.chmodSync(file, 0o600);
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(`ALTER TABLE profiles ADD COLUMN looking_models INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspaces ADD COLUMN theme TEXT NOT NULL DEFAULT 'green';
      ALTER TABLE workspaces ADD COLUMN teaches INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspaces ADD COLUMN looking_models INTEGER NOT NULL DEFAULT 0;
      UPDATE workspaces SET teaches=EXISTS(SELECT 1 FROM performers staff JOIN profiles p ON p.user_id=staff.id
        WHERE staff.workspace_id=workspaces.id AND staff.active=1 AND staff.bookable=1 AND p.is_demo=0 AND p.teaches=1) WHERE kind='salon';
      CREATE TABLE saved_salons(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        salon_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,created INTEGER NOT NULL,
        PRIMARY KEY(user_id,salon_id));`);
    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run('profile-page-options-v1', Date.now());
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export function pageOptions(body, current, fail) {
  for (const field of ['teaches','looking_models']) {
    if (body[field] !== undefined && typeof body[field] !== 'boolean') fail('Проверьте отметки страницы');
  }
  if (body.theme !== undefined && !['cream','wine','green'].includes(body.theme)) fail('Выберите цвет фона');
  return {
    teaches: body.teaches === undefined ? Number(Boolean(current?.teaches)) : Number(body.teaches),
    looking_models: body.looking_models === undefined ? Number(Boolean(current?.looking_models)) : Number(body.looking_models),
    theme: body.theme ?? current?.theme ?? 'green',
  };
}
