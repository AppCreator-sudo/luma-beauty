import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const root = path.resolve('.cache/stories-verify-' + Date.now());
fs.mkdirSync(root, { recursive: true });

const port = '3290';
const origin = 'http://localhost:' + port;

const out = path.resolve('docs/ui-checks/2026-10-19-stories');
fs.mkdirSync(out, { recursive: true });

// Setup synthetic server fixture
const fixture = path.join(root, 'server.mjs');
fs.writeFileSync(fixture, `import {installAddressProvider} from ${JSON.stringify(pathToFileURL(path.resolve('tests/helpers/address-provider.mjs')).href)};installAddressProvider();await import(${JSON.stringify(pathToFileURL(path.resolve('server.mjs')).href)});\n`);

const child = spawn(process.execPath, [fixture], {
  env: {
    ...process.env,
    PORT: port,
    DATA_DIR: path.join(root, 'data'),
    APP_ORIGIN: origin,
    NODE_ENV: 'test',
    DADATA_API_KEY: 'synthetic-upload-provider',
    DADATA_SECRET_KEY: '',
    ADDRESS_DAILY_LIMIT: '9000',
    PROMOTIONS_ENABLED: '0'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let logs = '';
child.stdout.on('data', b => logs += b);
child.stderr.on('data', b => logs += b);

async function cleanup() {
  child.kill();
  await new Promise(r => child.once('exit', r));
  fs.rmSync(root, { recursive: true, force: true });
}

async function api(context, url, body, method = body === undefined ? 'GET' : 'POST', expected = 200) {
  const response = await context.request.fetch(origin + '/api' + url, {
    method,
    headers: { Origin: origin },
    ...(body === undefined ? {} : { data: body })
  });
  assert.equal(response.status(), expected, url + ' returned ' + response.status());
  return response.json();
}

async function checkOverflow(page, name) {
  const overflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
  assert.equal(overflow, 0, `${name} has horizontal overflow: ${overflow}px`);
}

async function run() {
  try {
    // Wait for server ready
    let ready = false;
    for (let n = 0; n < 100; n++) {
      if (child.exitCode !== null) throw Error('Fixture exited: ' + logs);
      try {
        if ((await fetch(origin + '/api/health')).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise(r => setTimeout(r, 100));
    }
    assert.ok(ready, 'Fixture did not start: ' + logs);
    console.log('Server started on ' + origin);

    // Create a synthetic story photo (vertical 9:16)
    const storyPhotoPath = path.join(root, 'test-story.jpg');
    const imageBuf = await sharp({
      create: { width: 540, height: 960, channels: 3, background: '#722F37' }
    }).jpeg().toBuffer();
    fs.writeFileSync(storyPhotoPath, imageBuf);

    const browser = await chromium.launch({ channel: 'chrome', headless: true });

    // Step 1: Register and setup a Master with a Service and Profile
    const masterContext = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    await api(masterContext, '/auth/register', {
      login: 'storymaster',
      password: 'MasterPassword123!',
      account_type: 'master'
    }, 'POST', 201);

    await api(masterContext, '/profile/address', { city: 'Новосибирск', address: 'Громова 21' }, 'PUT');
    await api(masterContext, '/profile', {
      name: 'Алина Морозова',
      slug: 'alina-beauty',
      categories: ['Макияж', 'Брови'],
      bio: 'Топ-визажист и бровист. Создаю образы для съемок и важных событий.',
      address_mode: 'preserve',
      published: false
    }, 'PUT');

    const svc = await api(masterContext, '/services', {
      name: 'Вечерний макияж и укладка',
      price: 4500,
      duration: 90,
      category: 'Макияж'
    }, 'POST', 201);
    console.log('Master registered with service ID:', svc.id);

    // Configure schedule
    await api(masterContext, '/schedule', {
      opening: 600,
      closing: 1200,
      utc_offset: 180,
      weekdays: [0, 1, 2, 3, 4, 5, 6]
    }, 'PUT');

    // Publish profile
    await api(masterContext, '/profile/publication', { published: true }, 'PATCH');
    console.log('Master profile published!');

    // Step 2: Open Master Studio and publish a Story
    const masterPage = await masterContext.newPage();
    await masterPage.goto(origin + '/v2/studio?tab=stories');
    await expect(masterPage.locator('.cabinet-stories-section')).toBeVisible();
    await checkOverflow(masterPage, 'Studio stories tab 1440px');

    // Click "Опубликовать историю"
    await masterPage.getByRole('button', { name: 'Опубликовать историю' }).click();
    await expect(masterPage.locator('.story-upload-form')).toBeVisible();

    // Fill upload form - test live preview
    const fileInput = masterPage.locator('.story-upload-form input[type=file]');
    await fileInput.setInputFiles(storyPhotoPath);
    await masterPage.locator('.story-form-textarea').fill('Окна на вечерний макияж со скидкой 15% ✨ Запись в один клик!');
    await masterPage.locator('.story-form-select').selectOption(svc.id);

    // Verify live preview overlay is visible in the 9:16 frame
    await expect(masterPage.locator('.story-preview-overlay')).toBeVisible();
    await expect(masterPage.locator('.story-preview-caption-text')).toContainText('Окна на вечерний макияж');
    await expect(masterPage.locator('.story-preview-cta-pill')).toBeVisible();

    await masterPage.screenshot({ path: path.join(out, '01-studio-stories-form-open-1440.png'), fullPage: true });

    // Click submit
    await masterPage.getByRole('button', { name: 'Опубликовать на 24 часа' }).click();
    await expect(masterPage.locator('.story-card')).toBeVisible();
    console.log('Story successfully published in Studio cabinet!');

    // Test editing the active story
    await masterPage.locator('.story-action-btn.edit').click();
    await expect(masterPage.locator('.story-form-header h3')).toContainText('Настройки активной истории');
    await masterPage.locator('.story-form-textarea').fill('Обновленный текст: Последнее окно на сегодня!');
    await masterPage.screenshot({ path: path.join(out, '01-studio-stories-form-edit-1440.png'), fullPage: true });
    await masterPage.getByRole('button', { name: 'Сохранить изменения' }).click();
    await expect(masterPage.locator('.story-card-caption')).toContainText('Обновленный текст: Последнее окно на сегодня!');
    console.log('Story edit successfully tested!');

    // Revert text back with service for catalog/viewer test
    await masterPage.locator('.story-action-btn.edit').click();
    await masterPage.locator('.story-form-textarea').fill('Окна на вечерний макияж со скидкой 15% ✨ Запись в один клик!');
    await masterPage.locator('.story-form-select').selectOption(svc.id);
    await masterPage.getByRole('button', { name: 'Сохранить изменения' }).click();

    // Test author preview from cabinet
    await masterPage.locator('.story-card-preview-trigger').click();
    await expect(masterPage.locator('.story-viewer-overlay')).toBeVisible();
    await masterPage.keyboard.press('Escape');
    await expect(masterPage.locator('.story-viewer-overlay')).toHaveCount(0);

    await masterPage.screenshot({ path: path.join(out, '01-studio-stories-cabinet-1440.png'), fullPage: true });

    // Step 3: Verify Catalog View as a Client / Visitor across screen widths
    const widths = [1440, 390, 320];
    for (const width of widths) {
      const visitorContext = await browser.newContext({
        viewport: { width, height: width === 1440 ? 900 : 844 }
      });
      const visitorPage = await visitorContext.newPage();

      // Go to /v2/masters
      await visitorPage.goto(origin + '/v2/masters');
      await expect(visitorPage.locator('.stories-feed-bar')).toBeVisible();
      await checkOverflow(visitorPage, `Catalog with Stories ${width}px`);

      // Verify author avatar ring in the Stories feed bar
      const feedAuthor = visitorPage.locator('.stories-feed-item');
      await expect(feedAuthor.first()).toContainText('Алина Морозова');
      await expect(feedAuthor.first().locator('.story-avatar-ring')).toBeVisible();

      // Verify card avatar has story ring
      const card = visitorPage.locator('.compact-master-card').first();
      await expect(card.locator('.story-avatar-ring')).toBeVisible();

      await visitorPage.screenshot({ path: path.join(out, `02-catalog-stories-feed-${width}.png`) });

      // Click story in the feed to open StoryViewer
      await feedAuthor.first().click();
      await expect(visitorPage.locator('.story-viewer-overlay')).toBeVisible();
      await visitorPage.waitForTimeout(250);
      await checkOverflow(visitorPage, `StoryViewer open ${width}px`);

      // Verify StoryViewer elements
      await expect(visitorPage.locator('.story-header-name')).toContainText('Алина Морозова');
      await expect(visitorPage.locator('.story-caption-card')).toContainText('Окна на вечерний макияж');
      await expect(visitorPage.locator('.story-progress-segment')).toBeVisible();
      const ctaBtn = visitorPage.locator('.story-cta-button');
      await expect(ctaBtn).toBeVisible();
      await expect(ctaBtn).toContainText('Вечерний макияж и укладка');
      await expect(ctaBtn).toContainText('4 500 ₽');

      await visitorPage.screenshot({ path: path.join(out, `03-story-viewer-modal-${width}.png`) });

      // Test close button
      await visitorPage.locator('.story-close-button').click();
      await expect(visitorPage.locator('.story-viewer-overlay')).toHaveCount(0);

      // Click avatar on the catalog card directly
      await card.locator('.story-avatar-ring').click();
      await expect(visitorPage.locator('.story-viewer-overlay')).toBeVisible();

      // Test keyboard navigation: press Escape to close
      await visitorPage.keyboard.press('Escape');
      await expect(visitorPage.locator('.story-viewer-overlay')).toHaveCount(0);

      // Step 4: Visit Public Master Profile (/v2/m/alina-beauty)
      await visitorPage.goto(origin + '/v2/m/alina-beauty');
      await expect(visitorPage.locator('.public-identity')).toBeVisible();
      await checkOverflow(visitorPage, `Public master profile ${width}px`);

      // Verify profile header avatar has the story ring class directly on .public-avatar
      const profileAvatar = visitorPage.locator('.public-identity .public-avatar.public-avatar-has-story');
      await expect(profileAvatar).toBeVisible();

      // Check avatar dimensions - must NOT be shrunken (should be >= 140px on desktop)
      const box = await profileAvatar.boundingBox();
      assert.ok(box && box.width >= (width === 1440 ? 140 : 80), `Avatar width must be full size, got: ${box?.width}`);

      await visitorPage.screenshot({ path: path.join(out, `04-public-profile-${width}.png`) });

      // Click avatar to open story
      await profileAvatar.click();
      await expect(visitorPage.locator('.story-viewer-overlay')).toBeVisible();

      // Click Direct Booking CTA button and verify navigation to booking
      await visitorPage.locator('.story-cta-button').click();
      await expect(visitorPage).toHaveURL(new RegExp(`/book/alina-beauty\\?service=${svc.id}`));
      console.log(`Verified StoryViewer Direct CTA booking navigation at ${width}px!`);

      await visitorContext.close();
    }

    // Step 5: Test Delete Story in Studio
    await masterPage.bringToFront();
    // Handle dialog
    masterPage.on('dialog', d => d.accept());
    await masterPage.locator('.story-action-btn.delete').click();
    await expect(masterPage.locator('.story-card')).toHaveCount(0);
    console.log('Story deleted successfully!');

    // Verify catalog no longer shows active stories feed
    const verifyContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const verifyPage = await verifyContext.newPage();
    await verifyPage.goto(origin + '/v2/masters');
    await expect(verifyPage.locator('.stories-feed-bar')).toHaveCount(0);
    console.log('Stories feed bar cleanly disappears when no active stories exist!');

    await browser.close();
    console.log('ALL STORIES VERIFICATION CHECKS PASSED!');
  } finally {
    await cleanup();
  }
}

run().catch(err => {
  console.error('Verification failed:', err);
  process.exit(1);
});
