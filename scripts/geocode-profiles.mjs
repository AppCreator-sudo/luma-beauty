// One-time migration. Dry run never contacts the geocoder or changes profiles.
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { createGeocoder } from '../lib/geocoding.mjs';

const apply = process.argv.includes('--apply');
const db = new DatabaseSync(path.resolve(process.env.DATA_DIR || 'data', 'atelie.sqlite'));
db.exec('PRAGMA busy_timeout=5000');
const profiles = db.prepare("SELECT user_id,city,address FROM profiles WHERE published=1 AND TRIM(address)<>'' AND (latitude IS NULL OR longitude IS NULL)").all();
console.log(`${profiles.length} profiles need a map point. ${apply ? 'Applying precise building matches.' : 'Dry run: no data will change.'}`);
try {
  if (apply) {
    const geocode = createGeocoder({ db, origin: process.env.APP_ORIGIN || 'https://atelie.example' });
    let updated = 0;
    for (const [index, profile] of profiles.entries()) {
      if (index) await new Promise(resolve => setTimeout(resolve, 15000));
      const results = await geocode(profile.city, profile.address);
      const buildings = results.filter(item => item.building);
      const matches = buildings.length ? buildings : results;
      if (matches.length !== 1) { console.log(`${profile.user_id}: needs manual address selection`); continue; }
      const point = matches[0];
      // Do not overwrite an address or point changed while the request was running.
      const result = db.prepare('UPDATE profiles SET latitude=?,longitude=? WHERE user_id=? AND city=? AND address=? AND (latitude IS NULL OR longitude IS NULL)').run(point.latitude, point.longitude, profile.user_id, profile.city, profile.address);
      updated += Number(result.changes);
      console.log(`${profile.user_id}: ${result.changes ? 'mapped' : 'changed in the meantime; skipped'}`);
    }
    console.log(`Updated ${updated} profile(s).`);
  }
} finally { db.close(); }
