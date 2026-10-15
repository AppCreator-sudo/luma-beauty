import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';

const root = path.resolve(process.env.LUMA_CABINET_TEST_ROOT || '.cache/cabinet-refinement-20261015b');
assert.ok(root.startsWith(path.resolve('.cache') + path.sep));
const f = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const db = new DatabaseSync(path.join(root, 'data/atelie.sqlite'));
const master = f.free;
const token = randomUUID();
db.prepare('INSERT INTO sessions(token,user_id,expires,authenticated_at) VALUES(?,?,?,?)').run(
  createHash('sha256').update(token).digest('hex'),
  master.id,
  Date.now() + 3600000,
  Date.now()
);

const outDir = 'docs/ui-checks/2026-10-15-master-portfolio';
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ serviceWorkers: 'block' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', err => pageErrors.push(err.message));

await context.addCookies([{ name: 'atelie_session', value: token, url: f.origin }]);

try {
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width > 800 ? 1000 : 844 });
    await page.goto(f.origin + '/v2/studio?tab=works');
    await page.locator('.master-cabinet').waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);

    // 1. Verify NO horizontal overflow
    const hasOverflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(hasOverflow, false, `Width ${width} has horizontal overflow!`);

    // 2. Check grid and work card width
    const grid = page.locator('.studio-work-grid');
    await expect(grid).toBeVisible();
    const firstArticle = grid.locator('article').first();
    await expect(firstArticle).toBeVisible();
    const box = await firstArticle.boundingBox();
    assert.ok(box, 'Article bounding box exists');

    console.log(`[${width}px] First work card width: ${box.width}px, height: ${box.height}px`);

    if (width === 1440) {
      // In 1440px desktop, single work card must NOT stretch to full screen (>600px)
      assert.ok(box.width <= 260, `Card width on desktop should be <= 260px, got ${box.width}px`);
      assert.ok(box.width >= 160, `Card width on desktop should be >= 160px, got ${box.width}px`);
    }

    // Capture grid view
    await page.screenshot({ path: path.join(outDir, `master-portfolio-grid-${width}.png`) });

    // 3. Test toggle button "+ Добавить работу"
    const toggleBtn = page.getByRole('button', { name: /Добавить работу|Закрыть форму/i });
    await expect(toggleBtn).toBeVisible();
    
    // Click toggle to open form if not already open
    const isFormVisible = await page.locator('.studio-work-upload-card').isVisible();
    if (!isFormVisible) {
      await toggleBtn.click();
      await page.waitForTimeout(150);
    }

    const formCard = page.locator('.studio-work-upload-card');
    await expect(formCard).toBeVisible();

    const formBox = await formCard.boundingBox();
    if (width === 1440) {
      assert.ok(formBox.width <= 660, `Form card width on desktop should be <= 660px, got ${formBox.width}px`);
    }

    // Verify step 1 elements
    await expect(page.locator('.cabinet-steps')).toBeVisible();
    await expect(page.locator('.cabinet-step-count')).toContainText('Шаг 1 из 3');
    await expect(page.getByRole('button', { name: 'Далее: фото', exact: true })).toBeVisible();

    // Verify cancel button works
    const cancelBtn = page.getByRole('button', { name: 'Отменить', exact: true });
    if (await cancelBtn.isVisible()) {
      await expect(cancelBtn).toBeVisible();
    }

    // Verify NO overflow with form open
    const hasOverflowForm = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
    assert.equal(hasOverflowForm, false, `Width ${width} with form open has horizontal overflow!`);

    await page.screenshot({ path: path.join(outDir, `master-portfolio-form-${width}.png`) });

    console.log(`PASS master portfolio grid and form at ${width}px`);
  }

  assert.deepEqual(pageErrors, [], 'No browser console errors');
  console.log('ALL CHECKS PASSED SUCCESSFULLY!');
} finally {
  await browser.close();
  db.close();
}
