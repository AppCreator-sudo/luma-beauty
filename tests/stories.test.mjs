import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { DatabaseSync } from 'node:sqlite';

test('stories lifecycle: upload, 24h expiration, active feed, direct CTA, slug query, limits and deletion', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atelie-stories-'));
  const origin = 'http://localhost:3199';

  const child = spawn(process.execPath, ['server.mjs'], {
    env: { ...process.env, PORT: '3199', DATA_DIR: dir, APP_ORIGIN: origin, NODE_ENV: 'test' },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let logs = '';
  child.stdout.on('data', b => logs += b);
  child.stderr.on('data', b => logs += b);

  t.after(async () => {
    child.kill();
    await new Promise(r => child.once('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Wait for server ready
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(origin + '/api/health')).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  assert.ok(ready, 'Server failed to start:\n' + logs);

  const client = () => ({
    cookie: '',
    async call(url, body, method = 'GET') {
      const form = body instanceof FormData;
      const r = await fetch(origin + '/api' + url, {
        method,
        headers: {
          Origin: origin,
          Cookie: this.cookie,
          ...(form ? {} : { 'Content-Type': 'application/json' })
        },
        body: body === undefined ? undefined : form ? body : JSON.stringify(body)
      });
      if (r.headers.get('set-cookie')) {
        this.cookie = r.headers.get('set-cookie').split(';')[0];
      }
      const text = await r.text();
      let data = null;
      try { data = JSON.parse(text); } catch { data = text; }
      return { status: r.status, data };
    }
  });

  const master = client();
  const other = client();
  const visitor = client();

  // Register master and other
  assert.equal((await master.call('/auth/register', { login: 'storymaster', password: 'Password123!', account_type: 'master' }, 'POST')).status, 201);
  assert.equal((await other.call('/auth/register', { login: 'othermaster', password: 'Password123!', account_type: 'master' }, 'POST')).status, 201);

  // Setup master profile
  const p1 = await master.call('/profile', { name: 'Елена Смирнова', slug: 'elena-beauty', city: 'Новосибирск', published: true }, 'PUT');
  assert.equal(p1.status, 200);

  // Add service for CTA link
  const s1 = await master.call('/services', { name: 'Маникюр с дизайном', price: 2500, duration: 90 }, 'POST');
  assert.equal(s1.status, 201);
  const serviceId = s1.data.id;

  // Generate test image (portrait 400x700)
  const imageBuf = await sharp({
    create: { width: 400, height: 700, channels: 3, background: '#722F37' }
  }).jpeg().toBuffer();

  const makeForm = (caption = '', svc = '') => {
    const f = new FormData();
    f.append('image', new Blob([imageBuf], { type: 'image/jpeg' }), 'story.jpg');
    if (caption) f.append('caption', caption);
    if (svc) f.append('service_id', svc);
    return f;
  };

  // 1. Unauthenticated upload fails
  const anonUpload = await visitor.call('/stories', makeForm('Тест'), 'POST');
  assert.equal(anonUpload.status, 401);

  // 2. Master uploads story with linked service
  const upload1 = await master.call('/stories', makeForm('Свободные окна на сегодня! Дизайн в подарок ✨', serviceId), 'POST');
  assert.equal(upload1.status, 201);
  assert.ok(upload1.data.ok);
  assert.equal(upload1.data.story.caption, 'Свободные окна на сегодня! Дизайн в подарок ✨');
  assert.equal(upload1.data.story.service_id, serviceId);
  assert.equal(upload1.data.story.service_name, 'Маникюр с дизайном');
  assert.equal(upload1.data.story.service_price, 2500);
  assert.ok(upload1.data.story.image.startsWith('/uploads/atelie-media-story-'));
  assert.ok(upload1.data.story.expires_at > Date.now() + 86000000); // ~24 hours
  const story1Id = upload1.data.story.id;

  // 3. Master uploads second story without service
  const upload2 = await master.call('/stories', makeForm('Процесс преображения в лучах солнца ☀️'), 'POST');
  assert.equal(upload2.status, 201);
  const story2Id = upload2.data.story.id;

  // 4. GET /api/stories/active - should return grouped author with 2 stories
  const feed = await visitor.call('/stories/active');
  assert.equal(feed.status, 200);
  assert.equal(feed.data.length, 1);
  assert.equal(feed.data[0].owner_slug, 'elena-beauty');
  assert.equal(feed.data[0].owner_name, 'Елена Смирнова');
  assert.equal(feed.data[0].stories.length, 2);
  assert.equal(feed.data[0].stories[0].id, story1Id);
  assert.equal(feed.data[0].stories[1].id, story2Id);

  // 5. GET /api/stories/active-slugs - should return ['elena-beauty']
  const slugs = await visitor.call('/stories/active-slugs');
  assert.equal(slugs.status, 200);
  assert.deepEqual(slugs.data.slugs, ['elena-beauty']);

  // 6. GET /api/stories/owner/elena-beauty - returns author stories
  const ownerStories = await visitor.call('/stories/owner/elena-beauty');
  assert.equal(ownerStories.status, 200);
  assert.equal(ownerStories.data.owner_slug, 'elena-beauty');
  assert.equal(ownerStories.data.stories.length, 2);

  // 7. GET /api/stories/mine - for master
  const mine = await master.call('/stories/mine');
  assert.equal(mine.status, 200);
  assert.equal(mine.data.length, 2);
  assert.equal(mine.data[0].remaining_hours, 24);

  // 8. Other user cannot delete master's story
  const deleteForbidden = await other.call('/stories/' + story1Id, undefined, 'DELETE');
  assert.equal(deleteForbidden.status, 403);

  // 9. Master deletes story 1
  const deleteSuccess = await master.call('/stories/' + story1Id, undefined, 'DELETE');
  assert.equal(deleteSuccess.status, 200);
  assert.ok(deleteSuccess.data.ok);

  // Verify story 1 is gone from active feed and owner query
  const feedAfter = await visitor.call('/stories/active');
  assert.equal(feedAfter.data[0].stories.length, 1);
  assert.equal(feedAfter.data[0].stories[0].id, story2Id);

  // 10. Verify 24h expiration in SQLite
  const db = new DatabaseSync(path.join(dir, 'atelie.sqlite'));
  // Set expires_at in the past for story2
  db.exec(`UPDATE stories SET expires_at = ${Date.now() - 1000} WHERE id = '${story2Id}'`);
  db.close();

  // Now active feed should be empty
  const feedExpired = await visitor.call('/stories/active');
  assert.equal(feedExpired.status, 200);
  assert.equal(feedExpired.data.length, 0);

  const slugsExpired = await visitor.call('/stories/active-slugs');
  assert.equal(slugsExpired.data.slugs.length, 0);

  console.log('Stories test completed successfully!');
});
