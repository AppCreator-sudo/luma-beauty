const clean = value => String(value || '').toLocaleLowerCase('ru-RU').replace(/ё/g, 'е').trim();
const cityKey = value => clean(value).replace(/^(?:г\.|город)\s*/u, '').replace(/[^\p{L}\p{N}]/gu, '');
const expandRoad = value => String(value).replace(/(?:^|(?<=[\s,]))пр-кт(?=[\s,]|$)/giu,'проспект');
const roadKey = value => clean(expandRoad(value)).replace(/(?:^|[\s,])(?:улица|ул\.?|проспект|просп\.?|пр-т|переулок|пер\.?|шоссе|набережная|наб\.?|бульвар|бул\.?|площадь|пл\.?)(?=[\s,]|$)/gu, ' ').replace(/[^\p{L}\p{N}]/gu, '');
const houseKey = value => clean(value).replace(/корпус|корп\.?/gu, 'к').replace(/строение|стр\.?/gu, 'с').replace(/[\s.,]/g, '');
const roadType = value => {
  const match = clean(expandRoad(value)).match(/(?:^|[\s,])(улица|ул\.?|проспект|просп\.?|пр-т|переулок|пер\.?|шоссе|набережная|наб\.?|бульвар|бул\.?|площадь|пл\.?)(?=[\s,]|$)/u);
  if (!match) return '';
  const type = match[1];
  return /^(улица|ул)/u.test(type) ? 'улица' : /^(просп|пр-т)/u.test(type) ? 'проспект' : /^пер/u.test(type) ? 'переулок' : /^наб/u.test(type) ? 'набережная' : /^бул/u.test(type) ? 'бульвар' : /^пл/u.test(type) ? 'площадь' : type;
};

export function parseAddress(address) {
  const match = String(address).trim().match(/^(.*?)[,\s]+(?:д(?:ом)?\.?\s*)?(\d+[а-яa-z]?(?:\s*\/\s*\d+[а-яa-z]?)?(?:[\s,]*(?:к(?:орпус|орп)?\.?|с(?:тр(?:оение)?)?\.?)\s*\d+[а-яa-z]?)*)$/iu);
  return match && roadKey(match[1]) ? { road: match[1].replace(/[,\s]+$/u, ''), house: match[2] } : null;
}

export function exactCandidates(data, city, address) {
  const requested = parseAddress(address);
  if (!requested || !Array.isArray(data)) return [];
  return data.filter(item => {
    const found = item.address || {};
    return found.country_code === 'ru' && cityKey(found.city || found.town || found.village || found.municipality) === cityKey(city)
      && roadKey(found.road || found.pedestrian) === roadKey(requested.road)
      && (!roadType(requested.road) || roadType(found.road || found.pedestrian) === roadType(requested.road))
      && houseKey(found.house_number) === houseKey(requested.house)
      && Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon))
      && Math.abs(Number(item.lat)) <= 90 && Math.abs(Number(item.lon)) <= 180;
  }).map(item => ({ label: String(item.display_name || '').slice(0, 300), latitude: Number(item.lat), longitude: Number(item.lon), building: ['house', 'building'].includes(item.addresstype) || item.category === 'building' || item.class === 'building' }));
}

export function createGeocoder({ db, origin, endpoint = process.env.GEOCODER_URL || 'https://nominatim.openstreetmap.org/search', fetcher = fetch, interval = 1100 }) {
  db.exec('CREATE TABLE IF NOT EXISTS geocode_cache(query TEXT PRIMARY KEY,results TEXT NOT NULL,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS geocode_throttle(id INTEGER PRIMARY KEY CHECK(id=1),next_at INTEGER NOT NULL); INSERT OR IGNORE INTO geocode_throttle VALUES(1,0)');
  let queue = Promise.resolve();
  return function geocode(city, address) {
    const parsed = parseAddress(address);
    if (!parsed) return Promise.resolve([]);
    const key = 'exact-v4:' + JSON.stringify([cityKey(city), roadKey(parsed.road), roadType(parsed.road), houseKey(parsed.house)]);
    const job = queue.then(async () => {
      const cached = db.prepare('SELECT results FROM geocode_cache WHERE query=? AND expires>?').get(key, Date.now());
      if (cached) return JSON.parse(cached.results);
      // Shared SQLite reservation also covers the one-time migration process.
      const { next_at } = db.prepare('UPDATE geocode_throttle SET next_at=MAX(next_at,?)+? WHERE id=1 RETURNING next_at').get(Date.now(), interval);
      const delay = next_at - interval - Date.now();
      if (delay > 0) await new Promise(resolve => setTimeout(resolve, delay));
      const url = new URL(endpoint);
      if (url.protocol !== 'https:') throw new Error('Geocoder requires HTTPS');
      url.search = new URLSearchParams({ street: parsed.house + ' ' + expandRoad(parsed.road), city, format: 'jsonv2', addressdetails: '1', countrycodes: 'ru', limit: '5' });
      const response = await fetcher(url, { headers: { 'User-Agent': `Atelie-PWA/0.1 (${origin})`, 'Accept-Language': 'ru' }, signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw new Error(`Geocoder returned ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data)) throw new Error('Invalid geocoder response');
      const results = exactCandidates(data, city, address);
      db.prepare('INSERT INTO geocode_cache VALUES(?,?,?) ON CONFLICT(query) DO UPDATE SET results=excluded.results,expires=excluded.expires').run(key, JSON.stringify(results), Date.now() + (results.length ? 30 : 1) * 86400000);
      return results;
    });
    queue = job.catch(() => {});
    return job;
  };
}
