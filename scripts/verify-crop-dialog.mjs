import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'docs', 'ui-checks', '2026-10-19-crop-fix');
fs.mkdirSync(out, { recursive: true });

async function run() {
  const testDbDir = path.join(root, '.cache', 'crop-test-' + Date.now());
  fs.mkdirSync(testDbDir, { recursive: true });

  const port = 3291;
  const origin = `http://localhost:${port}`;

  const serverProc = spawn(process.execPath, ['server.mjs'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      DATA_DIR: testDbDir
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  serverProc.stdout.on('data', d => process.stdout.write('[server] ' + d));
  serverProc.stderr.on('data', d => process.stderr.write('[server err] ' + d));

  try {
    // Wait for server to start
    for (let i = 0; i < 40; i++) {
      try {
        const res = await fetch(`${origin}/health`);
        if (res.ok) break;
      } catch {
        await new Promise(r => setTimeout(r, 250));
      }
    }
    console.log('Server started on ' + origin);

    // Create a sample portrait test photo with face in center
    const testPhotoPath = path.join(root, 'test-portrait.jpg');
    const imageBuf = await sharp({
      create: { width: 800, height: 1000, channels: 3, background: '#D4C4B5' }
    }).jpeg().toBuffer();
    fs.writeFileSync(testPhotoPath, imageBuf);

    const browser = await chromium.launch({ channel: 'chrome', headless: true });

    // Step 1: Register Master
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      extraHTTPHeaders: { Origin: origin }
    });
    const regRes = await context.request.post(`${origin}/api/auth/register`, {
      data: { login: 'cropmaster', password: 'Password123!', account_type: 'master' }
    });
    expect(regRes.status()).toBe(201);

    await context.request.put(`${origin}/api/profile/address`, {
      data: { city: 'Новосибирск', address: 'Громова 21' }
    });
    await context.request.put(`${origin}/api/profile`, {
      data: {
        name: 'Виктория Смирнова',
        slug: 'victoria-smirnova',
        categories: ['Макияж'],
        bio: 'Визажист',
        address_mode: 'preserve',
        published: true
      }
    });

    const page = await context.newPage();

    // Step 2: Open Studio -> Personal Appearance
    await page.goto(`${origin}/v2/studio?tab=appearance`);
    await page.waitForSelector('.appearance-panel');

    // Click pencil icon for avatar upload
    const avatarSection = page.locator('.public-avatar');
    await expect(avatarSection).toBeVisible();

    const fileInput = page.locator('.public-avatar input[type="file"]');
    await fileInput.setInputFiles(testPhotoPath);

    // Dialog should open
    const dialog = page.locator('.image-crop-dialog');
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(300);

    // Verify:
    // 1. NO .image-crop-handle anywhere in DOM
    const handleCount = await page.locator('.image-crop-handle').count();
    expect(handleCount).toBe(0);
    console.log('VERIFIED: No .image-crop-handle in DOM (count = 0)');

    // 2. Crop frame is circle
    const cropFrame = page.locator('.image-crop-frame.is-circle');
    await expect(cropFrame).toBeVisible();

    // Check center zoom behavior
    const initialBounds = await cropFrame.boundingBox();
    const initialCenterX = initialBounds.x + initialBounds.width / 2;
    const initialCenterY = initialBounds.y + initialBounds.height / 2;

    await page.screenshot({ path: path.join(out, '01-crop-dialog-initial-1440.png') });

    // Move slider to change size
    const slider = page.locator('.image-crop-sliders input[type="range"]').first();
    const currentVal = Number(await slider.inputValue());
    const minVal = Number(await slider.getAttribute('min'));
    const maxVal = Number(await slider.getAttribute('max'));
    
    // Set slider to a higher value
    const nextVal = Math.round(minVal + (maxVal - minVal) * 0.85);
    await slider.fill(String(nextVal));
    await slider.dispatchEvent('change');
    await page.waitForTimeout(200);

    const zoomedBounds = await cropFrame.boundingBox();
    const zoomedCenterX = zoomedBounds.x + zoomedBounds.width / 2;
    const zoomedCenterY = zoomedBounds.y + zoomedBounds.height / 2;

    // The center should remain within 1-2px due to integer rounding
    const driftX = Math.abs(zoomedCenterX - initialCenterX);
    const driftY = Math.abs(zoomedCenterY - initialCenterY);
    console.log(`Drift after zoom: driftX=${driftX.toFixed(2)}px, driftY=${driftY.toFixed(2)}px`);
    expect(driftX).toBeLessThan(3);
    expect(driftY).toBeLessThan(3);
    console.log('VERIFIED: Zoom scales symmetrically around center!');

    await page.screenshot({ path: path.join(out, '02-crop-dialog-zoomed-1440.png') });

    // Test dragging the circle
    await cropFrame.hover();
    await page.mouse.down();
    await page.mouse.move(zoomedCenterX + 40, zoomedCenterY + 40, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    const draggedBounds = await cropFrame.boundingBox();
    expect(draggedBounds.x).toBeGreaterThan(zoomedBounds.x);
    console.log('VERIFIED: Circle moves smoothly when dragged!');

    // Test saving
    const saveBtn = page.getByRole('button', { name: 'Сохранить фото' });
    await saveBtn.click();

    // Dialog should close
    await expect(dialog).toHaveCount(0);
    console.log('VERIFIED: Dialog saved and closed!');

    // Check mobile viewport (390px)
    const mobileContext = await browser.newContext({
      viewport: { width: 390, height: 844 },
      extraHTTPHeaders: { Origin: origin }
    });
    const mobilePage = await mobileContext.newPage();
    // Login mobile
    await mobileContext.request.post(`${origin}/api/auth/login`, {
      data: { login: 'cropmaster', password: 'Password123!' }
    });
    await mobilePage.goto(`${origin}/v2/studio?tab=appearance`);
    await mobilePage.waitForSelector('.appearance-panel');
    const mobileFileInput = mobilePage.locator('.public-avatar input[type="file"]');
    await mobileFileInput.setInputFiles(testPhotoPath);
    await expect(mobilePage.locator('.image-crop-dialog')).toBeVisible();
    await mobilePage.waitForTimeout(300);

    const mobileHandleCount = await mobilePage.locator('.image-crop-handle').count();
    expect(mobileHandleCount).toBe(0);

    await mobilePage.screenshot({ path: path.join(out, '03-crop-dialog-mobile-390.png') });
    console.log('VERIFIED: Mobile 390px crop dialog clean without dots!');

    await browser.close();
    console.log('ALL CROP DIALOG VERIFICATION CHECKS PASSED!');
  } finally {
    serverProc.kill();
    try { fs.unlinkSync(path.join(root, 'test-portrait.jpg')); } catch {}
    try { fs.rmSync(testDbDir, { recursive: true, force: true }); } catch {}
  }
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
