import { chromium } from 'playwright';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto('file:///home/user/demo/index.html');
await p.waitForTimeout(1500);
const r = await p.evaluate(() => ({
  missing: [...document.querySelectorAll('[data-i18n]')].filter(el => el.innerHTML.trim() === el.getAttribute('data-i18n')).length,
  roleBtns: [...document.querySelectorAll('.role-toggle button')].map(b => b.textContent + (b.classList.contains('on')?'✓':'')),
  regTab: document.getElementById('regTab').textContent,
  regSubmit: document.getElementById('regSubmit').textContent,
  one: document.querySelector('.auth-one')?.textContent
}));
// role: Talaba -> register
await p.click('.role-toggle button[data-role="user"]');
await p.waitForTimeout(200);
const rUser = await p.evaluate(() => ({
  regTab: document.getElementById('regTab').textContent,
  regSubmit: document.getElementById('regSubmit').textContent,
  roleOn: document.querySelector('.role-toggle button[data-role="user"]').classList.contains('on')
}));
// register as user
await p.click('.tabs button[data-tab="reg"]');
await p.fill('#fReg input[type="email"]', 'a@b.uz');
await p.click('#fReg .auth-submit');
await p.waitForTimeout(300);
const userMsg = await p.evaluate(() => document.getElementById('doneReg').textContent);
// role: teacher -> send request
await p.click('.role-toggle button[data-role="teacher"]');
await p.click('#fReg .auth-submit');
await p.waitForTimeout(300);
const teacherMsg = await p.evaluate(() => document.getElementById('doneReg').textContent);
// light contrast
await p.click('#themeBtn');
await p.waitForTimeout(900);
const light = await p.evaluate(() => ({
  mut: getComputedStyle(document.documentElement).getPropertyValue('--mut').trim(),
  dim: getComputedStyle(document.documentElement).getPropertyValue('--dim').trim(),
  ivory: getComputedStyle(document.documentElement).getPropertyValue('--ivory').trim(),
  bg: getComputedStyle(document.body).backgroundColor
}));
console.log(JSON.stringify({ r, rUser, userMsg, teacherMsg, light, errs }, null, 1));
await b.close();
