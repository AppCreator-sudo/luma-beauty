// Short, read-only production smoke. Run only after the authorized release.
// No account, session, form submission, upload, clipboard or service-worker install.
import { chromium, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const origin = 'https://atelie-13-143-66-1.sslip.io';
const expectedEntry = 'index-D4kBlu6Z.js';
const expectedTag = '20261018-v2-auth-upload-stability';
const out = path.resolve('docs/ui-checks/2026-10-18-auth-upload-release');
const viewports = [{ width: 1366, height: 620 }, { width: 390, height: 844 }];
const checks = [], layouts = [], screenshots = [], pageErrors = [];
const accounting = { attemptedWriteRequests: 0, blockedWriteRequests: 0, forwardedWriteRequests: 0, forwardedReadRequests: 0, blockedExternalRequests: 0 };
let browser, context, page, phase = 'configuration', browserClosed = false, cookiesCleared = false;

function report() {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'browser-report.json'), JSON.stringify({
    at: new Date().toISOString(), origin, expectedEntry, expectedTag, viewports,
    scope: 'Read-only deployed auth layout smoke. Only same-origin GET/HEAD requests are forwarded; no registration, login, account/session creation, clipboard access or production business writes.',
    checks, layouts, screenshots, pageErrors, accounting, cookiesCleared, browserClosed,
    passed: checks.length > 0 && checks.every(check => check.pass) && browserClosed,
  }, null, 2) + '\n');
}
function pass(name) { checks.push({ name, pass: true }); report(); console.log('PASS ' + name); }
function near(actual, expected, name) { assert.ok(Math.abs(actual - expected) <= 0.6, name + ': ' + actual + ' vs ' + expected); }
function sameRect(before, after, name) { for (const key of ['x', 'y', 'width', 'height']) near(after[key], before[key], name + '.' + key); }
async function settled() {
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function geometry(name) {
  await settled();
  const value = await page.evaluate(() => {
    const rect = selector => {
      const node = document.querySelector(selector);
      if (!node) throw new Error('Required auth layout node missing');
      const box = node.getBoundingClientRect();
      return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height };
    };
    const art = getComputedStyle(document.querySelector('.auth-art'));
    return {
      intro: rect('.auth-intro'), title: rect('.auth-intro-title[aria-hidden="false"]'),
      description: rect('.auth-intro-description[aria-hidden="false"]'), tabs: rect('.auth-tabs'),
      art: rect('.auth-art'), artTitle: rect('.auth-art h2'), providers: rect('.auth-provider-placeholders'),
      form: rect('.auth-form'), roles: rect('.auth-role-slot'),
      documentHeight: document.documentElement.scrollHeight,
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), scrollY,
      backgroundSize: art.backgroundSize, backgroundPosition: art.backgroundPosition,
    };
  });
  assert.equal(value.overflow, 0, 'Horizontal overflow');
  near(value.scrollY, 0, 'Tab switch scroll position');
  layouts.push({ name, ...value });
  return value;
}
async function capture(name) {
  const controls = await page.locator('.auth-tabs button,.auth-form input,.auth-form button,.auth-role-slot[aria-hidden="false"] button').evaluateAll(nodes => nodes.map(node => {
    const box = node.getBoundingClientRect();
    return { width: box.width, height: box.height };
  }));
  assert.ok(controls.every(box => box.width >= 44 && box.height >= 44), 'Auth control below 44 px');
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true });
  screenshots.push(name + '.png');
  pass(name + '-screenshot-no-overflow-touch-targets');
}
function stableTop(before, after, prefix) {
  for (const key of ['intro', 'title', 'description', 'tabs', 'art', 'artTitle']) sameRect(before[key], after[key], prefix + '.' + key);
  assert.equal(after.backgroundSize, before.backgroundSize, 'Auth ornament background size changed');
  assert.equal(after.backgroundPosition, before.backgroundPosition, 'Auth ornament background position changed');
}

try {
  fs.mkdirSync(out, { recursive: true });
  phase = 'browser-start';
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  context = await browser.newContext({ serviceWorkers: 'block', viewport: viewports[0] });
  context.on('request', request => { if (!['GET', 'HEAD'].includes(request.method())) accounting.attemptedWriteRequests++; });
  context.on('response', response => { if (!['GET', 'HEAD'].includes(response.request().method())) accounting.forwardedWriteRequests++; });
  await context.route('**/*', route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin) { accounting.blockedExternalRequests++; return route.abort('blockedbyclient'); }
    if (!['GET', 'HEAD'].includes(request.method())) { accounting.blockedWriteRequests++; return route.abort('blockedbyclient'); }
    accounting.forwardedReadRequests++;
    return route.continue();
  });
  page = await context.newPage();
  page.on('pageerror', error => pageErrors.push({ phase, type: error.name || 'Error' }));

  for (const viewport of viewports) {
    const size = viewport.width + 'x' + viewport.height;
    phase = 'auth-login-' + size;
    await page.setViewportSize(viewport);
    await page.goto(origin + '/v2/auth');
    await expect(page.locator('.auth-entry')).toBeVisible();
    await expect(page.locator('.auth-tabs button.active')).toHaveText('Войти');
    await page.evaluate(() => scrollTo(0, 0));
    const login = await geometry('login-' + size);
    await capture('auth-login-' + size);

    if (viewport.width === 1366) {
      phase = 'deployed-assets';
      const entries = await page.locator('script[type="module"][src]').evaluateAll(nodes => nodes.map(node => new URL(node.src).pathname));
      assert.ok(entries.includes('/v2/assets/' + expectedEntry), 'Unexpected deployed entry');
      const assets = await page.evaluate(async ({ expectedEntry, expectedTag }) => {
        const sw = await fetch('/sw.js', { cache: 'no-store' });
        const swText = await sw.text();
        const entry = await fetch('/v2/assets/' + expectedEntry, { cache: 'no-store' });
        const entryBytes = (await entry.arrayBuffer()).byteLength;
        return { swStatus: sw.status, swTagMatches: swText.includes('luma-v2-shell-' + expectedTag), entryStatus: entry.status, entryBytes, entryContentType: entry.headers.get('content-type') || '' };
      }, { expectedEntry, expectedTag });
      assert.equal(assets.swStatus, 200); assert.equal(assets.swTagMatches, true);
      assert.equal(assets.entryStatus, 200); assert.ok(assets.entryBytes > 0); assert.match(assets.entryContentType, /javascript/);
      pass('deployed-entry-http200-and-service-worker-tag');
    }

    phase = 'auth-register-' + size;
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect(page.locator('.auth-tabs button.active')).toHaveText('Создать аккаунт');
    await expect.poll(async () => page.locator('.auth-role-slot').evaluate(node => Math.round(node.getBoundingClientRect().height))).toBe(viewport.width > 760 ? 48 : 160);
    // Finish the 180 ms mobile transition before comparing the final positions.
    await expect.poll(async () => Number.parseFloat(await page.locator('.auth-role-slot').evaluate(node => getComputedStyle(node).marginBottom))).toBe(20);
    await page.locator('.auth-role-slot').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    const register = await geometry('register-' + size);
    stableTop(login, register, size);
    if (viewport.width > 760) {
      sameRect(login.providers, register.providers, size + '.providers');
      sameRect(login.form, register.form, size + '.form');
      near(register.documentHeight, login.documentHeight, size + '.documentHeight');
      pass('desktop-shared-layout-and-document-height-stable');
    } else {
      near(register.providers.y - login.providers.y, 180, size + '.providers-role-expansion');
      near(register.form.y - login.form.y, 180, size + '.form-role-expansion');
      near(login.roles.height, 0, size + '.login-no-empty-role-slot');
      pass('mobile-top-stable-only-180px-role-expansion-below-tabs');
    }
    await capture('auth-register-' + size);

    phase = 'auth-return-login-' + size;
    await page.getByRole('button', { name: 'Войти', exact: true }).first().click();
    await expect(page.locator('.auth-tabs button.active')).toHaveText('Войти');
    if (viewport.width <= 760) {
      await expect.poll(async () => page.locator('.auth-role-slot').evaluate(node => node.getBoundingClientRect().height)).toBe(0);
      await page.locator('.auth-role-slot').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => {}))); });
    }
    const returned = await geometry('returned-login-' + size);
    stableTop(login, returned, size + '.returned');
    sameRect(login.providers, returned.providers, size + '.returned.providers');
    sameRect(login.form, returned.form, size + '.returned.form');
    near(returned.documentHeight, login.documentHeight, size + '.returned.documentHeight');
    pass('return-to-login-restores-layout-' + size);
  }
  assert.deepEqual(pageErrors, [], 'Unhandled JavaScript page errors');
  pass('no-unhandled-javascript-page-errors');
  assert.equal(accounting.attemptedWriteRequests, 0, 'Unexpected write request attempted');
  assert.equal(accounting.blockedWriteRequests, 0); assert.equal(accounting.forwardedWriteRequests, 0);
  pass('production-write-requests-zero');
} catch (error) {
  checks.push({ name: phase, pass: false, message: error instanceof Error ? error.message.split('\n')[0] : 'Verification failed' });
  report(); console.error('FAIL ' + phase); process.exitCode = 1;
} finally {
  try {
    if (context) {
      try { await context.clearCookies(); cookiesCleared = (await context.cookies()).length === 0; }
      finally { await context.close(); }
    }
  } finally {
    try { if (browser) { await browser.close(); browserClosed = true; } }
    finally { report(); console.log('Read-only browser cleanup complete; browser-report.json saved.'); }
  }
}
