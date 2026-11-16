/**
 * BUG-029 — "Barcha funksiyalar" bir ko'rinish sahifasi (/admin/index)
 * ---------------------------------------------------------------
 * Foydalanuvchi talabi: admin panelga kirganda HAMMA funksiya bir
 * ko'rinishda bo'lishi kerak (sidebar 1366×768'da 20+ tugma fold ostida).
 *
 * Yechim: dashboard sidebar — yagona manba (single source of truth). Uning
 * guruh/label/havolalari modul yuklanganda bir marta parse qilinadi va
 * qidiruv mumkin bitta grid sahifada chiqariladi. Sidebar o'zgarganda bu
 * sahifa avtomatik yangilanadi (qo'lda ro'yxat yuritilmaydi).
 *
 * NOTA: yangi sahifa qo'shilsa avval dashboard.ejs sidebar'ga qo'shiling —
 * /admin/index uni o'zi ko'radi.
 */
import { Router } from 'express';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { requireAdmin } from '../../middleware/auth.js';
import { adminCopyFor } from './teachers.js';

const router = Router();

/** Dashboard sidebar (yagona manba) → [{section, items:[{href,label}]}] */
function catalogFromSidebar() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../views/admin/dashboard.ejs');
  let src = '';
  try { src = readFileSync(file, 'utf8'); } catch (_) { return []; }
  const groups = [];
  let current = null;
  // admin-side-label (guruh) va admin-side-btn (havola) takrorlanish tartibida
  const re = /<div class="admin-side-label"[^>]*>((?:[^<]|<%[\s\S]*?%>)+?)<\/div>|<a href="(\/[a-z0-9\/-]+)" class="admin-side-btn"[^>]*>[\s\S]*?<\/span>\s*([^<]+)<\/a>/g;
  for (const m of src.matchAll(re)) {
    if (m[1]) { current = { section: m[1].trim(), items: [] }; groups.push(current); }
    else if (current && m[2] && m[3]) current.items.push({ href: m[2], label: m[3].trim() });
  }
  // EJS-label guruhlarini odam o'qiydigan nomga normalizatsiya:
  // "<%= (x || 'Bo'limlar') %>" -> "Bo'limlar"; %/HTML-tag qoldiqlari tozalanadi
  const norm = (s) => {
    const def = s.match(/\|\s*'([^']+)'/);
    if (def) return def[1];
    return s.replace(/<%[\s\S]*?%>/g, '').replace(/<[^>]+>/g, '').trim();
  };
  return groups.filter((g) => g.items.length).map((g) => ({ section: norm(g.section), items: g.items }));
}

const CATALOG = catalogFromSidebar();

router.get('/index', requireAdmin, async (req, res) => {
  try {
    res.render('admin/index', {
      title: 'Barcha funksiyalar',
      catalog: CATALOG,
      totalLinks: CATALOG.reduce((n, g) => n + g.items.length, 0),
      csrfToken: req.session?.csrfToken || '',
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    console.error('Admin index error:', err);
    res.status(500).render('error', { title: 'Xato', message: 'Admin index yuklanmadi', status: 500 });
  }
});

export default router;
