import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';

const IMAGE_RULES = JSON.parse(await fs.readFile(new URL('./image-rules.json', import.meta.url), 'utf8'));

export function storiesModule({ app, db, dataDir, requireUser, fail, access }) {
  const all = (sql, ...args) => db.prepare(sql).all(...args);
  const get = (sql, ...args) => db.prepare(sql).get(...args);
  const run = (sql, ...args) => db.prepare(sql).run(...args);

  // Initialize table & indexes
  db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      owner_type TEXT NOT NULL, /* 'master' | 'salon' */
      owner_id TEXT NOT NULL,
      owner_slug TEXT NOT NULL,
      owner_name TEXT NOT NULL,
      owner_avatar TEXT NOT NULL DEFAULT '',
      image TEXT NOT NULL,
      caption TEXT NOT NULL DEFAULT '',
      service_id TEXT,
      service_name TEXT,
      service_price INTEGER,
      created INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_stories_active ON stories(expires_at DESC);
    CREATE INDEX IF NOT EXISTS idx_stories_owner ON stories(owner_type, owner_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_stories_slug ON stories(owner_slug, expires_at);
  `);

  const unlink = async (imagePath) => {
    if (!imagePath || typeof imagePath !== 'string') return;
    const filename = path.basename(imagePath);
    if (!filename.startsWith('atelie-media-story-')) return;
    const target = path.join(dataDir, 'uploads', filename);
    await fs.unlink(target).catch(() => {});
  };

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: IMAGE_RULES.maxBytes, files: 1, fields: 8, fieldSize: 8192 }
  }).single('image');

  function uploadMiddleware(req, res, next) {
    upload(req, res, error => {
      if (error) {
        return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
          error: error.code === 'LIMIT_FILE_SIZE' ? 'Фотография должна быть меньше 8 МБ' : 'Выберите одну фотографию JPG, PNG или WebP'
        });
      }
      next();
    });
  }

  async function convertStoryImage(file) {
    if (!file) fail('Выберите фотографию для истории');
    if (file.buffer.length > IMAGE_RULES.maxBytes) fail('Фотография должна быть меньше 8 МБ', 413);
    const photo = sharp(file.buffer, { limitInputPixels: IMAGE_RULES.maxPixels });
    const meta = await photo.metadata();
    if (!['jpeg', 'png', 'webp'].includes(meta.format)) {
      fail('Используйте JPG, PNG или WebP');
    }
    if (meta.width > IMAGE_RULES.maxSide || meta.height > IMAGE_RULES.maxSide) {
      fail('Фото должно быть не больше ' + IMAGE_RULES.maxSide.toLocaleString('ru-RU') + ' пикселей по каждой стороне');
    }
    const id = randomUUID();
    const filename = 'atelie-media-story-' + id + '.webp';
    const relativePath = '/uploads/' + filename;
    const dest = path.join(dataDir, 'uploads', filename);
    await fs.mkdir(path.join(dataDir, 'uploads'), { recursive: true });

    // Vertical / standard format max 1080x1920
    await photo.rotate()
      .resize({ width: 1080, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toFile(dest);

    return relativePath;
  }

  function str(v, max = 500) {
    return typeof v === 'string' ? v.trim().slice(0, max) : '';
  }

  // Resolves current display name and avatar for an author
  function resolveAuthor(ownerType, ownerId, fallbackSlug, fallbackName, fallbackAvatar) {
    if (ownerType === 'master') {
      const p = get('SELECT slug, name, avatar, published FROM profiles WHERE user_id = ?', ownerId);
      if (p) return { slug: p.slug, name: p.name, avatar: p.avatar, published: Boolean(p.published) };
    } else if (ownerType === 'salon') {
      const w = get("SELECT slug, name, logo, published FROM workspaces WHERE id = ? AND kind = 'salon'", ownerId);
      if (w) return { slug: w.slug, name: w.name, avatar: w.logo || '', published: Boolean(w.published) };
    }
    return { slug: fallbackSlug, name: fallbackName, avatar: fallbackAvatar, published: true };
  }

  // 1. GET /api/stories/active - active stories grouped by author
  app.get('/api/stories/active', (req, res) => {
    const now = Date.now();
    const rows = all(
      'SELECT * FROM stories WHERE expires_at > ? ORDER BY created ASC',
      now
    );

    const authorsMap = new Map();
    for (const row of rows) {
      const groupKey = row.owner_type + ':' + row.owner_id;
      if (!authorsMap.has(groupKey)) {
        const authorInfo = resolveAuthor(
          row.owner_type,
          row.owner_id,
          row.owner_slug,
          row.owner_name,
          row.owner_avatar
        );
        // Only show published authors in the public active feed
        if (!authorInfo.published && req.user?.id !== row.user_id) {
          continue;
        }
        authorsMap.set(groupKey, {
          owner_type: row.owner_type,
          owner_id: row.owner_id,
          owner_slug: authorInfo.slug,
          owner_name: authorInfo.name,
          owner_avatar: authorInfo.avatar,
          latest_created: row.created,
          stories: []
        });
      }

      const group = authorsMap.get(groupKey);
      if (group) {
        group.latest_created = Math.max(group.latest_created, row.created);
        group.stories.push({
          id: row.id,
          image: row.image,
          caption: row.caption,
          service_id: row.service_id,
          service_name: row.service_name,
          service_price: row.service_price,
          created: row.created,
          expires_at: row.expires_at,
          remaining_ms: Math.max(0, row.expires_at - now)
        });
      }
    }

    // Sort authors by latest story created DESC
    const result = Array.from(authorsMap.values()).sort(
      (a, b) => b.latest_created - a.latest_created
    );

    res.json(result);
  });

  // 2. GET /api/stories/active-slugs - lightweight list of slugs with active stories
  app.get('/api/stories/active-slugs', (req, res) => {
    const now = Date.now();
    const rows = all(
      'SELECT DISTINCT owner_slug, owner_type, owner_id FROM stories WHERE expires_at > ?',
      now
    );
    const slugs = new Set();
    for (const row of rows) {
      const info = resolveAuthor(row.owner_type, row.owner_id, row.owner_slug, '', '');
      if (info.published) {
        slugs.add(info.slug);
      }
    }
    res.json({ slugs: Array.from(slugs) });
  });

  // 3. GET /api/stories/owner/:slug - active stories for specific master or salon
  app.get('/api/stories/owner/:slug', (req, res) => {
    const slug = str(req.params.slug, 80).toLowerCase();
    const now = Date.now();
    const rows = all(
      'SELECT * FROM stories WHERE owner_slug = ? AND expires_at > ? ORDER BY created ASC',
      slug,
      now
    );

    if (!rows.length) {
      return res.json({ stories: [] });
    }

    const first = rows[0];
    const authorInfo = resolveAuthor(
      first.owner_type,
      first.owner_id,
      first.owner_slug,
      first.owner_name,
      first.owner_avatar
    );

    res.json({
      owner_type: first.owner_type,
      owner_id: first.owner_id,
      owner_slug: authorInfo.slug,
      owner_name: authorInfo.name,
      owner_avatar: authorInfo.avatar,
      stories: rows.map(r => ({
        id: r.id,
        image: r.image,
        caption: r.caption,
        service_id: r.service_id,
        service_name: r.service_name,
        service_price: r.service_price,
        created: r.created,
        expires_at: r.expires_at,
        remaining_ms: Math.max(0, r.expires_at - now)
      }))
    });
  });

  // 4. GET /api/stories/mine - get logged-in user's active stories (for studio or salon cabinet)
  app.get('/api/stories/mine', requireUser, (req, res) => {
    const now = Date.now();
    const salonId = str(req.query.workspace_id, 80);
    let rows;
    if (salonId) {
      // Check salon management permissions
      const w = get("SELECT * FROM workspaces WHERE id = ? AND kind = 'salon'", salonId);
      if (!w || (!access.canManage(req.user.id, w.id) && w.owner_user_id !== req.user.id)) {
        fail('Нет доступа к историям салона', 403);
      }
      rows = all(
        "SELECT * FROM stories WHERE owner_type = 'salon' AND owner_id = ? AND expires_at > ? ORDER BY created DESC",
        salonId,
        now
      );
    } else {
      rows = all(
        "SELECT * FROM stories WHERE owner_type = 'master' AND user_id = ? AND expires_at > ? ORDER BY created DESC",
        req.user.id,
        now
      );
    }

    res.json(
      rows.map(r => ({
        id: r.id,
        image: r.image,
        caption: r.caption,
        service_id: r.service_id,
        service_name: r.service_name,
        service_price: r.service_price,
        created: r.created,
        expires_at: r.expires_at,
        remaining_ms: Math.max(0, r.expires_at - now),
        remaining_hours: Math.ceil(Math.max(0, r.expires_at - now) / 3600000)
      }))
    );
  });

  // 5. POST /api/stories - create a story
  app.post('/api/stories', requireUser, uploadMiddleware, async (req, res) => {
    const ownerType = str(req.body.owner_type, 20) === 'salon' ? 'salon' : 'master';
    let ownerId = req.user.id;
    let ownerSlug = '';
    let ownerName = '';
    let ownerAvatar = '';

    if (ownerType === 'master') {
      const p = get('SELECT user_id, slug, name, avatar FROM profiles WHERE user_id = ?', req.user.id);
      if (!p) fail('Сначала создайте страницу мастера');
      ownerId = p.user_id;
      ownerSlug = p.slug;
      ownerName = p.name;
      ownerAvatar = p.avatar || '';
    } else {
      const workspaceId = str(req.body.workspace_id, 80);
      if (!workspaceId) fail('Укажите идентификатор салона');
      const w = get("SELECT id, slug, name, logo, owner_user_id FROM workspaces WHERE id = ? AND kind = 'salon'", workspaceId);
      if (!w || (!access.canManage(req.user.id, w.id) && w.owner_user_id !== req.user.id)) {
        fail('Нет прав на публикацию историй от имени этого салона', 403);
      }
      ownerId = w.id;
      ownerSlug = w.slug;
      ownerName = w.name;
      ownerAvatar = w.logo || '';
    }

    // Limit active stories to 15 per author
    const activeCount = get(
      'SELECT COUNT(*) n FROM stories WHERE owner_type = ? AND owner_id = ? AND expires_at > ?',
      ownerType,
      ownerId,
      Date.now()
    ).n;
    if (activeCount >= 15) {
      fail('Лимит — 15 активных историй одновременно. Дождитесь завершения старых историй.');
    }

    // Optional service attachment
    let serviceId = null;
    let serviceName = null;
    let servicePrice = null;
    const rawServiceId = str(req.body.service_id, 80);
    if (rawServiceId) {
      if (ownerType === 'master') {
        const svc = get('SELECT id, name, price FROM services WHERE id = ? AND user_id = ?', rawServiceId, req.user.id);
        if (svc) {
          serviceId = svc.id;
          serviceName = svc.name;
          servicePrice = svc.price;
        }
      } else {
        // Salon service
        const svc = get('SELECT id, name, price FROM salon_services WHERE id = ? AND workspace_id = ?', rawServiceId, ownerId);
        if (svc) {
          serviceId = svc.id;
          serviceName = svc.name;
          servicePrice = svc.price;
        }
      }
    }

    const caption = str(req.body.caption, 500);
    const image = await convertStoryImage(req.file);

    const id = randomUUID();
    const created = Date.now();
    const expiresAt = created + 24 * 60 * 60 * 1000; // Exact 24 hours

    run(
      `INSERT INTO stories(
        id, user_id, owner_type, owner_id, owner_slug, owner_name, owner_avatar,
        image, caption, service_id, service_name, service_price, created, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      req.user.id,
      ownerType,
      ownerId,
      ownerSlug,
      ownerName,
      ownerAvatar,
      image,
      caption,
      serviceId,
      serviceName,
      servicePrice,
      created,
      expiresAt
    );

    res.status(201).json({
      ok: true,
      story: {
        id,
        owner_type: ownerType,
        owner_id: ownerId,
        owner_slug: ownerSlug,
        owner_name: ownerName,
        owner_avatar: ownerAvatar,
        image,
        caption,
        service_id: serviceId,
        service_name: serviceName,
        service_price: servicePrice,
        created,
        expires_at: expiresAt,
        remaining_hours: 24
      }
    });
  });

  // 6. PATCH /api/stories/:id - edit caption or attached service of an active story
  app.patch('/api/stories/:id', requireUser, async (req, res) => {
    const story = get('SELECT * FROM stories WHERE id = ?', req.params.id);
    if (!story) fail('История не найдена', 404);

    let allowed = false;
    if (story.user_id === req.user.id) {
      allowed = true;
    } else if (story.owner_type === 'salon') {
      const w = get("SELECT id, owner_user_id FROM workspaces WHERE id = ? AND kind = 'salon'", story.owner_id);
      if (w && (w.owner_user_id === req.user.id || access.canManage(req.user.id, w.id))) {
        allowed = true;
      }
    }

    if (!allowed) {
      fail('Нет прав на редактирование этой истории', 403);
    }

    const caption = req.body.caption !== undefined ? str(req.body.caption, 500) : story.caption;
    let serviceId = story.service_id;
    let serviceName = story.service_name;
    let servicePrice = story.service_price;

    if (req.body.service_id !== undefined) {
      const rawServiceId = str(req.body.service_id, 80);
      if (rawServiceId) {
        if (story.owner_type === 'master') {
          const svc = get('SELECT id, name, price FROM services WHERE id = ? AND user_id = ?', rawServiceId, req.user.id);
          if (svc) {
            serviceId = svc.id;
            serviceName = svc.name;
            servicePrice = svc.price;
          }
        } else {
          const svc = get('SELECT id, name, price FROM salon_services WHERE id = ? AND workspace_id = ?', rawServiceId, story.owner_id);
          if (svc) {
            serviceId = svc.id;
            serviceName = svc.name;
            servicePrice = svc.price;
          }
        }
      } else {
        serviceId = null;
        serviceName = null;
        servicePrice = null;
      }
    }

    run(
      'UPDATE stories SET caption = ?, service_id = ?, service_name = ?, service_price = ? WHERE id = ?',
      caption,
      serviceId,
      serviceName,
      servicePrice,
      story.id
    );

    res.json({
      ok: true,
      story: {
        ...story,
        caption,
        service_id: serviceId,
        service_name: serviceName,
        service_price: servicePrice
      }
    });
  });

  // 7. DELETE /api/stories/:id - delete a story
  app.delete('/api/stories/:id', requireUser, async (req, res) => {
    const story = get('SELECT * FROM stories WHERE id = ?', req.params.id);
    if (!story) fail('История не найдена', 404);

    let allowed = false;
    if (story.user_id === req.user.id) {
      allowed = true;
    } else if (story.owner_type === 'salon') {
      const w = get("SELECT id, owner_user_id FROM workspaces WHERE id = ? AND kind = 'salon'", story.owner_id);
      if (w && (w.owner_user_id === req.user.id || access.canManage(req.user.id, w.id))) {
        allowed = true;
      }
    }

    if (!allowed) {
      fail('Нет прав на удаление этой истории', 403);
    }

    await unlink(story.image);
    run('DELETE FROM stories WHERE id = ?', story.id);

    res.json({ ok: true });
  });

  return {
    unlinkStoryImage: unlink
  };
}
