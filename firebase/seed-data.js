/**
 * ═══════════════════════════════════════════════════════════════
 * LOKAL SEED (data/db.json — dev/CI boot).
 * Faqat TEST FIXTURE hisoblar: admin/admin + user/user
 * (e2e visual testlari login qiladi — S03.08 credential fixture).
 * Demo fanlar/userlar YO'Q (tozalangan — eski to'liq seed: git 6e2df0e).
 * REAL Firebase'ga TEGILMAYDI (faqat lokal db.json boot).
 * ═══════════════════════════════════════════════════════════════
 * 👤 Admin: admin / admin    👤 User: user / user
 */
import crypto from 'crypto';

function hashPass(username, password) {
  const safeKey = username.replace(/[.#$\/\[\]]/g, '_').toLowerCase();
  return crypto.createHash('sha256')
    .update('qb_' + safeKey + '_' + password)
    .digest('hex');
}

const ago = (days = 0, hours = 0, mins = 0) =>
  Date.now() - (days * 86400000 + hours * 3600000 + mins * 60000);

// ── Question generator ──
function makeQ(text, opts, correct) {
  return {
    id: 'q' + Math.random().toString(36).slice(2, 7),
    text,
    options: opts.map((o, i) => ({ id: 'o' + i, text: o, isCorrect: i === correct })),
  };
}

export function generateSeedData() {
  const data = {};

  data.users = {};

  // ── Lokal admin (dev db.json) ──
  data.users['__admin__'] = {
    username: 'admin',
    password: hashPass('admin', 'admin'), // admin / admin
    created_at: ago(60),
  };

  // ── Test fixture user (test:vip — scripts/test-vip-browser.js sardor/1234
  //    bilan login qiladi; parol siyosati 4-belgili registratsiyaga yo'l
  //    qo'ymaydi, shuning uchun seed'dan beriladi. VIP emas — admin grant
  //    qiladi (S33.03: parol o'zgarmaydi). ──
  data.users['sardor'] = {
    username: 'sardor',
    password: hashPass('sardor', '1234'), // sardor / 1234
    name: 'Sardor',
    created_at: ago(18),
  };

  // ── Test fixture user (e2e visual: user-panel screenshots) ──
  data.users['user'] = {
    username: 'user',
    password: hashPass('user', 'user'), // user / user
    created_at: ago(30),
    tests: {
      ut1: {
        name: 'Mening Testlarim',
        created_at: ago(15),
        count: 5,
        questions: [
          makeQ("O'zbekiston poytaxti?", ['Toshkent', 'Samarqand', 'Buxoro', 'Xiva'], 0),
          makeQ('1 + 1 = ?', ['1', '2', '3', '4'], 1),
          makeQ('Eng katta okean?', ['Atlantika', 'Tinch', 'Hind', 'Shimoliy'], 1),
          makeQ('HTML nimani anglatadi?', ['Hyper Text Markup Language', 'Home Tool Markup Language', 'Hyperlinks Text Markup Language', 'None'], 0),
          makeQ('CSS da fon rangi?', ['color', 'background-color', 'bg-color', 'font-color'], 1),
        ],
      },
    },
  };

  return data;
}

export default generateSeedData;
