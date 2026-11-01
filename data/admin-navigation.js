/*
 * Deborah Admin — yagona navigatsiya katalogi.
 *
 * Sahifa nomi va manzillari shu faylda saqlanadi: dashboard sidebar, barcha
 * funksiyalar qidiruvi va navigatsiya regressiya testlari shu katalogdan
 * foydalanadi. EJS markup'ini regex bilan parse qilish taqiqlangan — u
 * dinamik tarjima/markup sabab linklarni noto'g'ri juftlashi mumkin.
 */
const tab = (id, label, icon) => ({
  id,
  label,
  icon,
  tab: id,
  href: `/admin/dashboard?tab=${encodeURIComponent(id)}`,
});
const page = (id, label, href, icon) => ({ id, label, href, icon });

export const ADMIN_NAVIGATION = [
  {
    id: 'main',
    label: 'Asosiy boshqaruv',
    items: [
      { ...page('dashboard', 'Boshqaruv paneli', '/admin/dashboard', 'grid'), tab: 'overview', featured: true },
      page('users', 'Foydalanuvchilar', '/admin/users', 'users'),
      page('teachers', 'O‘qituvchi arizalari', '/admin/teachers', 'bookOpen'),
      page('vip-users', 'VIP foydalanuvchilar', '/admin/vip', 'shield'),
      page('roster', 'Ro‘yxat importi', '/admin/roster', 'file'),
      page('audit', 'Audit jurnali', '/admin/audit', 'activity'),
      page('email-cost', 'Email xarajatlari', '/admin/email-cost', 'mail'),
      page('admin-profile', 'Admin profili', '/admin/profile', 'user'),
    ],
  },
  {
    id: 'content',
    label: 'Testlar va natijalar',
    items: [
      tab('danger', 'Tezkor foydalanuvchi boshqaruvi', 'user'),
      tab('fans', 'Namuna fanlar', 'book'),
      tab('pre', 'Tayyor testlar', 'layers'),
      tab('results', 'O‘yin natijalari', 'trophy'),
      tab('stats', 'Statistika', 'barChart'),
      tab('vip', 'VIP tezkor amallari', 'shield'),
      tab('governance', 'Cast boshqaruvi', 'shieldCheck'),
      page('arena', 'Test Arena', '/arena', 'monitor'),
    ],
  },
  {
    id: 'operations',
    label: 'Akademik amallar',
    items: [
      page('scheduler', 'Dars jadvali', '/admin/scheduler', 'calendar'),
      page('seating', 'O‘tirish joylari', '/admin/seating', 'users'),
      page('scan', 'Skanerlash va javob kaliti', '/admin/scan', 'search'),
      page('paper', 'Qog‘oz test paketlari', '/admin/paper', 'fileText'),
      page('safe-submit', 'Xavfsiz topshirish', '/admin/safe-submit', 'upload'),
      page('sources', 'Manbalar to‘plami', '/admin/sources', 'folder'),
      page('grading', 'Baholash', '/admin/grading', 'trendUp'),
      page('marking', 'Ishlarni tekshirish', '/admin/marking', 'checkCircle'),
      page('board', 'Komissiya tasdig‘i', '/admin/board', 'award'),
      page('consideration', 'Apellyatsiyalar', '/admin/consideration', 'alertTriangle'),
      page('question-gen', 'AI savol yaratish', '/admin/ai-question-gen', 'sparkles'),
    ],
  },
  {
    id: 'ai',
    label: 'AI boshqaruvi',
    items: [
      page('ai-grading', 'AI baholash', '/admin/ai-grading', 'cpu'),
      page('ai-mlops', 'AI MLOps', '/admin/ai-mlops', 'layers'),
      page('ai-checkpoint', 'AI nazorat nuqtasi', '/admin/ai-checkpoint', 'shieldCheck'),
      page('claude', 'Claude', '/admin/claude', 'sparkles'),
      page('provider', 'AI provayderlari', '/admin/provider', 'settings'),
      page('resource-reco', 'Resurs tavsiyalari', '/admin/resource-reco', 'search'),
    ],
  },
  {
    id: 'integrations',
    label: 'Taqdimot va ulanishlar',
    items: [
      page('presentations', 'Taqdimotlar', '/admin/presentations', 'play'),
      page('canva', 'Canva', '/admin/canva', 'gift'),
      page('google-slides', 'Google Slides', '/admin/google-slides', 'play'),
      page('deck-export', 'Taqdimot eksporti', '/admin/deck-export', 'download'),
      page('quiz-deck', 'Quiz Deck', '/admin/quiz-deck', 'layers'),
      page('external-integration', 'Tashqi xizmatlar', '/admin/external-integration', 'link'),
    ],
  },
  {
    id: 'oversight',
    label: 'Monitoring va xavfsizlik',
    items: [
      page('observability', 'Tizim kuzatuvi', '/admin/observability', 'activity'),
      page('reliability', 'Ishonchlilik', '/admin/reliability', 'refresh'),
      page('security-guard', 'Xavfsizlik', '/admin/security-guard', 'shield'),
      page('command-center', 'Operatsion markaz', '/admin/command-center', 'zap'),
      page('camera-review', 'Kamera nazorati', '/admin/camera-review', 'camera'),
    ],
  },
  {
    id: 'governance',
    label: 'Sifat va muvofiqlik',
    items: [
      page('acceptance', 'Qabul sinovlari', '/admin/acceptance', 'checkCircle'),
      page('institutional', 'Tashkilot sozlamalari', '/admin/institutional', 'briefcase'),
      page('program-quality', 'Dastur sifati', '/admin/program-quality', 'award'),
      page('credentials', 'Sertifikatlar', '/admin/credentials', 'trophy'),
      page('multilingual', 'Tillar', '/admin/multilingual', 'globe'),
      page('accessibility', 'Maxsus imkoniyatlar', '/admin/accessibility', 'eye'),
      page('data-governance', 'Ma’lumotlar boshqaruvi', '/admin/data-governance', 'database'),
      page('interventions', 'Yordam choralari', '/admin/interventions', 'heart'),
      page('api-contracts', 'API shartnomalari', '/admin/api-contracts', 'file'),
    ],
  },
];

// Barcha sahifalarda takrorlanadigan, qisqa va tushunarli chap navigatsiya.
// Qolgan modullar /admin/index dagi qidiriladigan katalog orqali topiladi.
export const ADMIN_SIDEBAR_GROUPS = [
  {
    id: 'home',
    label: 'Ish maydoni',
    items: [
      { id: 'dashboard-home', label: 'Umumiy ko‘rinish', href: '/admin/dashboard', icon: 'grid', tab: 'overview' },
      { id: 'all-tools', label: 'Barcha funksiyalar', href: '/admin/index', icon: 'layers' },
    ],
  },
  {
    id: 'people',
    label: 'Foydalanuvchilar',
    items: [
      { id: 'users', label: 'Foydalanuvchilar ro‘yxati', href: '/admin/users', icon: 'users' },
      { id: 'teachers', label: 'O‘qituvchi arizalari', href: '/admin/teachers', icon: 'bookOpen' },
      { id: 'vip-users', label: 'VIP foydalanuvchilar', href: '/admin/vip', icon: 'shield' },
      { id: 'roster', label: 'Ro‘yxat importi', href: '/admin/roster', icon: 'file' },
    ],
  },
  {
    id: 'tests',
    label: 'Testlar va natijalar',
    items: [
      { id: 'quick-users', label: 'Tezkor user amallari', href: '/admin/dashboard?tab=danger', icon: 'user', tab: 'danger' },
      { id: 'fans', label: 'Namuna fanlar', href: '/admin/dashboard?tab=fans', icon: 'book', tab: 'fans' },
      { id: 'pre', label: 'Tayyor testlar', href: '/admin/dashboard?tab=pre', icon: 'layers', tab: 'pre' },
      { id: 'results', label: 'O‘yin natijalari', href: '/admin/dashboard?tab=results', icon: 'trophy', tab: 'results' },
      { id: 'stats', label: 'Statistika', href: '/admin/dashboard?tab=stats', icon: 'barChart', tab: 'stats' },
      { id: 'vip-quick', label: 'VIP tezkor amallari', href: '/admin/dashboard?tab=vip', icon: 'shield', tab: 'vip' },
      { id: 'governance-quick', label: 'Cast boshqaruvi', href: '/admin/dashboard?tab=governance', icon: 'shieldCheck', tab: 'governance' },
    ],
  },
];

export const ADMIN_DASHBOARD_TABS = new Set([
  'overview', 'danger', 'fans', 'pre', 'results', 'stats', 'vip', 'governance',
]);

export function flattenAdminNavigation(groups = ADMIN_NAVIGATION) {
  return groups.flatMap((group) => group.items.map((item) => ({
    ...item,
    section: group.label,
    sectionId: group.id,
  })));
}
