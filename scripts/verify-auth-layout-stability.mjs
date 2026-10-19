// BUG-018: authentication mode layout acceptance. Fresh local SQLite, no account writes.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const before = process.env.AUTH_LAYOUT_BEFORE === '1';
const port = String(process.env.LUMA_AUTH_LAYOUT_PORT || '3270');
assert.match(port, /^\d+$/); assert.ok(+port >= 1024 && +port <= 65535);
const origin = 'http://localhost:' + port;
const fixture = path.resolve('.cache/auth-layout-' + Date.now());
assert.ok(fixture.startsWith(path.resolve('.cache') + path.sep)); fs.mkdirSync(fixture, { recursive: true });
const out = path.resolve('docs/ui-checks/2026-10-18-auth-stability', before ? 'before' : 'after');
const frontendEntry = fs.readFileSync(path.resolve('public/v2/index.html'), 'utf8').match(/index-[A-Za-z0-9_-]+\.js/)?.[0];
fs.mkdirSync(out, { recursive: true });
try { await fetch(origin + '/api/health'); throw Error('Auth acceptance port is already in use'); }
catch (error) { if (error.message === 'Auth acceptance port is already in use') throw error; }
const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: port, DATA_DIR: path.join(fixture, 'data'), APP_ORIGIN: origin, NODE_ENV: 'test', DADATA_API_KEY: '', DADATA_SECRET_KEY: '', PROMOTIONS_ENABLED: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '', browser, fixtureStopped = false, current = 'startup';
child.stdout.on('data', value => logs += value); child.stderr.on('data', value => logs += value);
const viewports = [{ width: 1440, height: 900 }, { width: 1366, height: 620 }, { width: 390, height: 844 }, { width: 320, height: 740 }, { width: 390, height: 600 }];
const checks = [], measurements = [], pageErrors = [], requests = [], mockSubmissions = [];
function report() {
  const data = JSON.stringify({ at: new Date().toISOString(), task: 'BUG-018', mode: before ? 'before-fix evidence' : 'after-fix acceptance', scope: 'Local isolated data; auth mode layout; recovery/signed-in UI use browser-only mocks; clipboard.writeText stubbed in browser; no actual registration/login submissions or production access', frontendEntry, origin, fixtureStopped, viewports, checks, measurements, pageErrors, blockedWrites: requests, mockSubmissions }, null, 2) + '\n';
  for (let attempt = 0; ; attempt++) try { fs.writeFileSync(path.join(out, 'report.json'), data); return; } catch (error) { if (attempt >= 2 || !['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES'].includes(error.code)) throw error; Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); }
}
function pass(name) { checks.push({ name, pass: true }); report(); console.log('PASS ' + name); }
async function stable(page) { await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); }); }
async function measure(page, label) {
  await stable(page);
  const data = await page.evaluate(() => {
    const selectors = { art: '.auth-art', artHeading: '.auth-art h2', artEyebrow: '.auth-art>.eyebrow', artEnd: '.auth-art-end', side: '.auth-side', card: '.auth-card', heading: '.auth-intro-options, .auth-card h1', subtitle: '.auth-intro, .auth-card h1 + p', tabs: '.auth-tabs', providers: '.auth-provider-placeholders', providerNote: '.auth-provider-note', credentialsLabel: '.auth-legacy-label', login: '.auth-form>label:first-child input', password: '.password-field input', passwordToggle: '.password-field button', submit: '.auth-form>.button', note: '.auth-note' };
    const rect = node => { if (!node) return null; const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, display: s.display }; };
    const artStyle = getComputedStyle(document.querySelector('.auth-art'));
    const slot = document.querySelector('.auth-role-slot') || document.querySelector('.role-picker');
    const slotStyle = slot && getComputedStyle(slot);
    const roleSpace = slot ? slot.getBoundingClientRect().height + parseFloat(slotStyle.marginTop) + parseFloat(slotStyle.marginBottom) : 0;
    return { scrollY, scrollX, documentHeight: document.documentElement.scrollHeight, documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, viewportHeight: innerHeight, roleSpace, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), anchors: Object.fromEntries(Object.entries(selectors).map(([key, selector]) => [key, rect(document.querySelector(selector))])), modeContent: { title: rect(document.querySelector('.auth-intro-title[aria-hidden="false"]')), copy: rect(document.querySelector('.auth-intro-description[aria-hidden="false"]')) }, artBackground: { image: artStyle.backgroundImage, size: artStyle.backgroundSize, position: artStyle.backgroundPosition } };
  });
  measurements.push({ label, ...data }); report(); return data;
}
function compare(a, b, label, { scroll = false } = {}) {
  const deltas = [], unexpectedDeltas = [];
  const expectedRoleDelta = !before && a.viewportWidth <= 760 ? b.roleSpace - a.roleSpace : 0;
  const belowRoles = ['providers', 'providerNote', 'credentialsLabel', 'login', 'password', 'passwordToggle', 'submit', 'note'];
  for (const [name, rect] of Object.entries(a.anchors)) {
    const next = b.anchors[name]; if (!rect || !next || rect.display === 'none' || next.display === 'none') continue;
    for (const axis of ['x', 'y', 'width', 'height']) {
      const delta = +(next[axis] - rect[axis]).toFixed(3);
      const expected = (axis === 'y' && belowRoles.includes(name)) || (axis === 'height' && ['side', 'card'].includes(name)) ? expectedRoleDelta : 0;
      if (Math.abs(delta) > 1) deltas.push({ anchor: name, axis, delta, expected });
      if (Math.abs(delta - expected) > 1) unexpectedDeltas.push({ anchor: name, axis, delta, expected });
    }
  }
  const documentDelta = b.documentHeight - a.documentHeight;
  if (documentDelta) deltas.push({ anchor: 'document', axis: 'height', delta: documentDelta, expected: expectedRoleDelta });
  if (Math.abs(documentDelta - expectedRoleDelta) > 1) unexpectedDeltas.push({ anchor: 'document', axis: 'height', delta: documentDelta, expected: expectedRoleDelta });
  if (scroll && Math.abs(a.scrollY - b.scrollY) > 1) unexpectedDeltas.push({ anchor: 'viewport', axis: 'scrollY', delta: b.scrollY - a.scrollY, expected: 0 });
  assert.deepEqual(a.artBackground, b.artBackground, label + ' ornament CSS unchanged');
  if (!before) for (const text of ['title', 'copy']) { assert.ok(a.modeContent[text] && b.modeContent[text], label + ' active ' + text + ' measurable'); for (const axis of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a.modeContent[text][axis] - b.modeContent[text][axis]) <= 1, label + ' active ' + text + ' ' + axis + ' fixed'); }
  measurements.push({ label: label + '-deltas', expectedRoleDelta, deltas, unexpectedDeltas }); report();
  if (before) { pass(label + '-recorded-' + deltas.length + '-layout-deltas'); return; }
  assert.deepEqual(unexpectedDeltas, [], label + ' shared geometry follows the scoped invariants'); pass(label + (expectedRoleDelta ? '-mobile-only-role-slot-expansion-' + expectedRoleDelta : '-shared-geometry-stable'));
}
async function snapshot(page, label) { await stable(page); await page.screenshot({ path: path.join(out, label + '.png'), fullPage: true }); }
async function switchMode(page, mode, native = false) { const tab = page.locator('.auth-tabs').getByRole('button', { name: mode === 'login' ? 'Войти' : 'Создать аккаунт', exact: true }); if (native) await tab.click(); else await tab.evaluate(node => node.click()); await expect(tab).toHaveClass(/active/); await stable(page); }
try {
  let ready = false;
  for (let n = 0; n < 100; n++) { if (child.exitCode !== null) throw Error('Fixture exited: ' + logs); try { if ((await fetch(origin + '/api/health')).ok) { ready = true; break; } } catch {} await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.ok(ready, 'Fixture did not start: ' + logs);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  for (const viewport of viewports) {
    const label = viewport.width + 'x' + viewport.height; current = label;
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
    await context.route('**/*', route => { const request = route.request(); if (!request.url().startsWith(origin + '/')) return route.abort(); if (!['GET', 'HEAD'].includes(request.method())) { requests.push({ method: request.method(), pathname: new URL(request.url()).pathname }); return route.abort(); } return route.continue(); });
    const page = await context.newPage(); page.on('pageerror', error => pageErrors.push({ viewport: label, message: error.message }));
    await page.goto(origin + '/v2/auth'); await expect(page.locator('.auth-tabs')).toBeVisible();
    const login = await measure(page, 'login-' + label); await snapshot(page, 'login-' + label);
    await switchMode(page, 'register'); const register = await measure(page, 'register-' + label); await snapshot(page, 'register-' + label); compare(login, register, 'login-register-' + label);
    assert.equal(register.overflow, 0); assert.equal(login.overflow, 0); pass('both-modes-no-horizontal-overflow-' + label);
    if (!before) {
      const controls = await page.locator('.auth-tabs button,.role-picker button,.auth-form input,.auth-form button').evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => ({ label: node.getAttribute('aria-label') || node.textContent?.trim() || node.getAttribute('placeholder'), width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      assert.ok(controls.length >= 9); assert.ok(controls.every(item => item.width >= 44 && item.height >= 44)); measurements.push({ label: 'controls-' + label, controls }); pass('auth-controls-at-least-44px-' + label);
      if (label === '1440x900' || label === '390x844') {
        await page.locator('.auth-tabs').getByRole('button', { name: 'Создать аккаунт', exact: true }).focus(); await page.keyboard.press('Tab');
        const firstRole = page.getByRole('button', { name: 'Я клиент', exact: true }); await expect(firstRole).toBeFocused(); await stable(page);
        const focus = await firstRole.evaluate(node => { const style = getComputedStyle(node), rect = node.getBoundingClientRect(); return { focusVisible: node.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineColor: style.outlineColor, outlineWidth: parseFloat(style.outlineWidth), outlineOffset: parseFloat(style.outlineOffset), width: rect.width, height: rect.height }; });
        measurements.push({ label: 'role-keyboard-focus-' + label, focus }); report(); await snapshot(page, 'role-keyboard-focus-' + label);
        assert.ok(focus.focusVisible); assert.notEqual(focus.outlineStyle, 'none'); assert.notEqual(focus.outlineColor, 'transparent'); assert.ok(focus.outlineWidth >= 2); assert.ok(focus.outlineOffset + focus.outlineWidth <= 0, 'Keyboard outline lies inside the clipped role container: ' + JSON.stringify(focus)); pass('role-keyboard-inset-outline-unclipped-' + label);
      }
      for (const role of ['Я клиент', 'Я мастер', 'Мы салон']) { await page.getByRole('group', { name: 'Тип аккаунта' }).getByRole('button', { name: role, exact: true }).click(); await expect(page.getByRole('button', { name: role, exact: true })).toHaveAttribute('aria-pressed', 'true'); const selected = await page.locator('.role-picker button[aria-pressed="true"]').count(); assert.equal(selected, 1); } pass('all-three-existing-roles-selectable-' + label);
      await page.locator('.auth-form>label:first-child input').fill('synthetic-layout-only'); await page.locator('.password-field input').fill('SyntheticLayoutOnly123');
      await page.getByRole('button', { name: 'Показать пароль', exact: true }).click(); await expect(page.locator('.password-field input')).toHaveAttribute('type', 'text');
      await page.locator('.auth-tabs').scrollIntoViewIfNeeded(); const scrolled = await measure(page, 'register-scrolled-' + label);
      await switchMode(page, 'login', true); const switched = await measure(page, 'login-scrolled-' + label); compare(scrolled, switched, 'native-click-register-login-' + label, { scroll: true });
      await expect(page.getByRole('group', { name: 'Тип аккаунта' })).toHaveCount(0);
      for (const role of ['Я клиент', 'Я мастер', 'Мы салон']) await expect(page.getByRole('button', { name: role, exact: true })).toHaveCount(0);
      const focusedRoles = [];
      await page.locator('.auth-tabs').getByRole('button', { name: 'Создать аккаунт', exact: true }).focus();
      for (let n = 0; n < 4; n++) { await page.keyboard.press('Tab'); focusedRoles.push(await page.evaluate(() => document.activeElement?.textContent?.trim())); }
      assert.ok(!focusedRoles.some(text => ['Я клиент', 'Я мастер', 'Мы салон'].includes(text))); pass('login-role-controls-absent-from-accessibility-and-keyboard-' + label);
      await expect(page.locator('.auth-form>label:first-child input')).toHaveValue('synthetic-layout-only'); await expect(page.locator('.password-field input')).toHaveValue('SyntheticLayoutOnly123'); await expect(page.locator('.password-field input')).toHaveAttribute('type', 'text'); await expect(page.locator('.password-field input')).toHaveAttribute('autocomplete', 'current-password');
      await page.getByRole('button', { name: 'Скрыть пароль', exact: true }).click(); await expect(page.locator('.password-field input')).toHaveAttribute('type', 'password'); pass('typed-fields-and-password-visibility-preserved-across-mode-' + label);
      for (let n = 0; n < 3; n++) { await switchMode(page, 'register'); compare(register, await measure(page, 'repeated-register-' + n + '-' + label), 'repeated-register-' + n + '-' + label); await switchMode(page, 'login'); compare(login, await measure(page, 'repeated-login-' + n + '-' + label), 'repeated-login-' + n + '-' + label); }
      await switchMode(page, 'register'); await expect(page.locator('.password-field input')).toHaveAttribute('autocomplete', 'new-password'); await expect(page.getByRole('button', { name: 'Мы салон', exact: true })).toHaveAttribute('aria-pressed', 'true');
      await page.goBack(); await expect(page.locator('.auth-tabs button.active')).toHaveText('Войти'); compare(login, await measure(page, 'back-login-' + label), 'history-back-login-' + label); await page.goForward(); await expect(page.locator('.auth-tabs button.active')).toHaveText('Создать аккаунт'); compare(register, await measure(page, 'forward-register-' + label), 'history-forward-register-' + label); pass('browser-back-forward-mode-role-input-preserved-' + label);
      await page.emulateMedia({ reducedMotion: 'no-preference' }); await switchMode(page, 'login'); await page.waitForTimeout(250); const motionLogin = await measure(page, 'motion-login-' + label); await switchMode(page, 'register'); await page.waitForTimeout(250); compare(motionLogin, await measure(page, 'motion-register-' + label), 'default-motion-switch-' + label); await page.emulateMedia({ reducedMotion: 'reduce' });
    } else { await switchMode(page, 'login'); compare(login, await measure(page, 'return-login-' + label), 'return-login-' + label); }
    await context.close();
  }
  if (!before) for (const viewport of [viewports[0], viewports[3]]) {
    const label = viewport.width + 'x' + viewport.height;
    for (const branch of ['error', 'signed-in', 'recovery']) {
      current = branch + '-' + label; let signedIn = branch === 'signed-in', submissions = 0;
      const context = await browser.newContext({ viewport, reducedMotion: 'reduce', serviceWorkers: 'block' });
      if (branch === 'recovery') await context.addInitScript(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__authLayoutCopied = text; } } }); });
      await context.route('**/*', route => {
        const request = route.request(), url = new URL(request.url());
        if (!request.url().startsWith(origin + '/')) return route.abort();
        if (url.pathname === '/api/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: signedIn ? { id: 'synthetic-layout-only', login: 'synthetic-layout-only', account_type: 'client' } : null, profile: null, workspaces: [], providers: { yandex: false, vk: false, telegram: false } }) });
        if (branch === 'recovery' && url.pathname === '/api/auth/register' && request.method() === 'POST') { submissions++; signedIn = true; mockSubmissions.push({ viewport: label, pathname: url.pathname, forwarded: false }); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ recovery: 'SYNTHETIC-RECOVERY-CODE' }) }); }
        if (!['GET', 'HEAD'].includes(request.method())) { requests.push({ method: request.method(), pathname: url.pathname }); return route.abort(); }
        return route.continue();
      });
      const page = await context.newPage(); page.on('pageerror', error => pageErrors.push({ viewport: label, branch, message: error.message }));
      await page.goto(origin + '/v2/auth' + (branch === 'error' ? '?auth_error=provider' : ''));
      if (branch === 'signed-in') { await expect(page.locator('.auth-signed-in')).toBeVisible(); await expect(page.getByRole('link', { name: 'Открыть кабинет', exact: true })).toHaveAttribute('href', '/v2/me'); await expect(page.locator('.auth-tabs,.auth-role-slot')).toHaveCount(0); }
      if (branch === 'error') { await expect(page.getByRole('alert')).toContainText('Сервис входа сейчас не ответил'); await snapshot(page, current); await switchMode(page, 'register'); await expect(page.getByRole('alert')).toHaveCount(0); }
      if (branch === 'recovery') { await switchMode(page, 'register'); await page.locator('.auth-form>label:first-child input').fill('synthetic-layout-only'); await page.locator('.password-field input').fill('SyntheticLayoutOnly123'); await page.locator('.auth-form>.button').click(); await expect(page.locator('.recovery-code')).toHaveText('SYNTHETIC-RECOVERY-CODE'); assert.equal(submissions, 1); await expect(page.locator('.auth-tabs,.auth-role-slot')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Я сохранил код', exact: true })).toBeVisible(); await page.getByRole('button', { name: 'Скопировать код', exact: true }).click(); await expect(page.getByRole('button', { name: 'Код скопирован', exact: true })).toBeVisible(); assert.equal(await page.evaluate(() => window.__authLayoutCopied), 'SYNTHETIC-RECOVERY-CODE'); }
      await stable(page); assert.equal(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth)), 0);
      const controls = await page.locator('.auth-card button,.auth-card a.button').evaluateAll(nodes => nodes.filter(node => node.checkVisibility()).map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
      assert.ok(controls.every(control => control.width >= 44 && control.height >= 44)); await snapshot(page, current); pass('mock-' + branch + '-branch-unclipped-accessible-controls-' + label); await context.close();
    }
  }
  assert.deepEqual(pageErrors, []); pass('no-unhandled-javascript-page-errors'); assert.deepEqual(requests, []); pass('no-real-registration-login-or-business-writes');
} catch (error) { checks.push({ name: current, pass: false, message: error.message }); report(); console.error('FAIL ' + current + ': ' + error.message); process.exitCode = 1; }
finally { await browser?.close(); const stopped = child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve(); child.kill(); await stopped; fixtureStopped = true; if (!before && fs.existsSync(path.join(fixture, 'data', 'atelie.sqlite'))) { const db = new DatabaseSync(path.join(fixture, 'data', 'atelie.sqlite')); try { assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => row.integrity_check), ['ok']); assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0); pass('isolated-database-integrity-foreign-keys-zero-created-accounts'); } finally { db.close(); } } report(); console.log('Fixture stopped; report ' + path.relative(process.cwd(), path.join(out, 'report.json'))); }
