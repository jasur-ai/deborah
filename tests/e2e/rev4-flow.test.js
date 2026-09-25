import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { createSession, generateSessionId, generateJoinCode, upsertRole } from '../../services/cast/session-store.js';
import { initialState } from '../../services/cast/state-machine.js';

let ctx;
beforeAll(async () => { await startE2E(); ctx = await newContext(); await loginAsUser(ctx); }, 60000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('probe3 rev4', () => {
  it('studio launch → director start → practice retry → history', async () => {
    const page = await newPage(ctx);
    const errs = [];
    page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('C:' + m.text().slice(0, 160)); });

    // ── 1) studio: act-cast → preflight → launch → director URL ──
    await page.goto(`${serverUrl}/user/tests`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.act-cast[data-key]');
    let sessionsBody = null;
    page.on('response', async (r) => { if (r.url().includes('/api/cast/sessions') && r.request().method() === 'POST') sessionsBody = (await r.text().catch(() => '')).slice(0, 1200); });
    await page.click('.act-cast[data-key]');
    await page.waitForSelector('#cast-studio-overlay.open', { timeout: 8000 });
    await page.waitForFunction(() => {
      const launch = document.getElementById('cast-studio-launch');
      return launch && !launch.disabled;
    }, null, { timeout: 20000 });
    const [dirUrl] = await Promise.all([
      page.waitForURL(/\/cast\/[^/]+\/director/, { timeout: 30000 }).catch(() => null),
      page.click('#cast-studio-launch'),
    ]);
    console.log('SESSIONS_BODY', JSON.stringify(sessionsBody));
    await page.waitForFunction(() => location.pathname.includes('/director'), null, { timeout: 30000 });
    const after = await page.evaluate(() => ({ href: location.href, errsInDom: document.querySelector('.cast-studio-error') ? document.querySelector('.cast-studio-error').innerText : null }));
    console.log('AFTER', JSON.stringify(after));
    expect(after.href, 'director URLga o‘tdi').toContain('/director');
    console.log('STEP1 director-ok');
    await page.waitForFunction(() => document.getElementById('dir-code-val') && document.getElementById('dir-code-val').textContent !== '—', null, { timeout: 15000 });

    // ── 2) Director «Cast qilish» tugmasi → sessiya ishga tushishi ──
    const startBtn = page.locator('#btn-start-session');
    expect(await startBtn.isEnabled(), 'start tugmasi enabled').toBe(true);
    await page.waitForFunction(() => {
      const p = document.getElementById('btn-close-pill');
      return p && !p.hidden;
    }, { timeout: 25000 }).catch(() => {});
    // avval bosamiz — pill paydo bo'lishini kutamiz
    await page.click('#btn-start-session');
    await page.waitForFunction(() => {
      const p = document.getElementById('btn-close-pill');
      return p && !p.hidden;
    }, null, { timeout: 25000 });
    const phaseState = await page.evaluate(() => document.getElementById('dir-phase-badge') ? document.getElementById('dir-phase-badge').textContent : '');
    console.log('STEP2 started phase=' + phaseState + ' errs=' + JSON.stringify(errs));
    expect(phaseState).not.toBe('Lobbi');
    await page.close().catch(() => {});

    // ── 3) Practice: 5 savol, 2 tasini xato qilib → retry — barchasini to'g'ri ──
    const pr = await newPage(ctx);
    const errs2 = [];
    pr.on('pageerror', (e) => errs2.push('P:' + e.message.slice(0, 160)));
    await pr.goto(`${serverUrl}/user/practice?source=user&key=ut1`, { waitUntil: 'domcontentloaded' });
    // 09/2026 (user qarori): practice — qstage (.opt tugmalar), eski .qtile/.qcard yo'q
    await pr.waitForSelector('.qstage .opt[data-j]');
    const WRONG = [0, 3];
    for (let n = 0; n < 5; n++) {
      await pr.waitForFunction(() => {
        const q = document.querySelector('.qstage');
        return q && !q.querySelector('.opt.is-locked');
      }, null, { timeout: 8000 });
      const idx = await pr.evaluate(() => {
        const s = document.querySelector('.qstage');
        return s ? parseInt(s.dataset.qidx, 10) : null;
      });
      await pr.evaluate(({ idx, wrong }) => {
        const q = document.querySelector('.qstage');
        const btns = Array.from(q.querySelectorAll('.opt[data-j]'));
        const c = QUESTIONS[idx] != null ? QUESTIONS[idx].correct : -1;
        const pick = wrong.includes(idx) ? ((c + 1) % btns.length) : c;
        btns[pick].click();
        return { picked: pick, c, qtext: QUESTIONS[idx] && QUESTIONS[idx].text };
      }, { idx, wrong: WRONG });
      await pr.waitForFunction(() => document.querySelector('.pr-fb'), null, { timeout: 6000 });
      const hasNext = await pr.locator('#next').count();
      if (hasNext) await pr.click('#next');
    }
    // oxirgi savolda finish
    await pr.waitForFunction(() => document.querySelector('#finish'), null, { timeout: 6000 });
    await pr.click('#finish');
    // 09/2026 (Faza 1): Review & Submit oynasi → tasdiqlash
    await pr.waitForSelector('.pr-review-ov', { timeout: 6000 });
    await pr.click('[data-rv-done]');
    // natija ekranini kutamiz
    await pr.waitForSelector('#result:not([hidden]) .res-card', { timeout: 15000 });
    const resultTxt = await pr.locator('#result').innerText();
    console.log('STEP3 result-head:', resultTxt.slice(0, 150).replace(/\n/g, ' | '));
    expect(resultTxt, 'natija % bor').toMatch(/\d+%/);
    const rw = await pr.locator('#retry-wrong').count();
    expect(rw, '«faqat xatolar» tugmasi').toBe(1);
    // retry: xatolarni qayta yechamiz (2 ta — hammasini to'g'ri)
    await pr.click('#retry-wrong');
    await pr.waitForFunction(() => {
      const q = document.querySelector('.qstage');
      return q && !q.querySelector('.opt.is-locked');
    }, null, { timeout: 8000 });
    for (let n = 0; n < 2; n++) {
      const idx = await pr.evaluate(() => {
        const s = document.querySelector('.qstage');
        return s ? parseInt(s.dataset.qidx, 10) : null;
      });
      await pr.evaluate((idx) => {
        const q = document.querySelector('.qstage');
        const btns = Array.from(q.querySelectorAll('.opt[data-j]'));
        const c = QUESTIONS[idx] != null ? QUESTIONS[idx].correct : 0;
        btns[Math.max(0, c)].click();
      }, idx);
      await pr.waitForFunction(() => document.querySelector('.pr-fb'), null, { timeout: 6000 });
      const hasNext = await pr.locator('#next').count();
      if (hasNext) await pr.click('#next');
    }
    await pr.waitForFunction(() => document.querySelector('#finish'), null, { timeout: 6000 });
    await pr.click('#finish');
    await pr.waitForSelector('.pr-review-ov', { timeout: 6000 });
    await pr.click('[data-rv-done]');
    await pr.waitForSelector('#result:not([hidden]) .res-card', { timeout: 15000 });
    const retryTxt = await pr.locator('#result .pr-res-sub').innerText();
    console.log('STEP3b retry sub:', retryTxt, 'errs2=', JSON.stringify(errs2));
    expect(retryTxt, 'retry 2/2').toContain('2 / 2');
    await pr.screenshot({ path: '/home/user/shots/t4/retry-screen.png' }).catch(() => {});
    // tarix sahifasi
    await pr.goto(`${serverUrl}/user/practice-history`, { waitUntil: 'domcontentloaded' });
    await pr.waitForSelector('.ph-card', { timeout: 8000 });
    const histCount = await pr.locator('.ph-card').count();
    const histTxt = await pr.locator('.ph-list').innerText();
    console.log('STEP4 history count=', histCount, ' head=', histTxt.slice(0, 200).replace(/\n/g, ' | '));
    // 09/2026 (user qarori): xatolardan retry SAQLANMAYDI — tarixda faqat 1 yozuv (asosiy urinish)
    expect(histCount, 'tarixda faqat asosiy urinish (retry saqlanmaydi)').toBe(1);
    await pr.screenshot({ path: '/home/user/shots/t4/history.png' }).catch(() => {});
    await pr.close().catch(() => {});
  }, 180000);
});
