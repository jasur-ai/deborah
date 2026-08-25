import crypto from 'crypto';

/**
 * Deborah — Seed Data (MINIMAL)
 * ─────────────────────────────────────────────────────────────
 * 2026-08-25: Demo ma'lumotlar (22 ta mock fan — adabiyot, algebra...,
 * DTM guruhlari, 50 ta demo user, demo natijalar) OLIB TASHLANDI.
 *
 * Endi seed FAQAT lokal dev uchun admin hisobi beradi:
 *   admin / admin  (FAQAT lokal db.json rejimida; production'da admin
 *   CONFIG.ADMIN_USER / ADMIN_PASS env orqali — Render Dashboard)
 *
 * Real Firebase ulanganda (FIREBASE_SERVICE_ACCOUNT) seed ishlatilmaydi.
 * Eski demo seed kerak bo'lsa: git history — firebase/seed-data.js @ main 6e2df0e
 * Mavjud bazadan demo qoldiqlarini tozalash: scripts/cleanup-demo-data.js
 */

function hashPass(username, password) {
  const safeKey = username.replace(/[.#$\/\[\]]/g, '_').toLowerCase();
  return crypto.createHash('sha256')
    .update('qb_' + safeKey + '_' + password)
    .digest('hex');
}

const ago = (days = 0) => Date.now() - days * 24 * 60 * 60 * 1000;

/**
 * 🔐 Minimal seed — faqat lokal admin.
 * Demo: admin / admin
 */
export function generateSeedData() {
  const data = {};

  data.users = {};

  // ── Lokal admin (dev db.json) ──
  data.users['__admin__'] = {
    username: 'admin',
    password: hashPass('admin', 'admin'), // admin / admin
    created_at: ago(60),
  };

  return data;
}

export default generateSeedData;
