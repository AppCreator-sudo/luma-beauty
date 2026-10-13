import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { experienceMonths, migrateProfileExperience } from '../lib/profile-experience.mjs';

test('experience is optional and older clients preserve a saved value', () => {
  assert.equal(experienceMonths(undefined, 40), 40);
  assert.equal(experienceMonths(null, 40), null);
  assert.equal(experienceMonths('', 40), null);
  assert.equal(experienceMonths('40'), 40);
  assert.equal(experienceMonths(0), 0);
  assert.equal(experienceMonths(1199), 1199);
  for (const invalid of [-1, 1200, 1.5, true, {}, '3 years', '1.5']) assert.throws(() => experienceMonths(invalid), { status: 400 });
});
test('existing profiles gain an empty field without changing data; migration is repeatable', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec("CREATE TABLE profiles(user_id TEXT PRIMARY KEY,bio TEXT); INSERT INTO profiles VALUES('one','My real description')");
    migrateProfileExperience(db); migrateProfileExperience(db);
    assert.deepEqual({ ...db.prepare('SELECT * FROM profiles').get() }, { user_id: 'one', bio: 'My real description', experience_months: null });
    db.prepare('UPDATE profiles SET experience_months=?').run(40);
    assert.equal(db.prepare('SELECT experience_months FROM profiles').get().experience_months, 40);
    assert.throws(() => db.prepare('UPDATE profiles SET experience_months=?').run(1200));
  } finally { db.close(); }
});
