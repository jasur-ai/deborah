/**
 * Runtime audit (doimiy regressiya): builder/practice/kutubxona/panel/auth
 * funksiyalarini real brauzerda bosib chiqadi + mobil viewport geometriyasi.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startE2E, stopE2E, newContext, newPage, loginAsUser, serverUrl } from './cast-e2e.helper.js';
import { fb } from '../../firebase/admin.js';
import * as XLSX from 'xlsx';
import { writeFileSync } from 'fs';

const ORDER = ['Urug‘', 'Nihol', 'Ko‘chat', 'Daraxt'];
const PAIRS = [{ l: '2+2', r: '4' }, { l: '3*3', r: '9' }, { l: '10-4', r: '6' }];

let ctx;
function watch(page) {
  const errs = [];
  page.on('pageerror', (e) => errs.push('P:' + e.message.slice(0, 180)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // test env'da AI kalit yo'q → /api/ai/* 503 beradi (graceful fallback bor, kutilgan)
    if (/503 \(Service Unavailable\)/.test(t)) return;
    // C test ataylab non-VIP export 403 prob qiladi (dizayn bo'yicha)
    if (/403 \(Forbidden\)/.test(t)) return;
    errs.push('C:' + t.slice(0, 180));
  });
  page.on('response', (r) => {
    if (r.status() >= 400 && !r.url().includes('/api/ai/') && !r.url().includes('/api/tests/export')) errs.push('H:' + r.status() + ' ' + r.url().slice(0, 120));
  });
  return errs;
}

beforeAll(async () => {
  await startE2E();
  await fb.set('users/user/tests/zza1', {
    name: 'Audit 7 tur', created_at: Date.now(), count: 7,
    questions: [
      { type: 'single_choice', text: '2+2=?', options: ['3', '4', '5'], correct: 1, explanation: '' },
      { type: 'true_false', text: 'Osmon ko‘kmi?', options: ['To‘g‘ri', 'Noto‘g‘ri'], correct: 0, explanation: '' },
      { type: 'multiple_select', text: 'Juft sonlar?', options: ['1', '2', '3', '4'], correct: 1, correctMulti: [1, 3], explanation: '' },
      { type: 'short_answer', text: 'Poytaxt?', options: ['Toshkent'], correct: 0, explanation: '' },
      { type: 'reorder', text: 'O‘sish tartibi?', options: ORDER, correct: 0, explanation: '' },
      { type: 'match', text: 'Moslashtiring', options: [], correct: 0, pairs: PAIRS, explanation: '' },
      { type: 'exit_ticket', text: 'Dars yoqdimi?', options: ['Ha', 'Yo‘q'], correct: 0, explanation: '' },
    ],
  });
  await fb.set('users/user/tests/zza2', {
    name: 'Audit kutubxona', created_at: Date.now(), count: 2,
    questions: [
      { type: 'single_choice', text: '1+1=?', options: ['1', '2'], correct: 1, explanation: '' },
      { type: 'single_choice', text: '3+3=?', options: ['5', '6'], correct: 1, explanation: '' },
    ],
  });
  // Excel import fayli: single + multi(0,2) + xato qator
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    ['Savol', 'A', 'B', 'C', 'D', 'Togri', 'Izoh'],
    ['Import single?', 'a1', 'b1', 'c1', 'd1', '1', ''],
    ['Import multi?', 'a2', 'b2', 'c2', 'd2', '0,2', ''],
    ['', 'x', 'y', '', '', '0', ''],
  ]);
  XLSX.utils.book_append_sheet(wb, ws, 'Savollar');
  writeFileSync('/tmp/audit-import.xlsx', XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  ctx = await newContext();
  await loginAsUser(ctx);
}, 90000);
afterAll(async () => { if (ctx) await ctx.close().catch(() => {}); await stopE2E(); });

describe('zz audit', () => {
  it('A builder: 7 tur + excel + AI + save + preview + validatsiya', async () => {
    const page = await newPage(ctx);
    const errs = watch(page);
    await page.goto(`${serverUrl}/user/create-test`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tb-add-question');
    await page.fill('#tb-name', 'Audit test');
    await page.click('#tb-add-question');
    await page.waitForSelector('#tb-q-type');
    // 7 tur almashuv — har birida muharrir render bo'lishi shart
    for (const t of ['single_choice', 'true_false', 'multiple_select', 'short_answer', 'match', 'reorder', 'exit_ticket']) {
      await page.selectOption('#tb-q-type', t);
      await page.waitForTimeout(150);
      const ok = await page.evaluate(() => !!document.querySelector('#tb-q-type'));
      expect(ok, 'editor ' + t).toBe(true);
    }
    console.log('AUDIT-A types-ok');
    // match to'ldirish
    await page.selectOption('#tb-q-type', 'match');
    await page.fill('#tb-q-text', 'Audit match?');
    await page.fill('[data-pair-l="0"]', 'olma');
    await page.fill('[data-pair-r="0"]', 'apple');
    await page.fill('[data-pair-l="1"]', 'nok');
    await page.fill('[data-pair-r="1"]', 'pear');
    // Excel import
    await page.click('#tb-import-btn');
    await page.waitForSelector('#tb-import-modal:not([hidden])');
    await page.setInputFiles('#tb-import-input', '/tmp/audit-import.xlsx');
    await page.waitForSelector('#tb-import-preview .tb-ip-card, #tb-import-preview .tb-ip-errors', { timeout: 10000 });
    const imp = await page.evaluate(() => ({
      items: document.querySelectorAll('#tb-import-preview .tb-ip-card').length,
      errs: document.querySelectorAll('#tb-import-preview .tb-ip-errors li').length,
      multi: document.querySelector('#tb-import-preview').innerHTML.includes('☑'),
    }));
    console.log('AUDIT-A import=' + JSON.stringify(imp));
    expect(imp.items).toBe(2);
    expect(imp.errs).toBe(1);
    expect(imp.multi).toBe(true);
    await page.click('#tb-import-confirm');
    await page.waitForSelector('#tb-import-finish:not([hidden])', { timeout: 8000 });
    await page.click('#tb-import-finish');
    const nq1 = await page.evaluate(() => document.querySelectorAll('.tb-outline-item').length);
    expect(nq1).toBe(3);
    console.log('AUDIT-A import-ok nq=3');
    // AI modal (mock fallback — kalit yo'q)
    await page.click('#tb-ai-generate');
    await page.waitForSelector('.ai-overlay');
    await page.fill('#ai-topic', 'Fotosintez');
    await page.click('#ai-go');
    await page.waitForSelector('#ai-out input[type=checkbox]', { timeout: 15000 });
    await page.screenshot({ path: '/tmp/shots3/au-ai.png' });
    await page.click('#ai-insert');
    await page.waitForTimeout(500);
    const nq2 = await page.evaluate(() => document.querySelectorAll('.tb-outline-item').length);
    expect(nq2).toBeGreaterThan(3);
    console.log('AUDIT-A ai-ok nq=' + nq2);
    const overlayGone = await page.evaluate(() => !document.querySelector('.ai-overlay'));
    expect(overlayGone).toBe(true);
    // Saqlash (yangi test)
    let savedKey = null;
    page.on('response', async (r) => {
      if (r.url().includes('/api/tests/save') && r.request().method() === 'POST') {
        try { const j = await r.json(); savedKey = j.key || null; } catch (_) {}
      }
    });
    await page.click('#tb-save-btn');
    await page.waitForFunction(() => /Saqlandi|Сохран|Saved/.test(document.querySelector('#tb-status-txt') ? document.querySelector('#tb-status-txt').textContent : ''), null, { timeout: 10000 });
    console.log('AUDIT-A saved key=' + savedKey);
    expect(savedKey).toBeTruthy();
    // Ko'rish → practice
    await page.click('#tb-preview-btn');
    await page.waitForURL(/\/user\/practice\?source=user&key=/, { timeout: 10000 });
    console.log('AUDIT-A preview-ok');
    // Validatsiya: bo'sh savol bilan saqlash
    await page.goto(`${serverUrl}/user/create-test`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tb-add-question');
    await page.click('#tb-add-question');
    await page.waitForSelector('#tb-q-type');
    await page.click('#tb-save-btn');
    await page.waitForTimeout(700);
    const vst = await page.evaluate(() => document.querySelector('#tb-status-txt') ? document.querySelector('#tb-status-txt').textContent : '');
    console.log('AUDIT-A validation-status=' + vst.slice(0, 80));
    expect(vst.length).toBeGreaterThan(0);
    expect(errs).toEqual([]);
    await page.close();
  }, 120000);

  it('B practice: timeout + xato + retry + tarix + AI tahlil', async () => {
    const page = await newPage(ctx);
    const errs = watch(page);
    await page.goto(`${serverUrl}/user/practice?source=user&key=zza1&time=2`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.qstage');
    // Q1 timeout (2s)
    await page.waitForSelector('.pr-fb', { timeout: 8000 });
    const miss = await page.evaluate(() => document.querySelector('.pr-fb').textContent);
    console.log('AUDIT-B timeout-fb=' + miss.slice(0, 40));
    expect(miss).toContain('Vaqt tugadi');
    // Q2-Q7 to'g'ri
    const answerRest = async () => {
      for (let n = 0; n < 6; n++) {
        await page.click('#next');
        await page.waitForFunction(() => !document.querySelector('.qstage .opt.is-locked') || document.querySelector('#pr-confirm') || document.querySelector('.pr-short-input') || document.querySelector('.pr-ro-list') || document.querySelector('.pr-m-sel'), null, { timeout: 8000 });
        await page.evaluate(({ order, pairs }) => {
          const s = document.querySelector('.qstage');
          const idx = parseInt(s.dataset.qidx, 10);
          const q = QUESTIONS[idx];
          if (q.type === 'single_choice' || q.type === 'true_false' || q.type === 'exit_ticket') {
            s.querySelector(`.opt[data-j="${q.correct}"]`).click();
          } else if (q.type === 'multiple_select') {
            q.correctMulti.forEach((j) => s.querySelector(`.opt[data-j="${j}"]`).click());
            document.getElementById('pr-confirm').click();
          } else if (q.type === 'short_answer') {
            const inp = document.getElementById('pr-short');
            inp.value = 'Toshkent';
            document.getElementById('pr-confirm').click();
          }
        }, { order: ORDER, pairs: PAIRS });
        // reorder/match alohida (async DOM)
        const t = await page.evaluate(() => QUESTIONS[parseInt(document.querySelector('.qstage').dataset.qidx, 10)].type);
        if (t === 'reorder') {
          for (let step = 0; step < 30; step++) {
            const cur = await page.evaluate(() => [...document.querySelectorAll('#pr-ro-list .pr-ro-t')].map((el) => el.textContent));
            if (JSON.stringify(cur) === JSON.stringify(ORDER)) break;
            const i = cur.findIndex((x, ix) => x !== ORDER[ix]);
            const j = cur.indexOf(ORDER[i]);
            if (i < 0 || j < 0) break;
            if (j > i) await page.click(`#pr-ro-list [data-ro-up="${j}"]`);
            else await page.click(`#pr-ro-list [data-ro-down="${j}"]`);
            await page.waitForTimeout(40);
          }
          await page.click('#pr-confirm');
        } else if (t === 'match') {
          await page.evaluate((pairs) => {
            document.querySelectorAll('.pr-m-sel').forEach((sel) => {
              const opt = [...sel.options].find((o) => o.text === pairs[+sel.dataset.m].r);
              if (opt) { sel.value = opt.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
            });
          }, PAIRS);
          await page.click('#pr-confirm');
        }
        await page.waitForSelector('.pr-fb', { timeout: 8000 });
      }
    };
    await answerRest();
    await page.click('#finish');
    await page.waitForSelector('[data-rv-done]');
    // review click-through: 1-savolga qaytish
    await page.click('[data-rv="0"]');
    await page.waitForFunction(() => document.querySelector('.qstage') && !document.querySelector('.pr-review-ov'), null, { timeout: 8000 });
    const backIdx = await page.evaluate(() => parseInt(document.querySelector('.qstage').dataset.qidx, 10));
    expect(backIdx).toBe(0);
    // oxirgi savolga o'tib yakunlash
    for (let k = 0; k < 6; k++) {
      await page.evaluate(() => { const b = document.getElementById('next'); if (b) b.click(); });
      await page.waitForTimeout(120);
    }
    await page.click('#finish');
    await page.waitForSelector('[data-rv-done]');
    await page.click('[data-rv-done]');
    await page.waitForSelector('.pr-res-score', { timeout: 10000 });
    const sub = await page.evaluate(() => document.querySelector('.pr-res-sub').textContent);
    console.log('AUDIT-B result=' + sub);
    expect(sub).toContain('6 / 7');
    // AI tahlil tugmasi (30s+ dan keyin ham ishlashi shart)
    await page.click('#pr-ai-analysis');
    await page.waitForSelector('.ai-overlay, .ai-panel', { timeout: 10000 });
    console.log('AUDIT-B ai-analysis-ok');
    await page.screenshot({ path: '/tmp/shots3/au-aipanel.png' });
    await page.keyboard.press('Escape');
    // retry-wrong → 1 savol → to'g'ri
    await page.click('#retry-wrong');
    await page.waitForSelector('.qstage');
    const rIdx = await page.evaluate(() => parseInt(document.querySelector('.qstage').dataset.qidx, 10));
    expect(rIdx).toBe(0);
    await page.evaluate(() => {
      const c = QUESTIONS[0].correct;
      document.querySelector(`.qstage .opt[data-j="${c}"]`).click();
    });
    await page.waitForSelector('.pr-fb', { timeout: 8000 });
    await page.click('#finish');
    await page.waitForSelector('[data-rv-done]');
    await page.click('[data-rv-done]');
    await page.waitForSelector('.pr-res-score', { timeout: 10000 });
    const sub2 = await page.evaluate(() => document.querySelector('.pr-res-sub').textContent);
    const notSaved = await page.evaluate(() => document.body.innerText.includes('saqlanmadi'));
    console.log('AUDIT-B retry=' + sub2 + ' notSaved=' + notSaved);
    expect(sub2).toContain('1 / 1');
    expect(notSaved).toBe(true);
    // tarix
    await page.goto(`${serverUrl}/user/practice-history`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const hist = await page.evaluate(() => document.body.innerText.slice(0, 500));
    console.log('AUDIT-B history=' + hist.slice(0, 120).replace(/\n/g, ' | '));
    expect(hist).toContain('Audit 7 tur');
    expect(errs).toEqual([]);
    await page.close();
  }, 150000);

  it('C kutubxona: duplicate/visibility/archive/export/delete + sinov', async () => {
    const page = await newPage(ctx);
    const errs = watch(page);
    await page.goto(`${serverUrl}/user/tests`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.ws-lib-row');
    const menuClick = async (key, act) => {
      await page.evaluate((k) => document.querySelector(`[data-overflow="${k}"]`).scrollIntoView({ block: 'center' }), key);
      await page.waitForTimeout(200);
      await page.click(`[data-overflow="${key}"]`);
      await page.waitForSelector(`[data-menu="${key}"].is-open`);
      // klaviatura bilan (sichqoncha koordinata poygasi bo'lmasligi uchun)
      await page.focus(`[data-menu="${key}"] [data-act="${act}"]`);
      await page.keyboard.press('Enter');
    };
    const count0 = await page.evaluate(() => document.querySelectorAll('.ws-lib-row').length);
    // duplicate (muvaffaqiyatda sahifa reload bo'ladi)
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/tests/duplicate') && r.request().method() === 'POST', { timeout: 10000 }),
      menuClick('zza2', 'duplicate'),
    ]);
    await page.waitForSelector('.ws-lib-row');
    await page.waitForTimeout(600);
    const count1 = await page.evaluate(() => document.querySelectorAll('.ws-lib-row').length);
    expect(count1).toBe(count0 + 1);
    console.log('AUDIT-C dup-ok');
    // visibility
    const pub0 = await page.evaluate(() => document.querySelector('.ws-lib-row[data-key="zza2"]').dataset.public);
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/tests/toggle-public') && r.request().method() === 'POST', { timeout: 10000 }),
      menuClick('zza2', 'visibility'),
    ]);
    await page.waitForFunction((p) => { const el = document.querySelector('.ws-lib-row[data-key="zza2"]'); return el && el.dataset.public !== p; }, pub0, { timeout: 10000 });
    console.log('AUDIT-C vis-ok');
    // archive + unarchive
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/tests/archive') && r.request().method() === 'POST', { timeout: 10000 }),
      menuClick('zza2', 'archive'),
    ]);
    await page.waitForFunction(() => { const el = document.querySelector('.ws-lib-row[data-key="zza2"]'); return el && el.dataset.archived === '1'; }, null, { timeout: 10000 });
    console.log('AUDIT-C archived=1');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/tests/archive') && r.request().method() === 'POST', { timeout: 10000 }),
      menuClick('zza2', 'archive'),
    ]);
    await page.waitForFunction(() => { const el = document.querySelector('.ws-lib-row[data-key="zza2"]'); return el && el.dataset.archived !== '1'; }, null, { timeout: 10000 });
    console.log('AUDIT-C unarch-ok');
    // export: non-VIP'da tugma yo'q + API 403 (qaror bo'yicha); VIP'da 200 + attachment
    const noExportBtn = await page.evaluate(() => !document.querySelector('[data-menu="zza2"] [data-act="export"]'));
    expect(noExportBtn).toBe(true);
    const exp403 = await page.evaluate(async () => (await fetch('/user/api/tests/export?key=zza2')).status);
    expect(exp403).toBe(403);
    await fb.set('users/user/isVip', true);
    const exp = await page.evaluate(async () => {
      const r = await fetch('/user/api/tests/export?key=zza2');
      const txt = await r.text();
      return { status: r.status, disp: r.headers.get('content-disposition'), hasTest: txt.includes('"test"') };
    });
    console.log('AUDIT-C export=' + JSON.stringify(exp));
    expect(exp.status).toBe(200);
    expect(exp.disp || '').toContain('attachment');
    expect(exp.hasTest).toBe(true);
    await fb.set('users/user/isVip', false);
    // delete: avval bekor → keyin tasdiq (dialog.dialog--danger)
    await menuClick('zza2', 'delete');
    await page.waitForSelector('dialog.dialog--danger', { timeout: 8000 });
    await page.screenshot({ path: '/tmp/shots3/au-delconfirm.png' });
    await page.click('dialog.dialog--danger [data-no]');
    await page.waitForTimeout(700);
    const stillThere = await page.evaluate(() => !!document.querySelector('.ws-lib-row[data-key="zza2"]'));
    expect(stillThere).toBe(true);
    console.log('AUDIT-C del-cancel-ok');
    await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/tests/delete') && r.request().method() === 'POST', { timeout: 10000 }),
      (async () => { await menuClick('zza2', 'delete'); await page.waitForSelector('dialog.dialog--danger'); await page.click('dialog.dialog--danger [data-yes]'); })(),
    ]);
    await page.waitForFunction(() => !document.querySelector('.ws-lib-row[data-key="zza2"]'), null, { timeout: 8000 });
    console.log('AUDIT-C del-ok');
    // sinov modal → practice
    await page.click('[data-start-sinov]');
    await page.waitForSelector('#start-modal.open, #start-modal:not([hidden])', { timeout: 8000 });
    await page.screenshot({ path: '/tmp/shots3/au-sinov.png' });
    await page.click('#start-modal [data-act="start"]');
    await page.waitForURL(/\/user\/practice/, { timeout: 10000 });
    console.log('AUDIT-C sinov-ok');
    expect(errs).toEqual([]);
    await page.close();
  }, 120000);

  it('D panel smoke: barcha /user havolalar', async () => {
    const page = await newPage(ctx);
    const errs = watch(page);
    await page.goto(`${serverUrl}/user/panel`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const links = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href^="/user/"]')].map((a) => a.getAttribute('href').split('?')[0]))].filter((h) => h !== '/user/logout').slice(0, 18));
    console.log('AUDIT-D links=' + JSON.stringify(links));
    for (const href of links) {
      const resp = await page.goto(serverUrl + href, { waitUntil: 'domcontentloaded' }).catch((e) => null);
      await page.waitForTimeout(400);
      const code = resp ? resp.status() : 'ERR';
      console.log('AUDIT-D ' + href + ' → ' + code);
      expect([200, 304], href).toContain(code);
    }
    expect(errs).toEqual([]);
    await page.close();
  }, 120000);

  it('E mobile 390px: practice + builder + panel', async () => {
    const mctx = await ctx.browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const cookies = await ctx.cookies();
    await mctx.addCookies(cookies);
    const page = await mctx.newPage();
    const errs = watch(page);
    await page.goto(`${serverUrl}/user/practice?source=user&key=zza1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.qstage');
    // 5-savol (reorder) ga o'tish
    for (let k = 0; k < 4; k++) {
      await page.evaluate(() => {
        const s = document.querySelector('.qstage');
        const idx = parseInt(s.dataset.qidx, 10);
        const q = QUESTIONS[idx];
        if (q.type === 'single_choice' || q.type === 'true_false') s.querySelector(`.opt[data-j="${q.correct}"]`).click();
        else if (q.type === 'multiple_select') { q.correctMulti.forEach((j) => s.querySelector(`.opt[data-j="${j}"]`).click()); document.getElementById('pr-confirm').click(); }
        else if (q.type === 'short_answer') { document.getElementById('pr-short').value = 'Toshkent'; document.getElementById('pr-confirm').click(); }
      });
      await page.waitForSelector('.pr-fb', { timeout: 8000 });
      await page.click('#next');
      await page.waitForTimeout(300);
    }
    await page.waitForSelector('#pr-ro-list');
    await page.screenshot({ path: '/tmp/shots3/au-m-practice.png' });
    await page.goto(`${serverUrl}/user/create-test?edit=zza1`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#tb-q-type', { timeout: 15000 });
    await page.screenshot({ path: '/tmp/shots3/au-m-builder.png' });
    await page.goto(`${serverUrl}/user/panel`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    await page.screenshot({ path: '/tmp/shots3/au-m-panel.png' });
    // REGRESSIYA: banner tugmalar mobil viewport ichida bo'lishi shart (x>=0, o'ng chekka<=390)
    const bannerGeom = await page.evaluate(() => [...document.querySelectorAll('.email-verify-banner')]
      .filter((bn) => getComputedStyle(bn).display !== 'none')
      .flatMap((bn) => [...bn.querySelectorAll('.evb-btn')].map((el) => {
        const r = el.getBoundingClientRect();
        return { id: bn.id || '?', t: (el.innerText || 'x').slice(0, 18), x: Math.round(r.x), rgt: Math.round(r.right) };
      })));
    console.log('AUDIT-E banners=' + JSON.stringify(bannerGeom));
    for (const b of bannerGeom) {
      expect(b.x, `banner ${b.id} "${b.t}" chap chekka`).toBeGreaterThanOrEqual(0);
      expect(b.rgt, `banner ${b.id} "${b.t}" o'ng chekka`).toBeLessThanOrEqual(390);
    }
    expect(errs).toEqual([]);
    await page.close();
    await mctx.close();
  }, 120000);
});
