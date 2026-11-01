/**
 * Admin katalogi — navigatsiyaning yagona katalogidan quriladi.
 * EJS faylni regex bilan parse qilmaymiz: u tarjima va markup sababli
 * tugma nomini boshqa URL bilan bog'lab yuborishi mumkin.
 */
import { Router } from 'express';
import { requireAdmin } from '../../middleware/auth.js';
import { adminCopyFor } from './teachers.js';
import { ADMIN_NAVIGATION } from '../../data/admin-navigation.js';

const router = Router();
const CATALOG = ADMIN_NAVIGATION.map((group) => ({
  id: group.id,
  section: group.label,
  items: group.items.map((item) => ({
    id: item.id,
    href: item.href,
    label: item.label,
    icon: item.icon,
    tab: item.tab || null,
  })),
}));

router.get('/index', requireAdmin, async (req, res) => {
  try {
    res.render('admin/index', {
      title: 'Admin — barcha funksiyalar',
      catalog: CATALOG,
      totalLinks: CATALOG.reduce((count, group) => count + group.items.length, 0),
      csrfToken: req.session?.csrfToken || '',
      adminCopy: await adminCopyFor(req),
    });
  } catch (err) {
    console.error('Admin index error:', err);
    res.status(500).render('error', { title: 'Xato', message: 'Admin funksiyalar katalogi yuklanmadi', status: 500 });
  }
});

export default router;
