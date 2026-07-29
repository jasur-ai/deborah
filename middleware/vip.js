/**
 * Edikit — VIP Access Control Middleware
 * 
 * 🔒 YASHIRIN FUNKSIYA: Bu middleware "VIP" (maxsus foydalanuvchi) tizimini boshqaradi.
 *    Hech qachon oddiy foydalanuvchiga "VIP", "Premium" yoki "Maxsus huquq" kabi
 *    so'zlar ko'rinmasligi kerak.
 * 
 * Nega 404 (403 emas)?
 *   403 = "bu yerda nimadir bor, lekin sizga ruxsat yo'q" — bu yashirin funksiya
 *          mavjudligini bildirib qo'yadi.
 *   404 = "bunday sahifa umuman yo'q" — oddiy foydalanuvchi noto'g'ri URL yozgandek
 *          taassurot qoldiradi.
 * 
 * Har bir so'rovda DB dan qayta tekshiradi (sessiyada keshlanmaydi).
 * Admin VIP huquqini olib tashlasa, foydalanuvchi darhol kirish huquqini yo'qotadi.
 */

import { fb } from '../firebase/admin.js';

/**
 * Require VIP access — returns 404 for non-VIP users
 * Har safar DB dan isVip qiymatini qayta o'qiydi (keshlanmaydi)
 */
export async function requireVip(req, res, next) {
  try {
    // Get user key
    const userKey = req.session?.user?.safeKey;
    if (!userKey) {
      return res.status(404).render('error', { 
        title: '404',
        message: 'Sahifa topilmadi',
        status: 404,
      });
    }

    // Read isVip from DB every time (no caching)
    const snap = await fb.get(`users/${userKey}/isVip`);
    const isVip = snap.exists() && snap.val() === true;

    if (!isVip) {
      // Return 404 — not 403! Feature must remain hidden
      return res.status(404).render('error', {
        title: '404',
        message: 'Sahifa topilmadi',
        status: 404,
      });
    }

    next();
  } catch (err) {
    // On error, also return 404 (fail closed)
    return res.status(404).render('error', {
      title: '404',
      message: 'Sahifa topilmadi',
      status: 404,
    });
  }
}

/**
 * Check if current user is VIP (for template use)
 */
export async function isCurrentUserVip(req) {
  try {
    if (!req.session?.user?.safeKey) return false;
    const snap = await fb.get(`users/${req.session.user.safeKey}/isVip`);
    return snap.exists() && snap.val() === true;
  } catch (_) {
    return false;
  }
}
