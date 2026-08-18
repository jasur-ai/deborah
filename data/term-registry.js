/**
 * Deborah — Term Registry (STYLE S35.03/04)
 * -----------------------------------------------------------------
 * Server tomoni term registry — `public/js/term-utils.js` bilan mos.
 *  - TERMS: approved terminlar (label/plural)
 *  - JARGON: eski jargon -> approved label (approveJargon orqali)
 *  - termLabel(key): key bo'yicha approved label; noma'lum -> raw key
 *  - approveJargon(text): eng uzun jargon birinchi almashtiriladi
 */

export const TERMS = {
  teacher: { label: "O'qituvchi", plural: "O'qituvchilar" },
  student: { label: 'Ishtirokchi', plural: 'Ishtirokchilar' },
  test: { label: 'Test', plural: 'Testlar' },
  readyTest: { label: 'Tayyor test', plural: 'Tayyor testlar' },
  sampleTest: { label: 'Namuna test', plural: 'Namuna testlar' },
  session: { label: 'Jonli sessiya', plural: 'Jonli sessiyalar' },
  question: { label: 'Savol', plural: 'Savollar' },
  result: { label: 'Natija', plural: 'Natijalar' },
  score: { label: 'Ball', plural: 'Ballar' },
  settings: { label: 'Sozlamalar' },
  leaderboard: { label: 'Reyting', plural: 'Reytinglar' },
  invite: { label: 'Taklif', plural: 'Takliflar' },
  timer: { label: 'Vaqt' },
  grading: { label: 'Baholash' },
};

export const JARGON = {
  mock: { label: 'Namuna fanlar', jargon: ['Mock', 'Mock Fanlar', 'MOCK'] },
  pre: { label: 'Tayyor testlar', jargon: ['PRE', 'PRE Testlar', 'PRE Test'] },
  characters: { label: 'Qahramonlar', jargon: ['Characters', 'Character'] },
  realtime: { label: "Jonli ko'p ishtirokchili o'yin", jargon: ['Real-time Multiplayer', 'Realtime'] },
  cast: { label: 'Jonli sessiya', jargon: ['Cast', 'CAST'] },
};

export function termLabel(key) {
  const t = TERMS[key] || JARGON[key];
  return t ? t.label : key;
}

export function approveJargon(text) {
  if (!text) return text;
  let out = String(text);
  // Eng uzun jargon birinchi almashtiriladi ("Mock Fanlar" -> "Mock" ichida qolmaydi).
  const all = [];
  Object.keys(JARGON).forEach((key) => {
    JARGON[key].jargon.forEach((j) => all.push({ j, label: JARGON[key].label }));
  });
  all.sort((a, b) => b.j.length - a.j.length);
  all.forEach((item) => {
    const esc = item.j.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.split(new RegExp(`\\b${esc}\\b`, 'g')).join(item.label);
  });
  return out;
}
