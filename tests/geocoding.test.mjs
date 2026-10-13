import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { parseAddress, exactCandidates, createGeocoder } from '../lib/geocoding.mjs';

const building = { display_name: 'Красный проспект, 1, Новосибирск', lat: '55.020213', lon: '82.9225053', addresstype: 'building', address: { city: 'Новосибирск', road: 'Красный проспект', house_number: '1', country_code: 'ru' } };

test('address matching rejects other streets, cities and house numbers', () => {
  assert.deepEqual(parseAddress('Красный проспект, д. 1'), { road: 'Красный проспект', house: '1' });
  assert.deepEqual(parseAddress('улица 1905 года 12 к2'), { road: 'улица 1905 года', house: '12 к2' });
  assert.equal(parseAddress('Красный проспект'), null);
  const candidates = [building, ...[{ road: 'Другая улица' }, { city: 'Москва' }, { house_number: '11' }, { house_number: '1 к2' }].map(change => ({ ...building, address: { ...building.address, ...change } }))];
  assert.equal(exactCandidates(candidates, 'Новосибирск', 'Красный проспект 1').length, 1);
  assert.equal(exactCandidates([building], 'Новосибирск', 'просп. Красный, 1')[0].building, true);
  assert.equal(exactCandidates([building], 'Новосибирск', 'Красный пр-кт, д 1')[0].building, true);
  assert.equal(exactCandidates([building], 'Новосибирск', 'улица Красный, 1').length, 0);
});

test('geocoder uses structured address fields and shares a persistent cache', async () => {
  const db = new DatabaseSync(':memory:');
  let calls = 0;
  const fetcher = async url => {
    calls++;
    assert.equal(url.searchParams.get('street'), '1 Красный проспект');
    assert.equal(url.searchParams.get('city'), 'Новосибирск');
    return { ok: true, json: async () => [building] };
  };
  try {
    const first = createGeocoder({ db, origin: 'https://atelie.example', fetcher, interval: 0 });
    assert.equal((await first('Новосибирск', 'Красный проспект 1')).length, 1);
    const second = createGeocoder({ db, origin: 'https://atelie.example', fetcher, interval: 0 });
    await second('Новосибирск', 'проспект Красный, д. 1');
    assert.equal(calls, 1);
    assert.deepEqual(await second('Новосибирск', 'Адрес без дома'), []);
  } finally { db.close(); }
});
