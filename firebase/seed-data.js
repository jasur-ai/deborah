/**
 * Deborah — Seed/Demo Ma'lumotlar (40+ fake data entries)
 * 
 * Local JSON database uchun to'liq demo ma'lumotlar.
 * Admin panelda ko'rinadigan barcha bo'limlar to'ldirilgan.
 * 
 * 🔐 Admin: admin / admin
 * 👤 User:  user / user
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

// ── Question generators ──
function makeQ(text, opts, correct) {
  return { text, options: opts, correct };
}

function makeFanQ(num, text, correctLetter, correctText, options) {
  return { num, text, correctLetter, correctText, options };
}

function makeFanOpt(text, letter, isCorrect) {
  return { text, letter, isCorrect };
}

// ── Bot emojis ──
const EMOJIS = ['🦊','🐺','🦁','🐯','🦝','🐲','🦄','🦅','🐸','🦑','🤖','👾','🦸','🧙','🥷','🦈','🐙','🦉','🦩','🎭'];

export function generateSeedData() {
  const data = {};

  // ═══════════════════════════════════════════════════════════════
  // 1. USERS — 45 ta foydalanuvchi
  // ═══════════════════════════════════════════════════════════════
  data.users = {};

  // ── Admin ──
  data.users['__admin__'] = {
    username: 'admin',
    password: hashPass('admin', 'admin'), // admin / admin
    created_at: ago(60),
  };

  // ── User ──
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
          makeQ('O\'zbekiston poytaxti?', ['Toshkent', 'Samarqand', 'Buxoro', 'Xiva'], 0),
          makeQ('1 + 1 = ?', ['1', '2', '3', '4'], 1),
          makeQ('Eng katta okean?', ['Atlantika', 'Tinch', 'Hind', 'Shimoliy'], 1),
          makeQ('HTML nimani anglatadi?', ['Hyper Text Markup Language', 'Home Tool Markup Language', 'Hyperlinks Text Markup Language', 'None'], 0),
          makeQ('CSS da fon rangi?', ['color', 'background-color', 'bg-color', 'font-color'], 1),
        ],
      },
    },
  };

  // ── 43 ta demo user ──
  const demoUsers = [
    { key: 'alisher', name: 'Alisher', pass: '1234', days: 25, tests: true },
    { key: 'malika', name: 'Malika', pass: '1234', days: 20, tests: false },
    { key: 'sardor', name: 'Sardor', pass: '1234', days: 18, tests: true },
    { key: 'nigora', name: 'Nigora', pass: '1234', days: 15, tests: false },
    { key: 'davron', name: 'Davron', pass: '1234', days: 28, tests: true },
    { key: 'nilufar', name: 'Nilufar', pass: '1234', days: 22, tests: false },
    { key: 'behruz', name: 'Behruz', pass: '1234', days: 12, tests: true },
    { key: 'zarnigor', name: 'Zarnigor', pass: '1234', days: 10, tests: false },
    { key: 'shoxrux', name: 'Shoxrux', pass: '1234', days: 8, tests: true },
    { key: 'munisa', name: 'Munisa', pass: '1234', days: 6, tests: false },
    { key: 'jahongir', name: 'Jahongir', pass: '1234', days: 35, tests: true },
    { key: 'gulnoza', name: 'Gulnoza', pass: '1234', days: 40, tests: false },
    { key: 'turgun', name: 'Turg\'un', pass: '1234', days: 32, tests: true },
    { key: 'odil', name: 'Odil', pass: '1234', days: 3, tests: false },
    { key: 'dildora', name: 'Dildora', pass: '1234', days: 5, tests: true },
    { key: 'islom', name: 'Islom', pass: '1234', days: 45, tests: false },
    { key: 'feruza', name: 'Feruza', pass: '1234', days: 50, tests: true },
    { key: 'rustam', name: 'Rustam', pass: '1234', days: 55, tests: false },
    { key: 'kamola', name: 'Kamola', pass: '1234', days: 16, tests: true },
    { key: 'jasmina', name: 'Jasmina', pass: '1234', days: 14, tests: false },
    { key: 'muhammad', name: 'Muhammad', pass: '1234', days: 11, tests: true },
    { key: 'zulfiya', name: 'Zulfiya', pass: '1234', days: 9, tests: false },
    { key: 'bobur', name: 'Bobur', pass: '1234', days: 7, tests: true },
    { key: 'rayhona', name: 'Rayhona', pass: '1234', days: 4, tests: false },
    { key: 'komil', name: 'Komil', pass: '1234', days: 2, tests: true },
    { key: 'nargiza', name: 'Nargiza', pass: '1234', days: 1, tests: false },
    { key: 'elyor', name: 'Elyor', pass: '1234', days: 38, tests: true },
    { key: 'nazokat', name: 'Nazokat', pass: '1234', days: 42, tests: false },
    { key: 'sanjar', name: 'Sanjar', pass: '1234', days: 26, tests: true },
    { key: 'mohinur', name: 'Mohinur', pass: '1234', days: 30, tests: false },
    { key: 'ulugbek', name: 'Ulug\'bek', pass: '1234', days: 33, tests: true },
    { key: 'shahlo', name: 'Shahlo', pass: '1234', days: 17, tests: false },
    { key: 'azamat', name: 'Azamat', pass: '1234', days: 13, tests: true },
    { key: 'karima', name: 'Karima', pass: '1234', days: 19, tests: false },
    { key: 'ravshan', name: 'Ravshan', pass: '1234', days: 48, tests: true },
    { key: 'lobar', name: 'Lobar', pass: '1234', days: 23, tests: false },
    { key: 'firdavs', name: 'Firdavs', pass: '1234', days: 27, tests: true },
    { key: 'sohiba', name: 'Sohiba', pass: '1234', days: 21, tests: false },
    { key: 'hamid', name: 'Hamid', pass: '1234', days: 31, tests: true },
    { key: 'madina', name: 'Madina', pass: '1234', days: 36, tests: false },
    { key: 'abdulla', name: 'Abdulla', pass: '1234', days: 41, tests: true },
    { key: 'parvin', name: 'Parvin', pass: '1234', days: 44, tests: false },
    { key: 'xurshid', name: 'Xurshid', pass: '1234', days: 29, tests: true },
    { key: 'nozima', name: 'Nozima', pass: '1234', days: 34, tests: false },
    { key: 'temur', name: 'Temur', pass: '1234', days: 37, tests: false },
    { key: 'hilola', name: 'Hilola', pass: '1234', days: 39, tests: false },
    { key: 'azizbek', name: 'Azizbek', pass: '1234', days: 43, tests: false },
    { key: 'shirin', name: 'Shirin', pass: '1234', days: 46, tests: false },
    { key: 'dilmurod', name: 'Dilmurod', pass: '1234', days: 47, tests: true },
    // ── Teacher hisob (real login: teacher / teacher34, VIP) ──
    { key: 'teacher', name: 'Teacher', pass: 'teacher34', days: 1, tests: false },
  ];

  // ── Role demo users (Prompt 68 — role-aware shell) ──
  // teacher/proctor/marker/board rollari workspace'lar uchun demo hisoblar.
  const ROLE_DEMO = {
    teacher: ['alisher', 'malika', 'teacher'],
    proctor: ['sardor'],
    marker: ['nigora'],
    board: ['feruza'],
  };

  demoUsers.forEach((u, idx) => {
    const userData = {
      username: u.name,
      password: hashPass(u.name, u.pass),
      created_at: ago(u.days),
    };

    // Prompt 68 — role tayinlash (default student).
    for (const [r, names] of Object.entries(ROLE_DEMO)) {
      if (names.includes(u.key)) {
        userData.role = r;
        break;
      }
    }
    if (!userData.role) userData.role = 'student';

    if (u.tests) {
      userData.tests = {};
      userData.tests[`test_${idx}`] = {
        name: `${u.name}ning Testi ${idx + 1}`,
        created_at: ago(u.days - 2),
        count: 5,
        questions: [
          makeQ(`Test savol ${idx + 1}.1`, ['Javob A', 'Javob B', 'Javob C', 'Javob D'], idx % 4),
          makeQ(`Test savol ${idx + 1}.2`, ['To\'g\'ri', 'Noto\'g\'ri', 'Bilmayman', 'Hech qaysi'], 0),
          makeQ(`Test savol ${idx + 1}.3`, ['1-variant', '2-variant', '3-variant', '4-variant'], 2),
          makeQ(`Test savol ${idx + 1}.4`, ['A variant', 'B variant', 'C variant', 'D variant'], 1),
          makeQ(`Test savol ${idx + 1}.5`, ['Ha', 'Yo\'q', 'Ikkalasi ham', 'Hech biri'], 0),
        ],
      };
    }

    data.users[u.key] = userData;
  });

  // ── VIP Demo Users (4 ta) ──
  ['sardor', 'feruza', 'shoxrux', 'teacher'].forEach(key => {
    if (data.users[key]) {
      data.users[key].isVip = true;
      data.users[key].vipGrantedAt = Date.now();
      data.users[key].vipGrantedBy = 'auto_seed';
      data.users[key].vipRevokedAt = null;
      data.users[key].vipPlainPassword = null;
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // 2. MOCK FANS — 25 ta fan (tayyor testlar)
  // ═══════════════════════════════════════════════════════════════
  data.mock_fans = {};

  data.mock_fans['fizika_mexanika'] = {
    name: 'Fizika — Mexanika',
    count: 10, createdAt: ago(50),
    questions: [
      makeFanQ(1, 'Nyutonning 1-qonuni nima nomlanadi?', 'A', 'Inersiya qonuni', [makeFanOpt('Inersiya qonuni','A',true),makeFanOpt('Dinamika qonuni','B',false),makeFanOpt('Ta\'sir va aks ta\'sir','C',false),makeFanOpt('Energiya saqlanish','D',false)]),
      makeFanQ(2, 'Tezlanish formulasi?', 'B', 'a = F/m', [makeFanOpt('a = m/F','A',false),makeFanOpt('a = F/m','B',true),makeFanOpt('a = v·t','C',false),makeFanOpt('a = m·v','D',false)]),
      makeFanQ(3, 'Kuch birligi?', 'C', 'N (Nyuton)', [makeFanOpt('J','A',false),makeFanOpt('Vt','B',false),makeFanOpt('N (Nyuton)','C',true),makeFanOpt('Pa','D',false)]),
      makeFanQ(4, 'Erkin tushish tezlanishi g = ?', 'A', '9.8 m/s²', [makeFanOpt('9.8 m/s²','A',true),makeFanOpt('8.9 m/s²','B',false),makeFanOpt('10 m/s²','C',false),makeFanOpt('7.6 m/s²','D',false)]),
      makeFanQ(5, 'Ish formulasi?', 'D', 'A = F·s·cosα', [makeFanOpt('A = F·s','A',false),makeFanOpt('A = m·g·h','B',false),makeFanOpt('A = F·v','C',false),makeFanOpt('A = F·s·cosα','D',true)]),
      makeFanQ(6, 'Quvvat birligi?', 'B', 'Vt (Vatt)', [makeFanOpt('J','A',false),makeFanOpt('Vt (Vatt)','B',true),makeFanOpt('N·m','C',false),makeFanOpt('J/s','D',false)]),
      makeFanQ(7, 'Impuls formulasi?', 'C', 'p = m·v', [makeFanOpt('p = m·a','A',false),makeFanOpt('p = F·t','B',false),makeFanOpt('p = m·v','C',true),makeFanOpt('p = E·t','D',false)]),
      makeFanQ(8, 'Energiya saqlanish qonuni?', 'A', 'Energiya yo\'qolmaydi, faqat aylanadi', [makeFanOpt('Energiya yo\'qolmaydi','A',true),makeFanOpt('Energiya ko\'payadi','B',false),makeFanOpt('Energiya kamayadi','C',false),makeFanOpt('Energiya o\'zgarmaydi','D',false)]),
      makeFanQ(9, 'Ishqalanish kuchi formulasi?', 'D', 'F = μ·N', [makeFanOpt('F = μ·m','A',false),makeFanOpt('F = μ·g','B',false),makeFanOpt('F = N/μ','C',false),makeFanOpt('F = μ·N','D',true)]),
      makeFanQ(10, 'Markazga intilma tezlanish?', 'B', 'a = v²/R', [makeFanOpt('a = v/R','A',false),makeFanOpt('a = v²/R','B',true),makeFanOpt('a = ω²·R','C',false),makeFanOpt('a = ω·R','D',false)]),
    ],
  };

  data.mock_fans['fizika_optika'] = {
    name: 'Fizika — Optika',
    count: 8, createdAt: ago(45),
    questions: [
      makeFanQ(1, 'Yorug\'lik tezligi (vakuumda)?', 'C', '3·10⁸ m/s', [makeFanOpt('3·10⁶ m/s','A',false),makeFanOpt('3·10⁷ m/s','B',false),makeFanOpt('3·10⁸ m/s','C',true),makeFanOpt('3·10⁹ m/s','D',false)]),
      makeFanQ(2, 'Yorug\'likning sinish qonuni?', 'A', 'Snell qonuni', [makeFanOpt('Snell qonuni','A',true),makeFanOpt('Nyuton qonuni','B',false),makeFanOpt('Guk qonuni','C',false),makeFanOpt('Faradey qonuni','D',false)]),
      makeFanQ(3, 'Linsaning optik kuchi birligi?', 'B', 'D (dioptriya)', [makeFanOpt('m','A',false),makeFanOpt('D (dioptriya)','B',true),makeFanOpt('F','C',false),makeFanOpt('Lm','D',false)]),
      makeFanQ(4, 'Yorug\'lik dispersiyasini kashf etgan?', 'C', 'I. Nyuton', [makeFanOpt('Eynshteyn','A',false),makeFanOpt('Galiley','B',false),makeFanOpt('I. Nyuton','C',true),makeFanOpt('Maksvell','D',false)]),
      makeFanQ(5, 'Qaysi rang eng katta to\'lqin uzunligiga ega?', 'A', 'Qizil', [makeFanOpt('Qizil','A',true),makeFanOpt('Ko\'k','B',false),makeFanOpt('Yashil','C',false),makeFanOpt('Binafsha','D',false)]),
      makeFanQ(6, 'Ko\'zning optik sistemasi?', 'D', 'Linza + to\'r parda', [makeFanOpt('Faqat linza','A',false),makeFanOpt('Faqat to\'r parda','B',false),makeFanOpt('Shox parda','C',false),makeFanOpt('Linza + to\'r parda','D',true)]),
      makeFanQ(7, 'Fotoapparatda linza?', 'B', 'Yig\'uvchi linza', [makeFanOpt('Sochuvchi linza','A',false),makeFanOpt('Yig\'uvchi linza','B',true),makeFanOpt('Ikki linza','C',false),makeFanOpt('Yassi oyna','D',false)]),
      makeFanQ(8, 'Interferensiya nima?', 'C', 'To\'lqinlarning qo\'shilishi', [makeFanOpt('To\'lqinlarning sochilishi','A',false),makeFanOpt('To\'lqinlarning yutilishi','B',false),makeFanOpt('To\'lqinlarning qo\'shilishi','C',true),makeFanOpt('To\'lqinlarning aylanishi','D',false)]),
    ],
  };

  data.mock_fans['kimyo_organik'] = {
    name: 'Kimyo — Organik',
    count: 10, createdAt: ago(55),
    questions: [
      makeFanQ(1, 'Organik moddalar asosini qaysi element tashkil qiladi?', 'A', 'Uglerod', [makeFanOpt('Uglerod','A',true),makeFanOpt('Vodorod','B',false),makeFanOpt('Kislorod','C',false),makeFanOpt('Azot','D',false)]),
      makeFanQ(2, 'Metan formulasi?', 'B', 'CH₄', [makeFanOpt('C₂H₆','A',false),makeFanOpt('CH₄','B',true),makeFanOpt('C₃H₈','C',false),makeFanOpt('C₄H₁₀','D',false)]),
      makeFanQ(3, 'Benzol formulasi?', 'C', 'C₆H₆', [makeFanOpt('C₆H₁₂','A',false),makeFanOpt('C₆H₁₄','B',false),makeFanOpt('C₆H₆','C',true),makeFanOpt('C₆H₁₀','D',false)]),
      makeFanQ(4, 'Spirtlarning umumiy formulasi?', 'A', 'R-OH', [makeFanOpt('R-OH','A',true),makeFanOpt('R-COOH','B',false),makeFanOpt('R-CHO','C',false),makeFanOpt('R-NH₂','D',false)]),
      makeFanQ(5, 'Efir qanday birikma?', 'D', 'R-O-R\'', [makeFanOpt('R-COOH','A',false),makeFanOpt('R-OH','B',false),makeFanOpt('R-CHO','C',false),makeFanOpt('R-O-R\'','D',true)]),
      makeFanQ(6, 'Polimerlanish nima?', 'B', 'Monomerlardan polimer hosil qilish', [makeFanOpt('Polimerni monomerlarga ajratish','A',false),makeFanOpt('Monomerlardan polimer hosil qilish','B',true),makeFanOpt('Polimerni eritish','C',false),makeFanOpt('Polimerni quritish','D',false)]),
      makeFanQ(7, 'Glukoza formulasi?', 'C', 'C₆H₁₂O₆', [makeFanOpt('C₁₂H₂₂O₁₁','A',false),makeFanOpt('C₆H₁₀O₅','B',false),makeFanOpt('C₆H₁₂O₆','C',true),makeFanOpt('C₅H₁₀O₅','D',false)]),
      makeFanQ(8, 'Aminokislotalarda qanday guruh bor?', 'A', '-NH₂ va -COOH', [makeFanOpt('-NH₂ va -COOH','A',true),makeFanOpt('-OH va -CHO','B',false),makeFanOpt('-COOH va -OH','C',false),makeFanOpt('-NH₂ va -OH','D',false)]),
    ],
  };

  data.mock_fans['kimyo_anorganik'] = {
    name: 'Kimyo — Anorganik',
    count: 8, createdAt: ago(40),
    questions: [
      makeFanQ(1, 'Suvning formulasi?', 'A', 'H₂O', [makeFanOpt('H₂O','A',true),makeFanOpt('H₂O₂','B',false),makeFanOpt('HO','C',false),makeFanOpt('H₂O₃','D',false)]),
      makeFanQ(2, 'Kislota va asos reaksiyasi?', 'B', 'Neytrallanish', [makeFanOpt('Oksidlanish','A',false),makeFanOpt('Neytrallanish','B',true),makeFanOpt('Qaytarilish','C',false),makeFanOpt('Parchalanish','D',false)]),
      makeFanQ(3, 'Davriy jadvalda nechta element bor?', 'C', '118', [makeFanOpt('100','A',false),makeFanOpt('110','B',false),makeFanOpt('118','C',true),makeFanOpt('120','D',false)]),
      makeFanQ(4, 'Natriyning kimyoviy belgisi?', 'D', 'Na', [makeFanOpt('N','A',false),makeFanOpt('Ni','B',false),makeFanOpt('Ne','C',false),makeFanOpt('Na','D',true)]),
      makeFanQ(5, 'pH < 7 bo\'lsa, muhit?', 'A', 'Kislotali', [makeFanOpt('Kislotali','A',true),makeFanOpt('Ishqoriy','B',false),makeFanOpt('Neytral','C',false),makeFanOpt('Amfoter','D',false)]),
      makeFanQ(6, 'Galogenlar qaysi guruhda?', 'C', 'VII guruh', [makeFanOpt('I guruh','A',false),makeFanOpt('III guruh','B',false),makeFanOpt('VII guruh','C',true),makeFanOpt('VIII guruh','D',false)]),
      makeFanQ(7, 'Eng yengil gaz?', 'B', 'Vodorod', [makeFanOpt('Kislorod','A',false),makeFanOpt('Vodorod','B',true),makeFanOpt('Azot','C',false),makeFanOpt('Geliy','D',false)]),
      makeFanQ(8, 'Tuz formulasi (osh tuzi)?', 'A', 'NaCl', [makeFanOpt('NaCl','A',true),makeFanOpt('KCl','B',false),makeFanOpt('Na₂CO₃','C',false),makeFanOpt('NaHCO₃','D',false)]),
    ],
  };

  data.mock_fans['biologiya_genetika'] = {
    name: 'Biologiya — Genetika',
    count: 8, createdAt: ago(48),
    questions: [
      makeFanQ(1, 'DNK ning to\'liq shakli?', 'A', 'Dezoksiribonuklein kislota', [makeFanOpt('Dezoksiribonuklein kislota','A',true),makeFanOpt('Ribonuklein kislota','B',false),makeFanOpt('Nuklein kislota','C',false),makeFanOpt('Aminokislota','D',false)]),
      makeFanQ(2, 'Genetik kod birligi?', 'B', 'Kodon', [makeFanOpt('Nukleotid','A',false),makeFanOpt('Kodon','B',true),makeFanOpt('Gen','C',false),makeFanOpt('Antikodon','D',false)]),
      makeFanQ(3, 'Mendel nechta qonun kashf etgan?', 'C', '3 ta', [makeFanOpt('1 ta','A',false),makeFanOpt('2 ta','B',false),makeFanOpt('3 ta','C',true),makeFanOpt('4 ta','D',false)]),
      makeFanQ(4, 'Odamda nechta xromosoma?', 'D', '46', [makeFanOpt('44','A',false),makeFanOpt('45','B',false),makeFanOpt('47','C',false),makeFanOpt('46','D',true)]),
      makeFanQ(5, 'RNK tarkibidagi asoslar?', 'A', 'A,U,G,S', [makeFanOpt('A,U,G,S','A',true),makeFanOpt('A,T,G,S','B',false),makeFanOpt('A,U,T,G','C',false),makeFanOpt('U,G,S,T','D',false)]),
      makeFanQ(6, 'Gen nima?', 'B', 'DNK bo\'lagi', [makeFanOpt('RNK bo\'lagi','A',false),makeFanOpt('DNK bo\'lagi','B',true),makeFanOpt('Oqsil','C',false),makeFanOpt('Xromosoma','D',false)]),
      makeFanQ(7, 'Mutatsiya nima?', 'C', 'Genlarning o\'zgarishi', [makeFanOpt('Genlarning ko\'payishi','A',false),makeFanOpt('Genlarning kamayishi','B',false),makeFanOpt('Genlarning o\'zgarishi','C',true),makeFanOpt('Genlarning yo\'qolishi','D',false)]),
      makeFanQ(8, 'Irsiyat moddiy asosi?', 'B', 'DNK', [makeFanOpt('RNK','A',false),makeFanOpt('DNK','B',true),makeFanOpt('Oqsil','C',false),makeFanOpt('Lipid','D',false)]),
    ],
  };

  data.mock_fans['matematika_algebra'] = {
    name: 'Matematika — Algebra',
    count: 10, createdAt: ago(60),
    questions: [
      makeFanQ(1, 'x² - 5x + 6 = 0 ildizlari?', 'A', '2 va 3', [makeFanOpt('2 va 3','A',true),makeFanOpt('-2 va -3','B',false),makeFanOpt('1 va 6','C',false),makeFanOpt('-1 va 6','D',false)]),
      makeFanQ(2, '(a + b)² = ?', 'D', 'a² + 2ab + b²', [makeFanOpt('a² + b²','A',false),makeFanOpt('a² - 2ab + b²','B',false),makeFanOpt('a² + ab + b²','C',false),makeFanOpt('a² + 2ab + b²','D',true)]),
      makeFanQ(3, 'log₂(64) = ?', 'B', '6', [makeFanOpt('5','A',false),makeFanOpt('6','B',true),makeFanOpt('32','C',false),makeFanOpt('8','D',false)]),
      makeFanQ(4, '√169 = ?', 'C', '13', [makeFanOpt('11','A',false),makeFanOpt('12','B',false),makeFanOpt('13','C',true),makeFanOpt('14','D',false)]),
      makeFanQ(5, '5! = ?', 'A', '120', [makeFanOpt('120','A',true),makeFanOpt('60','B',false),makeFanOpt('240','C',false),makeFanOpt('100','D',false)]),
      makeFanQ(6, '| -15 | = ?', 'D', '15', [makeFanOpt('-15','A',false),makeFanOpt('0','B',false),makeFanOpt('30','C',false),makeFanOpt('15','D',true)]),
      makeFanQ(7, '2⁸ = ?', 'B', '256', [makeFanOpt('128','A',false),makeFanOpt('256','B',true),makeFanOpt('512','C',false),makeFanOpt('64','D',false)]),
      makeFanQ(8, 'Kvadrat tenglama formulasi?', 'C', 'ax² + bx + c = 0', [makeFanOpt('ax + b = 0','A',false),makeFanOpt('ax² + c = 0','B',false),makeFanOpt('ax² + bx + c = 0','C',true),makeFanOpt('ax² + bx = 0','D',false)]),
    ],
  };

  data.mock_fans['matematika_geometriya'] = {
    name: 'Matematika — Geometriya',
    count: 8, createdAt: ago(35),
    questions: [
      makeFanQ(1, 'Uchburchak yuzi formulasi?', 'A', 'S = (a·h)/2', [makeFanOpt('S = (a·h)/2','A',true),makeFanOpt('S = a·b','B',false),makeFanOpt('S = a·h','C',false),makeFanOpt('S = 2a·h','D',false)]),
      makeFanQ(2, 'Aylana uzunligi?', 'B', 'l = 2πR', [makeFanOpt('l = πR','A',false),makeFanOpt('l = 2πR','B',true),makeFanOpt('l = πR²','C',false),makeFanOpt('l = 4πR','D',false)]),
      makeFanQ(3, 'Kubning hajmi?', 'C', 'V = a³', [makeFanOpt('V = a²','A',false),makeFanOpt('V = 6a²','B',false),makeFanOpt('V = a³','C',true),makeFanOpt('V = 4a³','D',false)]),
      makeFanQ(4, 'To\'g\'ri burchakli uchburchakda gipotenuza?', 'D', 'c² = a² + b²', [makeFanOpt('c = a + b','A',false),makeFanOpt('c² = a² - b²','B',false),makeFanOpt('c = a·b','C',false),makeFanOpt('c² = a² + b²','D',true)]),
      makeFanQ(5, 'Doira yuzi?', 'A', 'S = πR²', [makeFanOpt('S = πR²','A',true),makeFanOpt('S = 2πR','B',false),makeFanOpt('S = πR','C',false),makeFanOpt('S = 4πR²','D',false)]),
      makeFanQ(6, 'Parallelepiped hajmi?', 'B', 'V = abc', [makeFanOpt('V = a³','A',false),makeFanOpt('V = abc','B',true),makeFanOpt('V = 2ab + 2bc + 2ac','C',false),makeFanOpt('V = ab','D',false)]),
      makeFanQ(7, 'Uchburchak ichki burchaklari yig\'indisi?', 'A', '180°', [makeFanOpt('180°','A',true),makeFanOpt('90°','B',false),makeFanOpt('270°','C',false),makeFanOpt('360°','D',false)]),
      makeFanQ(8, 'Sfera hajmi?', 'C', 'V = (4/3)πR³', [makeFanOpt('V = 4πR²','A',false),makeFanOpt('V = (2/3)πR³','B',false),makeFanOpt('V = (4/3)πR³','C',true),makeFanOpt('V = πR²h','D',false)]),
    ],
  };

  data.mock_fans['tarix_jahon'] = {
    name: 'Tarix — Jahon',
    count: 8, createdAt: ago(42),
    questions: [
      makeFanQ(1, 'Birinchi jahon urushi qachon boshlangan?', 'A', '1914', [makeFanOpt('1914','A',true),makeFanOpt('1915','B',false),makeFanOpt('1913','C',false),makeFanOpt('1916','D',false)]),
      makeFanQ(2, 'Fransuz inqilobi yili?', 'B', '1789', [makeFanOpt('1787','A',false),makeFanOpt('1789','B',true),makeFanOpt('1791','C',false),makeFanOpt('1793','D',false)]),
      makeFanQ(3, 'Rim imperiyasi qachon qulagan?', 'C', '476', [makeFanOpt('395','A',false),makeFanOpt('410','B',false),makeFanOpt('476','C',true),makeFanOpt('500','D',false)]),
      makeFanQ(4, 'Magna Carta qachon qabul qilingan?', 'D', '1215', [makeFanOpt('1066','A',false),makeFanOpt('1100','B',false),makeFanOpt('1189','C',false),makeFanOpt('1215','D',true)]),
      makeFanQ(5, 'Kolumb Amerikani kashf qilgan yil?', 'B', '1492', [makeFanOpt('1488','A',false),makeFanOpt('1492','B',true),makeFanOpt('1500','C',false),makeFanOpt('1498','D',false)]),
      makeFanQ(6, 'Buyuk ipak yo\'li qayerdan boshlangan?', 'A', 'Xitoy', [makeFanOpt('Xitoy','A',true),makeFanOpt('Hindiston','B',false),makeFanOpt('Eron','C',false),makeFanOpt('Misr','D',false)]),
      makeFanQ(7, 'Mustaqillik Deklaratsiyasi (AQSh) yili?', 'C', '1776', [makeFanOpt('1774','A',false),makeFanOpt('1775','B',false),makeFanOpt('1776','C',true),makeFanOpt('1777','D',false)]),
      makeFanQ(8, 'BMT qachon tashkil etilgan?', 'D', '1945', [makeFanOpt('1939','A',false),makeFanOpt('1941','B',false),makeFanOpt('1943','C',false),makeFanOpt('1945','D',true)]),
    ],
  };

  data.mock_fans['tarix_uzbekiston'] = {
    name: 'Tarix — O\'zbekiston',
    count: 8, createdAt: ago(38),
    questions: [
      makeFanQ(1, 'Amir Temur qachon tug\'ilgan?', 'A', '1336', [makeFanOpt('1336','A',true),makeFanOpt('1340','B',false),makeFanOpt('1328','C',false),makeFanOpt('1350','D',false)]),
      makeFanQ(2, 'Mustaqillik e\'lon qilingan sana?', 'B', '1 Sentyabr 1991', [makeFanOpt('31 Avgust 1991','A',false),makeFanOpt('1 Sentyabr 1991','B',true),makeFanOpt('8 Dekabr 1991','C',false),makeFanOpt('1 Yanvar 1992','D',false)]),
      makeFanQ(3, 'Mirzo Ulug\'bek rasadxonasi?', 'C', 'Samarqandda', [makeFanOpt('Buxoroda','A',false),makeFanOpt('Toshkentda','B',false),makeFanOpt('Samarqandda','C',true),makeFanOpt('Xivada','D',false)]),
      makeFanQ(4, 'Alisher Navoiy asarlari soni?', 'D', '30 dan ortiq', [makeFanOpt('20 ta','A',false),makeFanOpt('25 ta','B',false),makeFanOpt('28 ta','C',false),makeFanOpt('30 dan ortiq','D',true)]),
      makeFanQ(5, 'Buxoro amirligi tugatilgan yil?', 'A', '1920', [makeFanOpt('1920','A',true),makeFanOpt('1918','B',false),makeFanOpt('1924','C',false),makeFanOpt('1917','D',false)]),
      makeFanQ(6, 'Konstitutsiya qabul qilingan yil?', 'C', '1992', [makeFanOpt('1990','A',false),makeFanOpt('1991','B',false),makeFanOpt('1992','C',true),makeFanOpt('1993','D',false)]),
      makeFanQ(7, 'Shayboniylar sulolasi davri?', 'B', 'XVI asr', [makeFanOpt('XV asr','A',false),makeFanOpt('XVI asr','B',true),makeFanOpt('XVII asr','C',false),makeFanOpt('XVIII asr','D',false)]),
      makeFanQ(8, 'Qadimgi Xorazm poytaxti?', 'D', 'Ko\'hna Urganch', [makeFanOpt('Xiva','A',false),makeFanOpt('Termiz','B',false),makeFanOpt('Buxoro','C',false),makeFanOpt('Ko\'hna Urganch','D',true)]),
    ],
  };

  data.mock_fans['adabiyot_uzbek'] = {
    name: 'Adabiyot — O\'zbek',
    count: 8, createdAt: ago(33),
    questions: [
      makeFanQ(1, '"Xamsa" asarining muallifi?', 'A', 'Alisher Navoiy', [makeFanOpt('Alisher Navoiy','A',true),makeFanOpt('Bobur','B',false),makeFanOpt('Furqat','C',false),makeFanOpt('Ogahiy','D',false)]),
      makeFanQ(2, 'Abdulla Qodiriy qanday asar yozgan?', 'B', 'O\'tgan kunlar', [makeFanOpt('Yulduzli tunlar','A',false),makeFanOpt('O\'tgan kunlar','B',true),makeFanOpt('Kecha va kunduz','C',false),makeFanOpt('Ikki eshik orasi','D',false)]),
      makeFanQ(3, '"Alpomish" dostonining qahramoni?', 'C', 'Alpomish', [makeFanOpt('Barchin','A',false),makeFanOpt('Qorajon','B',false),makeFanOpt('Alpomish','C',true),makeFanOpt('Hakimbek','D',false)]),
      makeFanQ(4, 'Hamid Olimjon qanday shoir?', 'A', 'Lirik shoir', [makeFanOpt('Lirik shoir','A',true),makeFanOpt('Dramaturg','B',false),makeFanOpt('Nasrnavis','C',false),makeFanOpt('Shoir va tarjimon','D',false)]),
      makeFanQ(5, 'Erkin Vohidov asarlari?', 'B', 'Yoshlik devoni', [makeFanOpt('Guliston','A',false),makeFanOpt('Yoshlik devoni','B',true),makeFanOpt('O\'tkan kunlar','C',false),makeFanOpt('Navbahor','D',false)]),
      makeFanQ(6, 'Oybek qanday asar muallifi?', 'D', 'Navoiy', [makeFanOpt('Alisher Navoiy','A',false),makeFanOpt('Tanlangan asarlar','B',false),makeFanOpt('Bolalik','C',false),makeFanOpt('Navoiy','D',true)]),
      makeFanQ(7, 'Bobur qanday asar yozgan?', 'C', 'Boburnoma', [makeFanOpt('Devon','A',false),makeFanOpt('Xamsa','B',false),makeFanOpt('Boburnoma','C',true),makeFanOpt('Guliston','D',false)]),
      makeFanQ(8, 'Cho\'lpon qanday shoir?', 'A', 'Milliy uyg\'onish davri', [makeFanOpt('Milliy uyg\'onish davri','A',true),makeFanOpt('Sovet davri','B',false),makeFanOpt('Mustaqillik davri','C',false),makeFanOpt('XX asr boshi','D',false)]),
    ],
  };

  data.mock_fans['geografiya'] = {
    name: 'Geografiya',
    count: 8, createdAt: ago(28),
    questions: [
      makeFanQ(1, 'Eng katta davlat?', 'C', 'Rossiya', [makeFanOpt('AQSh','A',false),makeFanOpt('Xitoy','B',false),makeFanOpt('Rossiya','C',true),makeFanOpt('Kanada','D',false)]),
      makeFanQ(2, 'Eng ko\'p aholili davlat?', 'A', 'Hindiston', [makeFanOpt('Hindiston','A',true),makeFanOpt('Xitoy','B',false),makeFanOpt('AQSh','C',false),makeFanOpt('Indoneziya','D',false)]),
      makeFanQ(3, 'Eng uzun daryo?', 'B', 'Nil', [makeFanOpt('Amazon','A',false),makeFanOpt('Nil','B',true),makeFanOpt('Missisipi','C',false),makeFanOpt('Xuanxe','D',false)]),
      makeFanQ(4, 'Eng katta cho\'l?', 'C', 'Sahroi Kabir', [makeFanOpt('Gobi','A',false),makeFanOpt('Karakum','B',false),makeFanOpt('Sahroi Kabir','C',true),makeFanOpt('Kizilkum','D',false)]),
      makeFanQ(5, 'Eng baland cho\'qqi?', 'D', 'Everest', [makeFanOpt('K2','A',false),makeFanOpt('Kangchenjunga','B',false),makeFanOpt('Lhotse','C',false),makeFanOpt('Everest','D',true)]),
      makeFanQ(6, 'O\'zbekiston maydoni?', 'A', '448 978 km²', [makeFanOpt('448 978 km²','A',true),makeFanOpt('348 978 km²','B',false),makeFanOpt('548 978 km²','C',false),makeFanOpt('248 978 km²','D',false)]),
      makeFanQ(7, 'Eng chuqur ko\'l?', 'B', 'Baykal', [makeFanOpt('Kaspiy','A',false),makeFanOpt('Baykal','B',true),makeFanOpt('Tanganyika','C',false),makeFanOpt('Chad','D',false)]),
      makeFanQ(8, 'Yer nechanchi sayyora?', 'C', '3', [makeFanOpt('1','A',false),makeFanOpt('2','B',false),makeFanOpt('3','C',true),makeFanOpt('4','D',false)]),
    ],
  };

  data.mock_fans['informatika'] = {
    name: 'Informatika',
    count: 8, createdAt: ago(25),
    questions: [
      makeFanQ(1, '1 MB = ? bayt', 'B', '1 048 576', [makeFanOpt('1 000 000','A',false),makeFanOpt('1 048 576','B',true),makeFanOpt('1 000 024','C',false),makeFanOpt('1 024 000','D',false)]),
      makeFanQ(2, 'IP address necha bit?', 'D', '32', [makeFanOpt('8','A',false),makeFanOpt('16','B',false),makeFanOpt('24','C',false),makeFanOpt('32','D',true)]),
      makeFanQ(3, 'SQL ma\'lumot olish?', 'A', 'SELECT', [makeFanOpt('SELECT','A',true),makeFanOpt('GET','B',false),makeFanOpt('FETCH','C',false),makeFanOpt('FIND','D',false)]),
      makeFanQ(4, 'HTML giperhavola?', 'C', '<a>', [makeFanOpt('<link>','A',false),makeFanOpt('<href>','B',false),makeFanOpt('<a>','C',true),makeFanOpt('<url>','D',false)]),
      makeFanQ(5, 'OOP da encapsulation?', 'D', 'Ma\'lumotni yashirish', [makeFanOpt('Meros olish','A',false),makeFanOpt('Polimorfizm','B',false),makeFanOpt('Abstraksiya','C',false),makeFanOpt('Ma\'lumotni yashirish','D',true)]),
      makeFanQ(6, 'Git commit nima?', 'B', 'O\'zgarishlarni saqlash', [makeFanOpt('Faylni yuklash','A',false),makeFanOpt('O\'zgarishlarni saqlash','B',true),makeFanOpt('Filial yaratish','C',false),makeFanOpt('Repository clone','D',false)]),
      makeFanQ(7, 'JSON to\'liq nomi?', 'A', 'JavaScript Object Notation', [makeFanOpt('JavaScript Object Notation','A',true),makeFanOpt('Java Standard Output','B',false),makeFanOpt('Java Serialized Object','C',false),makeFanOpt('Just Simple Object Name','D',false)]),
      makeFanQ(8, '255 ni ikkilikda?', 'C', '11111111', [makeFanOpt('11111110','A',false),makeFanOpt('10101010','B',false),makeFanOpt('11111111','C',true),makeFanOpt('11001100','D',false)]),
    ],
  };

  data.mock_fans['ingliz_tili'] = {
    name: 'Ingliz Tili — Grammar',
    count: 8, createdAt: ago(30),
    questions: [
      makeFanQ(1, 'I ___ a student.', 'B', 'am', [makeFanOpt('is','A',false),makeFanOpt('am','B',true),makeFanOpt('are','C',false),makeFanOpt('be','D',false)]),
      makeFanQ(2, 'She ___ to school every day.', 'C', 'goes', [makeFanOpt('go','A',false),makeFanOpt('going','B',false),makeFanOpt('goes','C',true),makeFanOpt('went','D',false)]),
      makeFanQ(3, 'Present Perfect: They ___ finished.', 'A', 'have', [makeFanOpt('have','A',true),makeFanOpt('has','B',false),makeFanOpt('had','C',false),makeFanOpt('having','D',false)]),
      makeFanQ(4, 'Comparative of "big"?', 'B', 'bigger', [makeFanOpt('more big','A',false),makeFanOpt('bigger','B',true),makeFanOpt('biggest','C',false),makeFanOpt('bigly','D',false)]),
      makeFanQ(5, '"Much" is used with?', 'A', 'Uncountable nouns', [makeFanOpt('Uncountable nouns','A',true),makeFanOpt('Countable nouns','B',false),makeFanOpt('Both','C',false),makeFanOpt('Plural','D',false)]),
      makeFanQ(6, 'Future: We ___ meet tomorrow.', 'D', 'will', [makeFanOpt('are','A',false),makeFanOpt('is','B',false),makeFanOpt('going','C',false),makeFanOpt('will','D',true)]),
      makeFanQ(7, 'Passive: The book ___ by Twain.', 'C', 'was written', [makeFanOpt('wrote','A',false),makeFanOpt('is writing','B',false),makeFanOpt('was written','C',true),makeFanOpt('has written','D',false)]),
      makeFanQ(8, '___ apple a day keeps...', 'A', 'An', [makeFanOpt('An','A',true),makeFanOpt('A','B',false),makeFanOpt('The','C',false),makeFanOpt('No article','D',false)]),
    ],
  };

  data.mock_fans['astronomiya'] = {
    name: 'Astronomiya',
    count: 6, createdAt: ago(20),
    questions: [
      makeFanQ(1, 'Quyoshga eng yaqin sayyora?', 'A', 'Merkuriy', [makeFanOpt('Merkuriy','A',true),makeFanOpt('Venera','B',false),makeFanOpt('Yer','C',false),makeFanOpt('Mars','D',false)]),
      makeFanQ(2, 'Quyosh sistemasi sayyoralari soni?', 'C', '8 ta', [makeFanOpt('7 ta','A',false),makeFanOpt('9 ta','B',false),makeFanOpt('8 ta','C',true),makeFanOpt('10 ta','D',false)]),
      makeFanQ(3, 'Eng katta sayyora?', 'B', 'Yupiter', [makeFanOpt('Saturn','A',false),makeFanOpt('Yupiter','B',true),makeFanOpt('Neptun','C',false),makeFanOpt('Uran','D',false)]),
      makeFanQ(4, 'Oy Yerdan qancha masofa?', 'D', '384 400 km', [makeFanOpt('100 000 km','A',false),makeFanOpt('200 000 km','B',false),makeFanOpt('300 000 km','C',false),makeFanOpt('384 400 km','D',true)]),
      makeFanQ(5, 'Quyosh yoshi?', 'A', '4.6 mlrd yil', [makeFanOpt('4.6 mlrd yil','A',true),makeFanOpt('2.3 mlrd yil','B',false),makeFanOpt('10 mlrd yil','C',false),makeFanOpt('1 mlrd yil','D',false)]),
      makeFanQ(6, 'Somon yo\'li galaktikasi turi?', 'B', 'Spiral', [makeFanOpt('Elliptik','A',false),makeFanOpt('Spiral','B',true),makeFanOpt('Noto\'g\'ri','C',false),makeFanOpt('Halqasimon','D',false)]),
    ],
  };

  data.mock_fans['ekologiya'] = {
    name: 'Ekologiya',
    count: 6, createdAt: ago(18),
    questions: [
      makeFanQ(1, 'Ozon qavati qayerda joylashgan?', 'B', 'Stratosferada', [makeFanOpt('Troposferada','A',false),makeFanOpt('Stratosferada','B',true),makeFanOpt('Mezosferada','C',false),makeFanOpt('Termosferada','D',false)]),
      makeFanQ(2, 'Issiqxona gazi?', 'A', 'CO₂', [makeFanOpt('CO₂','A',true),makeFanOpt('O₂','B',false),makeFanOpt('N₂','C',false),makeFanOpt('H₂','D',false)]),
      makeFanQ(3, 'Qayta tiklanuvchi energiya turi?', 'C', 'Quyosh energiyasi', [makeFanOpt('Ko\'mir','A',false),makeFanOpt('Neft','B',false),makeFanOpt('Quyosh energiyasi','C',true),makeFanOpt('Gaz','D',false)]),
      makeFanQ(4, 'Global isish nima?', 'D', 'Yer haroratining oshishi', [makeFanOpt('Yer haroratining tushishi','A',false),makeFanOpt('Dengiz sathining pasayishi','B',false),makeFanOpt('Muzliklarning ko\'payishi','C',false),makeFanOpt('Yer haroratining oshishi','D',true)]),
      makeFanQ(5, 'Eng ko\'p kislorod ishlab chiqaruvchi?', 'A', 'Okean fitoplanktoni', [makeFanOpt('Okean fitoplanktoni','A',true),makeFanOpt('O\'rmonlar','B',false),makeFanOpt('Dalalar','C',false),makeFanOpt('Botqoqlar','D',false)]),
      makeFanQ(6, 'Biologik xilma-xillik nima?', 'C', 'Turlarning xilma-xilligi', [makeFanOpt('Turlarning soni','A',false),makeFanOpt('O\'simliklarning xilma-xilligi','B',false),makeFanOpt('Turlarning xilma-xilligi','C',true),makeFanOpt('Hayvonlarning xilma-xilligi','D',false)]),
    ],
  };

  data.mock_fans['huquq'] = {
    name: 'Huquqshunoslik — Konstitutsiya',
    count: 6, createdAt: ago(22),
    questions: [
      makeFanQ(1, 'O\'zbekiston Konstitutsiyasi necha bob?', 'B', '6 bob', [makeFanOpt('5 bob','A',false),makeFanOpt('6 bob','B',true),makeFanOpt('7 bob','C',false),makeFanOpt('8 bob','D',false)]),
      makeFanQ(2, 'O\'zbekiston Prezidenti vakolati muddati?', 'C', '5 yil', [makeFanOpt('4 yil','A',false),makeFanOpt('6 yil','B',false),makeFanOpt('5 yil','C',true),makeFanOpt('7 yil','D',false)]),
      makeFanQ(3, 'Oliy Majlis necha palatadan iborat?', 'A', '2 palata', [makeFanOpt('2 palata','A',true),makeFanOpt('1 palata','B',false),makeFanOpt('3 palata','C',false),makeFanOpt('4 palata','D',false)]),
      makeFanQ(4, 'Sud hokimiyati mustaqil?', 'D', 'Ha, mustaqil', [makeFanOpt('Yo\'q','A',false),makeFanOpt('Qisman','B',false),makeFanOpt('Ijro hokimiyatiga bo\'ysunadi','C',false),makeFanOpt('Ha, mustaqil','D',true)]),
      makeFanQ(5, 'Inson huquqlari necha avlod?', 'B', '3 avlod', [makeFanOpt('2 avlod','A',false),makeFanOpt('3 avlod','B',true),makeFanOpt('4 avlod','C',false),makeFanOpt('1 avlod','D',false)]),
      makeFanQ(6, 'Referendum nima?', 'C', 'Umumxalq ovoz berishi', [makeFanOpt('Prezident saylovi','A',false),makeFanOpt('Parlament saylovi','B',false),makeFanOpt('Umumxalq ovoz berishi','C',true),makeFanOpt('Sud qarori','D',false)]),
    ],
  };

  data.mock_fans['iqtisodiyot'] = {
    name: 'Iqtisodiyot',
    count: 6, createdAt: ago(15),
    questions: [
      makeFanQ(1, 'Talab va taklif qonuni?', 'A', 'Narx oshsa, talab kamayadi', [makeFanOpt('Narx oshsa, talab kamayadi','A',true),makeFanOpt('Narx oshsa, talab oshadi','B',false),makeFanOpt('Narx o\'zgarmaydi','C',false),makeFanOpt('Talab va taklif bog\'liq emas','D',false)]),
      makeFanQ(2, 'Inflatsiya nima?', 'B', 'Narxlar darajasining oshishi', [makeFanOpt('Narxlar darajasining tushishi','A',false),makeFanOpt('Narxlar darajasining oshishi','B',true),makeFanOpt('Pulning qadrsizlanishi','C',false),makeFanOpt('Ishsizlikning oshishi','D',false)]),
      makeFanQ(3, 'YaIM nima?', 'C', 'Yalpi ichki mahsulot', [makeFanOpt('Yalpi milliy mahsulot','A',false),makeFanOpt('Yalpi daromad','B',false),makeFanOpt('Yalpi ichki mahsulot','C',true),makeFanOpt('Yalpi xarajat','D',false)]),
      makeFanQ(4, 'Bozor iqtisodiyotining asosi?', 'D', 'Xususiy mulk', [makeFanOpt('Davlat mulki','A',false),makeFanOpt('Jamoa mulki','B',false),makeFanOpt('Aralash mulk','C',false),makeFanOpt('Xususiy mulk','D',true)]),
      makeFanQ(5, 'Valyuta kursi nima?', 'A', 'Pul birligining nisbati', [makeFanOpt('Pul birligining nisbati','A',true),makeFanOpt('Pul birligining qiymati','B',false),makeFanOpt('Narxlar darajasi','C',false),makeFanOpt('Foiz stavkasi','D',false)]),
      makeFanQ(6, 'Monopoliya nima?', 'C', 'Yagona sotuvchi', [makeFanOpt('Ko\'p sotuvchi','A',false),makeFanOpt('Ikki sotuvchi','B',false),makeFanOpt('Yagona sotuvchi','C',true),makeFanOpt('Hech qanday sotuvchi yo\'q','D',false)]),
    ],
  };

  data.mock_fans['psixologiya'] = {
    name: 'Psixologiya',
    count: 6, createdAt: ago(12),
    questions: [
      makeFanQ(1, 'Psixologiya nimani o\'rganadi?', 'A', 'Ruhiy jarayonlarni', [makeFanOpt('Ruhiy jarayonlarni','A',true),makeFanOpt('Miya tuzilishini','B',false),makeFanOpt('Nerv sistemasini','C',false),makeFanOpt('Organizmni','D',false)]),
      makeFanQ(2, 'Xotira turlari?', 'B', 'Qisqa va uzoq muddatli', [makeFanOpt('Passiv va aktiv','A',false),makeFanOpt('Qisqa va uzoq muddatli','B',true),makeFanOpt('Ichki va tashqi','C',false),makeFanOpt('Individual va jamoaviy','D',false)]),
      makeFanQ(3, 'Emotsiya turlari?', 'C', 'Ijobiy va salbiy', [makeFanOpt('Kuchli va kuchsiz','A',false),makeFanOpt('Barqaror va barqaror emas','B',false),makeFanOpt('Ijobiy va salbiy','C',true),makeFanOpt('Oddiy va murakkab','D',false)]),
      makeFanQ(4, 'Freydning shaxs tuzilishi?', 'D', 'Id, Ego, Superego', [makeFanOpt('Onlgi va ongsiz','A',false),makeFanOpt('Tug\'ma va orttirilgan','B',false),makeFanOpt('Biologik va ijtimoiy','C',false),makeFanOpt('Id, Ego, Superego','D',true)]),
      makeFanQ(5, 'Motivatsiya nima?', 'A', 'Faoliyatga undovchi kuch', [makeFanOpt('Faoliyatga undovchi kuch','A',true),makeFanOpt('Maqsadga intilish','B',false),makeFanOpt('Ehtiyoj','C',false),makeFanOpt('Qiziqish','D',false)]),
      makeFanQ(6, 'Temperament turlari?', 'C', '4 ta', [makeFanOpt('2 ta','A',false),makeFanOpt('3 ta','B',false),makeFanOpt('4 ta','C',true),makeFanOpt('5 ta','D',false)]),
    ],
  };

  data.mock_fans['pedagogika'] = {
    name: 'Pedagogika',
    count: 6, createdAt: ago(10),
    questions: [
      makeFanQ(1, 'Pedagogika nimani o\'rganadi?', 'A', 'Ta\'lim va tarbiyani', [makeFanOpt('Ta\'lim va tarbiyani','A',true),makeFanOpt('Bolalarni','B',false),makeFanOpt('Maktabni','C',false),makeFanOpt('O\'qituvchini','D',false)]),
      makeFanQ(2, 'Didaktika nima?', 'B', 'Ta\'lim nazariyasi', [makeFanOpt('Tarbiya nazariyasi','A',false),makeFanOpt('Ta\'lim nazariyasi','B',true),makeFanOpt('Rivojlanish nazariyasi','C',false),makeFanOpt('Bilish nazariyasi','D',false)]),
      makeFanQ(3, 'Ta\'lim metodlari?', 'C', 'Og\'zaki, ko\'rgazmali, amaliy', [makeFanOpt('Faqat og\'zaki','A',false),makeFanOpt('Faqat ko\'rgazmali','B',false),makeFanOpt('Og\'zaki, ko\'rgazmali, amaliy','C',true),makeFanOpt('Faqat amaliy','D',false)]),
      makeFanQ(4, 'Baholash turlari?', 'A', 'Joriy, oraliq, yakuniy', [makeFanOpt('Joriy, oraliq, yakuniy','A',true),makeFanOpt('Faqat yakuniy','B',false),makeFanOpt('Faqat joriy','C',false),makeFanOpt('Faqat oraliq','D',false)]),
      makeFanQ(5, 'Innovatsion ta\'lim?', 'B', 'Yangi pedagogik texnologiyalar', [makeFanOpt('Eski usullar','A',false),makeFanOpt('Yangi pedagogik texnologiyalar','B',true),makeFanOpt('An\'anaviy usullar','C',false),makeFanOpt('Masofaviy ta\'lim','D',false)]),
      makeFanQ(6, 'Kompetensiya nima?', 'D', 'Bilim, ko\'nikma va malaka', [makeFanOpt('Faqat bilim','A',false),makeFanOpt('Faqat ko\'nikma','B',false),makeFanOpt('Faqat malaka','C',false),makeFanOpt('Bilim, ko\'nikma va malaka','D',true)]),
    ],
  };

  data.mock_fans['tibbiyot'] = {
    name: 'Tibbiyot — Anatomiya',
    count: 8, createdAt: ago(26),
    questions: [
      makeFanQ(1, 'Inson yuragi necha kameradan iborat?', 'A', '4', [makeFanOpt('4','A',true),makeFanOpt('3','B',false),makeFanOpt('2','C',false),makeFanOpt('5','D',false)]),
      makeFanQ(2, 'Eng katta organ?', 'B', 'Teri', [makeFanOpt('Jigar','A',false),makeFanOpt('Teri','B',true),makeFanOpt('Miya','C',false),makeFanOpt('O\'pka','D',false)]),
      makeFanQ(3, 'Skeletda nechta suyak?', 'C', '206 ta', [makeFanOpt('196 ta','A',false),makeFanOpt('200 ta','B',false),makeFanOpt('206 ta','C',true),makeFanOpt('216 ta','D',false)]),
      makeFanQ(4, 'Qon aylanish sistemasi?', 'A', 'Yurak, tomirlar, qon', [makeFanOpt('Yurak, tomirlar, qon','A',true),makeFanOpt('Faqat yurak','B',false),makeFanOpt('Yurak va o\'pka','C',false),makeFanOpt('Faqat qon','D',false)]),
      makeFanQ(5, 'Nafas olish markazi qayerda?', 'D', 'Miyada', [makeFanOpt('O\'pkada','A',false),makeFanOpt('Yurakda','B',false),makeFanOpt('Bronxlarda','C',false),makeFanOpt('Miyada','D',true)]),
      makeFanQ(6, 'Oshqozon shirasi tarkibi?', 'B', 'HCl va fermentlar', [makeFanOpt('Faqat HCl','A',false),makeFanOpt('HCl va fermentlar','B',true),makeFanOpt('Faqat fermentlar','C',false),makeFanOpt('Suv va tuz','D',false)]),
      makeFanQ(7, 'Inson miyasi massasi?', 'C', '~1400 g', [makeFanOpt('~1000 g','A',false),makeFanOpt('~1200 g','B',false),makeFanOpt('~1400 g','C',true),makeFanOpt('~1600 g','D',false)]),
      makeFanQ(8, 'Endokrin sistema?', 'A', 'Gormonlar ishlab chiqaradi', [makeFanOpt('Gormonlar ishlab chiqaradi','A',true),makeFanOpt('Qon tozalaydi','B',false),makeFanOpt('Ovqat hazm qiladi','C',false),makeFanOpt('Nafas olish','D',false)]),
    ],
  };

  // ── Qo'shimcha fanlar (sarlavhalar) ──
  data.mock_fans['falsafa'] = {
    name: 'Falsafa', count: 6, createdAt: ago(8),
    questions: [
      makeFanQ(1, 'Falsafa grekcha ma\'nosi?', 'A', 'Donishmandlikni sevish', [makeFanOpt('Donishmandlikni sevish','A',true),makeFanOpt('Bilim','B',false),makeFanOpt('Aql','C',false),makeFanOpt('Haqiqat','D',false)]),
      makeFanQ(2, 'Dialektika nima?', 'B', 'Rivojlanish qonuniyatlari haqidagi ta\'limot', [makeFanOpt('Tabiat haqida ta\'limot','A',false),makeFanOpt('Rivojlanish qonuniyatlari haqidagi ta\'limot','B',true),makeFanOpt('Jamiyat haqida ta\'limot','C',false),makeFanOpt('Bilish haqida ta\'limot','D',false)]),
      makeFanQ(3, 'Ontologiya nima?', 'C', 'Borliq haqidagi ta\'limot', [makeFanOpt('Bilish haqida ta\'limot','A',false),makeFanOpt('Qadriyatlar haqida ta\'limot','B',false),makeFanOpt('Borliq haqidagi ta\'limot','C',true),makeFanOpt('Go\'zallik haqida ta\'limot','D',false)]),
      makeFanQ(4, 'Aql-idrok (Ratio) kimda asosiy?', 'D', 'Aralash mulk', [makeFanOpt('Platon','A',false),makeFanOpt('Aristotel','B',false),makeFanOpt('Sokrat','C',false),makeFanOpt('Arastu','D',true)]),
      makeFanQ(5, 'Gnoseologiya nima?', 'A', 'Bilish nazariyasi', [makeFanOpt('Bilish nazariyasi','A',true),makeFanOpt('Borliq nazariyasi','B',false),makeFanOpt('Qadriyatlar nazariyasi','C',false),makeFanOpt('Rivojlanish nazariyasi','D',false)]),
      makeFanQ(6, 'Aksiologiya nima?', 'C', 'Qadriyatlar haqidagi ta\'limot', [makeFanOpt('Bilim haqida ta\'limot','A',false),makeFanOpt('Borliq haqida ta\'limot','B',false),makeFanOpt('Qadriyatlar haqidagi ta\'limot','C',true),makeFanOpt('Go\'zallik haqida ta\'limot','D',false)]),
    ],
  };

  data.mock_fans['sanat'] = {
    name: 'San\'at Tarixi', count: 6, createdAt: ago(6),
    questions: [
      makeFanQ(1, 'Renessans davri qachon boshlangan?', 'A', 'XIV asr', [makeFanOpt('XIV asr','A',true),makeFanOpt('XII asr','B',false),makeFanOpt('XVI asr','C',false),makeFanOpt('XVIII asr','D',false)]),
      makeFanQ(2, 'Mona Liza muallifi?', 'B', 'Leonardo da Vinchi', [makeFanOpt('Mikelanjelo','A',false),makeFanOpt('Leonardo da Vinchi','B',true),makeFanOpt('Rafael','C',false),makeFanOpt('Donatello','D',false)]),
      makeFanQ(3, 'Opera san\'ati qayerda paydo bo\'lgan?', 'C', 'Italiyada', [makeFanOpt('Fransiyada','A',false),makeFanOpt('Germaniyada','B',false),makeFanOpt('Italiyada','C',true),makeFanOpt('Rossiyada','D',false)]),
      makeFanQ(4, 'Betxoven nechta simfoniya yozgan?', 'D', '9 ta', [makeFanOpt('5 ta','A',false),makeFanOpt('7 ta','B',false),makeFanOpt('8 ta','C',false),makeFanOpt('9 ta','D',true)]),
      makeFanQ(5, 'Impressionizm asoschisi?', 'A', 'Klod Mone', [makeFanOpt('Klod Mone','A',true),makeFanOpt('Edgar Deqa','B',false),makeFanOpt('Pyer-Og\'ust Renuar','C',false),makeFanOpt('Vinsent van Gog','D',false)]),
      makeFanQ(6, 'O\'zbek milliy cholg\'u asbobi?', 'C', 'Doira', [makeFanOpt('Pianino','A',false),makeFanOpt('Skripka','B',false),makeFanOpt('Doira','C',true),makeFanOpt('Gitara','D',false)]),
    ],
  };

  // ═══════════════════════════════════════════════════════════════
  // 3. PRE GROUPS — 10 ta PRE test guruhi
  // ═══════════════════════════════════════════════════════════════
  data.pre_groups = {};

  data.pre_groups['pre_matematika'] = {
    title: 'DTM — Matematika',
    total: 20, count: 3, createdAt: ago(60), authorUid: '__pre_admin__',
    chunks: [
      { id: 'pm1', name: 'Algebra', count: 8, questions: [
        { num: 1, text: 'x² - 7x + 12 = 0 ildizlari?', correctLetter: 'A', correctText: '3 va 4', options: [{ text: '3 va 4', letter: 'A', isCorrect: true }, { text: '-3 va -4', letter: 'B', isCorrect: false }, { text: '2 va 6', letter: 'C', isCorrect: false }, { text: '-2 va -6', letter: 'D', isCorrect: false }] },
        { num: 2, text: '2x + 3y = 12, x - y = 1, x=?', correctLetter: 'C', correctText: '3', options: [{ text: '2', letter: 'A', isCorrect: false }, { text: '4', letter: 'B', isCorrect: false }, { text: '3', letter: 'C', isCorrect: true }, { text: '5', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'log₃(81) = ?', correctLetter: 'B', correctText: '4', options: [{ text: '3', letter: 'A', isCorrect: false }, { text: '4', letter: 'B', isCorrect: true }, { text: '5', letter: 'C', isCorrect: false }, { text: '27', letter: 'D', isCorrect: false }] },
        { num: 4, text: '√225 = ?', correctLetter: 'A', correctText: '15', options: [{ text: '15', letter: 'A', isCorrect: true }, { text: '25', letter: 'B', isCorrect: false }, { text: '13', letter: 'C', isCorrect: false }, { text: '17', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'a³ - b³ = ?', correctLetter: 'D', correctText: '(a-b)(a²+ab+b²)', options: [{ text: '(a-b)(a+b)', letter: 'A', isCorrect: false }, { text: '(a-b)(a²-b²)', letter: 'B', isCorrect: false }, { text: '(a-b)(a²+b²)', letter: 'C', isCorrect: false }, { text: '(a-b)(a²+ab+b²)', letter: 'D', isCorrect: true }] },
        { num: 6, text: 'Arifmetik progressiya: 2,5,8,... a₇=?', correctLetter: 'C', correctText: '20', options: [{ text: '17', letter: 'A', isCorrect: false }, { text: '23', letter: 'B', isCorrect: false }, { text: '20', letter: 'C', isCorrect: true }, { text: '14', letter: 'D', isCorrect: false }] },
        { num: 7, text: '|x| < 5 tengsizlik yechimi?', correctLetter: 'A', correctText: '-5 < x < 5', options: [{ text: '-5 < x < 5', letter: 'A', isCorrect: true }, { text: 'x > 5', letter: 'B', isCorrect: false }, { text: 'x < -5', letter: 'C', isCorrect: false }, { text: 'x > -5', letter: 'D', isCorrect: false }] },
        { num: 8, text: '3⁵ = ?', correctLetter: 'B', correctText: '243', options: [{ text: '125', letter: 'A', isCorrect: false }, { text: '243', letter: 'B', isCorrect: true }, { text: '81', letter: 'C', isCorrect: false }, { text: '729', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pm2', name: 'Geometriya', count: 6, questions: [
        { num: 1, text: 'Uchburchak yuzi?', correctLetter: 'C', correctText: 'S = (a·h)/2', options: [{ text: 'S = a·b', letter: 'A', isCorrect: false }, { text: 'S = a·h', letter: 'B', isCorrect: false }, { text: 'S = (a·h)/2', letter: 'C', isCorrect: true }, { text: 'S = 2a·h', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Aylana uzunligi?', correctLetter: 'A', correctText: 'l = 2πR', options: [{ text: 'l = 2πR', letter: 'A', isCorrect: true }, { text: 'l = πR²', letter: 'B', isCorrect: false }, { text: 'l = πR', letter: 'C', isCorrect: false }, { text: 'l = 4πR', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Kub hajmi?', correctLetter: 'B', correctText: 'V = a³', options: [{ text: 'V = a²', letter: 'A', isCorrect: false }, { text: 'V = a³', letter: 'B', isCorrect: true }, { text: 'V = 6a²', letter: 'C', isCorrect: false }, { text: 'V = 4a³', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Sfera sirt yuzi?', correctLetter: 'D', correctText: 'S = 4πR²', options: [{ text: 'S = πR²', letter: 'A', isCorrect: false }, { text: 'S = 2πR', letter: 'B', isCorrect: false }, { text: 'S = (4/3)πR³', letter: 'C', isCorrect: false }, { text: 'S = 4πR²', letter: 'D', isCorrect: true }] },
        { num: 5, text: 'To\'rtburchak perimetri?', correctLetter: 'A', correctText: 'P = 2(a+b)', options: [{ text: 'P = 2(a+b)', letter: 'A', isCorrect: true }, { text: 'P = a·b', letter: 'B', isCorrect: false }, { text: 'P = a+b', letter: 'C', isCorrect: false }, { text: 'P = 4a', letter: 'D', isCorrect: false }] },
        { num: 6, text: 'Konus hajmi?', correctLetter: 'C', correctText: 'V = (1/3)πR²h', options: [{ text: 'V = πR²h', letter: 'A', isCorrect: false }, { text: 'V = (2/3)πR²h', letter: 'B', isCorrect: false }, { text: 'V = (1/3)πR²h', letter: 'C', isCorrect: true }, { text: 'V = (4/3)πR³', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pm3', name: 'Trigonometriya', count: 6, questions: [
        { num: 1, text: 'sin²α + cos²α = ?', correctLetter: 'A', correctText: '1', options: [{ text: '1', letter: 'A', isCorrect: true }, { text: '0', letter: 'B', isCorrect: false }, { text: '-1', letter: 'C', isCorrect: false }, { text: '2', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'sin(90° - α) = ?', correctLetter: 'B', correctText: 'cos α', options: [{ text: '-cos α', letter: 'A', isCorrect: false }, { text: 'cos α', letter: 'B', isCorrect: true }, { text: '-sin α', letter: 'C', isCorrect: false }, { text: 'tan α', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'tg α = ?', correctLetter: 'C', correctText: 'sin α / cos α', options: [{ text: 'cos α / sin α', letter: 'A', isCorrect: false }, { text: '1 / sin α', letter: 'B', isCorrect: false }, { text: 'sin α / cos α', letter: 'C', isCorrect: true }, { text: '1 / cos α', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'sin 0° = ?', correctLetter: 'A', correctText: '0', options: [{ text: '0', letter: 'A', isCorrect: true }, { text: '1', letter: 'B', isCorrect: false }, { text: '-1', letter: 'C', isCorrect: false }, { text: '0.5', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'cos 60° = ?', correctLetter: 'B', correctText: '0.5', options: [{ text: '0', letter: 'A', isCorrect: false }, { text: '0.5', letter: 'B', isCorrect: true }, { text: '1', letter: 'C', isCorrect: false }, { text: '√3/2', letter: 'D', isCorrect: false }] },
        { num: 6, text: 'sin 2α = ?', correctLetter: 'D', correctText: '2·sin α·cos α', options: [{ text: 'sin²α', letter: 'A', isCorrect: false }, { text: 'cos²α', letter: 'B', isCorrect: false }, { text: '2·cos²α', letter: 'C', isCorrect: false }, { text: '2·sin α·cos α', letter: 'D', isCorrect: true }] },
      ]},
    ],
  };

  data.pre_groups['pre_fizika'] = {
    title: 'DTM — Fizika',
    total: 15, count: 2, createdAt: ago(55), authorUid: '__pre_admin__',
    chunks: [
      { id: 'pf1', name: 'Mexanika', count: 8, questions: [
        { num: 1, text: 'Tezlik formulasi?', correctLetter: 'B', correctText: 'v = s/t', options: [{ text: 'v = a·t', letter: 'A', isCorrect: false }, { text: 'v = s/t', letter: 'B', isCorrect: true }, { text: 'v = F/m', letter: 'C', isCorrect: false }, { text: 'v = m·a', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Nyutonning 3-qonuni?', correctLetter: 'C', correctText: 'Ta\'sir va aks ta\'sir', options: [{ text: 'Inersiya', letter: 'A', isCorrect: false }, { text: 'Dinamika', letter: 'B', isCorrect: false }, { text: 'Ta\'sir va aks ta\'sir', letter: 'C', isCorrect: true }, { text: 'Energiya', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Erkin tushishda havo qarshiligi hisobga olinmasa?', correctLetter: 'A', correctText: 'Barcha jismlar bir xil tezlanish bilan tushadi', options: [{ text: 'Barcha jismlar bir xil tezlanish bilan tushadi', letter: 'A', isCorrect: true }, { text: 'Og\'ir jismlar tez tushadi', letter: 'B', isCorrect: false }, { text: 'Yengil jismlar tez tushadi', letter: 'C', isCorrect: false }, { text: 'Jismlar tushmaydi', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Ish birligi?', correctLetter: 'B', correctText: 'Joul', options: [{ text: 'Nyuton', letter: 'A', isCorrect: false }, { text: 'Joul', letter: 'B', isCorrect: true }, { text: 'Vatt', letter: 'C', isCorrect: false }, { text: 'Paskal', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'Energiya turlari?', correctLetter: 'D', correctText: 'Kinetik va potensial', options: [{ text: 'Faqat kinetik', letter: 'A', isCorrect: false }, { text: 'Faqat potensial', letter: 'B', isCorrect: false }, { text: 'Issiqlik va elektrik', letter: 'C', isCorrect: false }, { text: 'Kinetik va potensial', letter: 'D', isCorrect: true }] },
        { num: 6, text: 'Impuls birligi?', correctLetter: 'A', correctText: 'kg·m/s', options: [{ text: 'kg·m/s', letter: 'A', isCorrect: true }, { text: 'N·m', letter: 'B', isCorrect: false }, { text: 'J/s', letter: 'C', isCorrect: false }, { text: 'kg·m²/s²', letter: 'D', isCorrect: false }] },
        { num: 7, text: 'Elastiklik moduli?', correctLetter: 'C', correctText: 'Yung moduli', options: [{ text: 'Nyuton moduli', letter: 'A', isCorrect: false }, { text: 'Guk moduli', letter: 'B', isCorrect: false }, { text: 'Yung moduli', letter: 'C', isCorrect: true }, { text: 'Paskal moduli', letter: 'D', isCorrect: false }] },
        { num: 8, text: 'Qattiq jism bosimi?', correctLetter: 'B', correctText: 'p = F/S', options: [{ text: 'p = F·S', letter: 'A', isCorrect: false }, { text: 'p = F/S', letter: 'B', isCorrect: true }, { text: 'p = S/F', letter: 'C', isCorrect: false }, { text: 'p = m·g/S', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pf2', name: 'Elektr', count: 7, questions: [
        { num: 1, text: 'Om qonuni?', correctLetter: 'A', correctText: 'I = U/R', options: [{ text: 'I = U/R', letter: 'A', isCorrect: true }, { text: 'I = U·R', letter: 'B', isCorrect: false }, { text: 'U = I/R', letter: 'C', isCorrect: false }, { text: 'R = I·U', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Kuchlanish birligi?', correctLetter: 'B', correctText: 'Volt', options: [{ text: 'Amper', letter: 'A', isCorrect: false }, { text: 'Volt', letter: 'B', isCorrect: true }, { text: 'Om', letter: 'C', isCorrect: false }, { text: 'Vatt', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Qarshilik birligi?', correctLetter: 'C', correctText: 'Om', options: [{ text: 'Volt', letter: 'A', isCorrect: false }, { text: 'Amper', letter: 'B', isCorrect: false }, { text: 'Om', letter: 'C', isCorrect: true }, { text: 'Farada', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Elektr quvvati formulasi?', correctLetter: 'D', correctText: 'P = U·I', options: [{ text: 'P = I·R', letter: 'A', isCorrect: false }, { text: 'P = U/R', letter: 'B', isCorrect: false }, { text: 'P = I/R', letter: 'C', isCorrect: false }, { text: 'P = U·I', letter: 'D', isCorrect: true }] },
        { num: 5, text: 'Magnet maydon kuch chiziqlari?', correctLetter: 'A', correctText: 'Yopiq egri chiziqlar', options: [{ text: 'Yopiq egri chiziqlar', letter: 'A', isCorrect: true }, { text: 'To\'g\'ri chiziqlar', letter: 'B', isCorrect: false }, { text: 'Ochiq chiziqlar', letter: 'C', isCorrect: false }, { text: 'Aylanalar', letter: 'D', isCorrect: false }] },
        { num: 6, text: 'Elektroliz qonuni?', correctLetter: 'C', correctText: 'Faradey qonuni', options: [{ text: 'Om qonuni', letter: 'A', isCorrect: false }, { text: 'Joul-Lens qonuni', letter: 'B', isCorrect: false }, { text: 'Faradey qonuni', letter: 'C', isCorrect: true }, { text: 'Lens qonuni', letter: 'D', isCorrect: false }] },
        { num: 7, text: 'Transformator nima?', correctLetter: 'B', correctText: 'Kuchlanishni o\'zgartiruvchi qurilma', options: [{ text: 'Tokni o\'zgartiruvchi qurilma', letter: 'A', isCorrect: false }, { text: 'Kuchlanishni o\'zgartiruvchi qurilma', letter: 'B', isCorrect: true }, { text: 'Qarshilikni o\'zgartiruvchi qurilma', letter: 'C', isCorrect: false }, { text: 'Quvvatni o\'zgartiruvchi qurilma', letter: 'D', isCorrect: false }] },
      ]},
    ],
  };

  data.pre_groups['pre_kimyo'] = {
    title: 'DTM — Kimyo',
    total: 14, count: 2, createdAt: ago(50), authorUid: '__pre_admin__',
    chunks: [
      { id: 'pk1', name: 'Anorganik kimyo', count: 7, questions: [
        { num: 1, text: 'Vodorodning atom massasi?', correctLetter: 'A', correctText: '1', options: [{ text: '1', letter: 'A', isCorrect: true }, { text: '2', letter: 'B', isCorrect: false }, { text: '3', letter: 'C', isCorrect: false }, { text: '4', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Kislorodning valentligi?', correctLetter: 'B', correctText: 'II', options: [{ text: 'I', letter: 'A', isCorrect: false }, { text: 'II', letter: 'B', isCorrect: true }, { text: 'III', letter: 'C', isCorrect: false }, { text: 'IV', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Sulfat kislota formulasi?', correctLetter: 'C', correctText: 'H₂SO₄', options: [{ text: 'HCl', letter: 'A', isCorrect: false }, { text: 'HNO₃', letter: 'B', isCorrect: false }, { text: 'H₂SO₄', letter: 'C', isCorrect: true }, { text: 'H₃PO₄', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Ishqoriy metallar?', correctLetter: 'A', correctText: 'Li, Na, K', options: [{ text: 'Li, Na, K', letter: 'A', isCorrect: true }, { text: 'Mg, Ca, Ba', letter: 'B', isCorrect: false }, { text: 'Fe, Co, Ni', letter: 'C', isCorrect: false }, { text: 'F, Cl, Br', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'Neytrallanish reaksiyasi?', correctLetter: 'D', correctText: 'Kislota + Asos = Tuz + Suv', options: [{ text: 'Kislota + Metall', letter: 'A', isCorrect: false }, { text: 'Asos + Oksid', letter: 'B', isCorrect: false }, { text: 'Tuz + Kislota', letter: 'C', isCorrect: false }, { text: 'Kislota + Asos = Tuz + Suv', letter: 'D', isCorrect: true }] },
        { num: 6, text: 'Galogenlar?', correctLetter: 'B', correctText: 'F, Cl, Br, I', options: [{ text: 'O, S, Se, Te', letter: 'A', isCorrect: false }, { text: 'F, Cl, Br, I', letter: 'B', isCorrect: true }, { text: 'N, P, As, Sb', letter: 'C', isCorrect: false }, { text: 'He, Ne, Ar, Kr', letter: 'D', isCorrect: false }] },
        { num: 7, text: 'CO₂ qanday oksid?', correctLetter: 'C', correctText: 'Kislotali oksid', options: [{ text: 'Asosli oksid', letter: 'A', isCorrect: false }, { text: 'Amfoter oksid', letter: 'B', isCorrect: false }, { text: 'Kislotali oksid', letter: 'C', isCorrect: true }, { text: 'Neytral oksid', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pk2', name: 'Organik kimyo', count: 7, questions: [
        { num: 1, text: 'Organik moddalar?', correctLetter: 'B', correctText: 'Tarkibida C bor', options: [{ text: 'Tarkibida O bor', letter: 'A', isCorrect: false }, { text: 'Tarkibida C bor', letter: 'B', isCorrect: true }, { text: 'Tarkibida H bor', letter: 'C', isCorrect: false }, { text: 'Tarkibida N bor', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Etan formulasi?', correctLetter: 'A', correctText: 'C₂H₆', options: [{ text: 'C₂H₆', letter: 'A', isCorrect: true }, { text: 'C₂H₄', letter: 'B', isCorrect: false }, { text: 'C₂H₂', letter: 'C', isCorrect: false }, { text: 'C₃H₈', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Benzol?', correctLetter: 'C', correctText: 'Aromatik uglevodorod', options: [{ text: 'To\'yingan uglevodorod', letter: 'A', isCorrect: false }, { text: 'To\'yinmagan uglevodorod', letter: 'B', isCorrect: false }, { text: 'Aromatik uglevodorod', letter: 'C', isCorrect: true }, { text: 'Siklik uglevodorod', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Spirtlarning funksional guruhi?', correctLetter: 'D', correctText: '-OH', options: [{ text: '-COOH', letter: 'A', isCorrect: false }, { text: '-CHO', letter: 'B', isCorrect: false }, { text: '-NH₂', letter: 'C', isCorrect: false }, { text: '-OH', letter: 'D', isCorrect: true }] },
        { num: 5, text: 'Karboksil kislota guruhi?', correctLetter: 'A', correctText: '-COOH', options: [{ text: '-COOH', letter: 'A', isCorrect: true }, { text: '-OH', letter: 'B', isCorrect: false }, { text: '-CHO', letter: 'C', isCorrect: false }, { text: '-CO-', letter: 'D', isCorrect: false }] },
        { num: 6, text: 'Polietilen monomeri?', correctLetter: 'B', correctText: 'Etilen (C₂H₄)', options: [{ text: 'Metan', letter: 'A', isCorrect: false }, { text: 'Etilen (C₂H₄)', letter: 'B', isCorrect: true }, { text: 'Propan', letter: 'C', isCorrect: false }, { text: 'Butan', letter: 'D', isCorrect: false }] },
        { num: 7, text: 'Glyukoza?', correctLetter: 'C', correctText: 'Monosaxarid', options: [{ text: 'Disaxarid', letter: 'A', isCorrect: false }, { text: 'Polisaxarid', letter: 'B', isCorrect: false }, { text: 'Monosaxarid', letter: 'C', isCorrect: true }, { text: 'Oligosaxarid', letter: 'D', isCorrect: false }] },
      ]},
    ],
  };

  data.pre_groups['pre_biologiya'] = {
    title: 'DTM — Biologiya',
    total: 12, count: 2, createdAt: ago(45), authorUid: '__pre_admin__',
    chunks: [
      { id: 'pb1', name: 'Botanika', count: 6, questions: [
        { num: 1, text: 'O\'simlik hujayrasining devori?', correctLetter: 'A', correctText: 'Tsellyuloza', options: [{ text: 'Tsellyuloza', letter: 'A', isCorrect: true }, { text: 'Xitin', letter: 'B', isCorrect: false }, { text: 'Oqsil', letter: 'C', isCorrect: false }, { text: 'Lipid', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Fotosintezda qanday gaz ajraladi?', correctLetter: 'B', correctText: 'Kislorod', options: [{ text: 'Karbonat angidrid', letter: 'A', isCorrect: false }, { text: 'Kislorod', letter: 'B', isCorrect: true }, { text: 'Azot', letter: 'C', isCorrect: false }, { text: 'Vodorod', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'O\'simliklarning asosiy organlari?', correctLetter: 'C', correctText: 'Ildiz, poya, barg', options: [{ text: 'Poya, gul, meva', letter: 'A', isCorrect: false }, { text: 'Ildiz, gul, urug\'', letter: 'B', isCorrect: false }, { text: 'Ildiz, poya, barg', letter: 'C', isCorrect: true }, { text: 'Gul, meva, urug\'', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Xloroplast nima?', correctLetter: 'A', correctText: 'Fotosintez organoidi', options: [{ text: 'Fotosintez organoidi', letter: 'A', isCorrect: true }, { text: 'Nafas olish organoidi', letter: 'B', isCorrect: false }, { text: 'Suv saqlash organoidi', letter: 'C', isCorrect: false }, { text: 'Hazm qilish organoidi', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'Gulning vazifasi?', correctLetter: 'D', correctText: 'Urug\' hosil qilish', options: [{ text: 'Fotosintez', letter: 'A', isCorrect: false }, { text: 'Suv olish', letter: 'B', isCorrect: false }, { text: 'Nafas olish', letter: 'C', isCorrect: false }, { text: 'Urug\' hosil qilish', letter: 'D', isCorrect: true }] },
        { num: 6, text: 'Mevaning vazifasi?', correctLetter: 'B', correctText: 'Urug\'ni himoya va tarqatish', options: [{ text: 'Fotosintez', letter: 'A', isCorrect: false }, { text: 'Urug\'ni himoya va tarqatish', letter: 'B', isCorrect: true }, { text: 'Suv olish', letter: 'C', isCorrect: false }, { text: 'Ko\'payish', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pb2', name: 'Zoologiya', count: 6, questions: [
        { num: 1, text: 'Oq qon hujayralari?', correctLetter: 'C', correctText: 'Leykotsitlar', options: [{ text: 'Eritrotsitlar', letter: 'A', isCorrect: false }, { text: 'Trombotsitlar', letter: 'B', isCorrect: false }, { text: 'Leykotsitlar', letter: 'C', isCorrect: true }, { text: 'Fagotsitlar', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Yurak necha kamerali?', correctLetter: 'A', correctText: '4', options: [{ text: '4', letter: 'A', isCorrect: true }, { text: '3', letter: 'B', isCorrect: false }, { text: '2', letter: 'C', isCorrect: false }, { text: '5', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Nerv sistemasi birligi?', correctLetter: 'D', correctText: 'Neyron', options: [{ text: 'Akson', letter: 'A', isCorrect: false }, { text: 'Dendrit', letter: 'B', isCorrect: false }, { text: 'Sinaptik tugun', letter: 'C', isCorrect: false }, { text: 'Neyron', letter: 'D', isCorrect: true }] },
        { num: 4, text: 'Ovqat hazm qilish boshlanadi?', correctLetter: 'B', correctText: 'Og\'iz bo\'shlig\'ida', options: [{ text: 'Oshqozonda', letter: 'A', isCorrect: false }, { text: 'Og\'iz bo\'shlig\'ida', letter: 'B', isCorrect: true }, { text: 'Ingichka ichakda', letter: 'C', isCorrect: false }, { text: 'Yo\'g\'on ichakda', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'Buyraklar vazifasi?', correctLetter: 'A', correctText: 'Qonni tozalash', options: [{ text: 'Qonni tozalash', letter: 'A', isCorrect: true }, { text: 'Gormon ishlab chiqarish', letter: 'B', isCorrect: false }, { text: 'Ovqat hazm qilish', letter: 'C', isCorrect: false }, { text: 'Nafas olish', letter: 'D', isCorrect: false }] },
        { num: 6, text: 'Eng katta sutemizuvchi?', correctLetter: 'C', correctText: 'Kit', options: [{ text: 'Fil', letter: 'A', isCorrect: false }, { text: 'Jirafa', letter: 'B', isCorrect: false }, { text: 'Kit', letter: 'C', isCorrect: true }, { text: 'Timsoh', letter: 'D', isCorrect: false }] },
      ]},
    ],
  };

  data.pre_groups['pre_tarix'] = {
    title: 'DTM — Tarix',
    total: 10, count: 2, createdAt: ago(40), authorUid: '__pre_admin__',
    chunks: [
      { id: 'pth1', name: 'Jahon tarixi', count: 5, questions: [
        { num: 1, text: 'Birinchi jahon urushi sababi?', correctLetter: 'A', correctText: 'Avstriya valiahdining o\'ldirilishi', options: [{ text: 'Avstriya valiahdining o\'ldirilishi', letter: 'A', isCorrect: true }, { text: 'Mustamlaka kurashi', letter: 'B', isCorrect: false }, { text: 'Iqtisodiy inqiroz', letter: 'C', isCorrect: false }, { text: 'Harbiy ittifoqlar', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Sovuq urush davri?', correctLetter: 'C', correctText: '1947-1991', options: [{ text: '1939-1945', letter: 'A', isCorrect: false }, { text: '1914-1918', letter: 'B', isCorrect: false }, { text: '1947-1991', letter: 'C', isCorrect: true }, { text: '1950-1970', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'BMT Bosh kotibi?', correctLetter: 'B', correctText: 'Antonio Guterrish', options: [{ text: 'Ban Ki Mun', letter: 'A', isCorrect: false }, { text: 'Antonio Guterrish', letter: 'B', isCorrect: true }, { text: 'Kofi Annan', letter: 'C', isCorrect: false }, { text: 'Kur Guterrish', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Marshall rejasi nima?', correctLetter: 'D', correctText: 'Yevropani tiklash dasturi', options: [{ text: 'Harbiy dastur', letter: 'A', isCorrect: false }, { text: 'Ilmiy dastur', letter: 'B', isCorrect: false }, { text: 'Kosmik dastur', letter: 'C', isCorrect: false }, { text: 'Yevropani tiklash dasturi', letter: 'D', isCorrect: true }] },
        { num: 5, text: 'NATO qachon tuzilgan?', correctLetter: 'A', correctText: '1949', options: [{ text: '1949', letter: 'A', isCorrect: true }, { text: '1955', letter: 'B', isCorrect: false }, { text: '1945', letter: 'C', isCorrect: false }, { text: '1960', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pth2', name: 'O\'zbekiston tarixi', count: 5, questions: [
        { num: 1, text: 'Amir Temur davlati poytaxti?', correctLetter: 'B', correctText: 'Samarqand', options: [{ text: 'Buxoro', letter: 'A', isCorrect: false }, { text: 'Samarqand', letter: 'B', isCorrect: true }, { text: 'Shahrisabz', letter: 'C', isCorrect: false }, { text: 'Termiz', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'Turkiston Muxtoriyati?', correctLetter: 'A', correctText: '1917', options: [{ text: '1917', letter: 'A', isCorrect: true }, { text: '1918', letter: 'B', isCorrect: false }, { text: '1920', letter: 'C', isCorrect: false }, { text: '1916', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'Jadidchilik harakati?', correctLetter: 'C', correctText: 'XX asr boshi ma\'rifiy harakati', options: [{ text: 'Sovet davri harakati', letter: 'A', isCorrect: false }, { text: 'Diniy harakat', letter: 'B', isCorrect: false }, { text: 'XX asr boshi ma\'rifiy harakati', letter: 'C', isCorrect: true }, { text: 'Harbiy harakat', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'O\'zbekiston SSR tashkil topgan yil?', correctLetter: 'B', correctText: '1924', options: [{ text: '1920', letter: 'A', isCorrect: false }, { text: '1924', letter: 'B', isCorrect: true }, { text: '1925', letter: 'C', isCorrect: false }, { text: '1936', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'Mustaqillik ramzlari?', correctLetter: 'D', correctText: 'Bayroq, gerb, madhiya', options: [{ text: 'Faqat bayroq', letter: 'A', isCorrect: false }, { text: 'Bayroq va gerb', letter: 'B', isCorrect: false }, { text: 'Faqat madhiya', letter: 'C', isCorrect: false }, { text: 'Bayroq, gerb, madhiya', letter: 'D', isCorrect: true }] },
      ]},
    ],
  };

  data.pre_groups['pre_ingliz'] = {
    title: 'DTM — Ingliz Tili',
    total: 10, count: 2, createdAt: ago(35), authorUid: '__pre_admin__',
    chunks: [
      { id: 'pin1', name: 'Grammar', count: 5, questions: [
        { num: 1, text: 'I ___ to school yesterday.', correctLetter: 'B', correctText: 'went', options: [{ text: 'go', letter: 'A', isCorrect: false }, { text: 'went', letter: 'B', isCorrect: true }, { text: 'gone', letter: 'C', isCorrect: false }, { text: 'going', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'He ___ football every Sunday.', correctLetter: 'A', correctText: 'plays', options: [{ text: 'plays', letter: 'A', isCorrect: true }, { text: 'played', letter: 'B', isCorrect: false }, { text: 'playing', letter: 'C', isCorrect: false }, { text: 'play', letter: 'D', isCorrect: false }] },
        { num: 3, text: 'This is ___ book.', correctLetter: 'C', correctText: 'my', options: [{ text: 'I', letter: 'A', isCorrect: false }, { text: 'me', letter: 'B', isCorrect: false }, { text: 'my', letter: 'C', isCorrect: true }, { text: 'mine', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'She is ___ than her sister.', correctLetter: 'B', correctText: 'taller', options: [{ text: 'tall', letter: 'A', isCorrect: false }, { text: 'taller', letter: 'B', isCorrect: true }, { text: 'tallest', letter: 'C', isCorrect: false }, { text: 'more tall', letter: 'D', isCorrect: false }] },
        { num: 5, text: 'I have ___ finished my homework.', correctLetter: 'A', correctText: 'already', options: [{ text: 'already', letter: 'A', isCorrect: true }, { text: 'yet', letter: 'B', isCorrect: false }, { text: 'still', letter: 'C', isCorrect: false }, { text: 'since', letter: 'D', isCorrect: false }] },
      ]},
      { id: 'pin2', name: 'Reading', count: 5, questions: [
        { num: 1, text: 'What is the synonym of "happy"?', correctLetter: 'A', correctText: 'glad', options: [{ text: 'glad', letter: 'A', isCorrect: true }, { text: 'sad', letter: 'B', isCorrect: false }, { text: 'angry', letter: 'C', isCorrect: false }, { text: 'tired', letter: 'D', isCorrect: false }] },
        { num: 2, text: 'What is the opposite of "hot"?', correctLetter: 'B', correctText: 'cold', options: [{ text: 'warm', letter: 'A', isCorrect: false }, { text: 'cold', letter: 'B', isCorrect: true }, { text: 'cool', letter: 'C', isCorrect: false }, { text: 'wet', letter: 'D', isCorrect: false }] },
        { num: 3, text: '"Beautiful" means?', correctLetter: 'C', correctText: 'chiroyli', options: [{ text: 'yomon', letter: 'A', isCorrect: false }, { text: 'tez', letter: 'B', isCorrect: false }, { text: 'chiroyli', letter: 'C', isCorrect: true }, { text: 'kuchli', letter: 'D', isCorrect: false }] },
        { num: 4, text: 'Which is a fruit?', correctLetter: 'C', correctText: 'apple', },
        { num: 5, text: 'What is the opposite of "fast"?', correctLetter: 'B', correctText: 'slow', options: [
          { text: 'quick', letter: 'A', isCorrect: false }, { text: 'slow', letter: 'B', isCorrect: true }, { text: 'rapid', letter: 'C', isCorrect: false }, { text: 'speedy', letter: 'D', isCorrect: false }]},
      ]},
    ],
  };


  // ═══════════════════════════════════════════════════════════════
  // 4. RESULTS — 25 ta o'yin natijalari
  // ═══════════════════════════════════════════════════════════════
  data.results = {};

  const resultTests = [
    { code: 'RES01', name: 'JavaScript Asoslari', host: 'jasur', players: 6, h: ago(0,2) },
    { code: 'RES02', name: 'Geografiya — Dunyo Davlatlari', host: 'botir', players: 4, h: ago(0,5) },
    { code: 'RES03', name: 'Matematika — Algebra', host: 'aziza', players: 8, h: ago(0,8) },
    { code: 'RES04', name: 'HTML & CSS Savollari', host: 'jasur', players: 5, h: ago(0,12) },
    { code: 'RES05', name: 'Fizika — Mexanika', host: 'alisher', players: 7, h: ago(1) },
    { code: 'RES06', name: 'Kimyo — Organik', host: 'sardor', players: 6, h: ago(1,3) },
    { code: 'RES07', name: 'Informatika — Algoritmlar', host: 'davron', players: 9, h: ago(1,6) },
    { code: 'RES08', name: 'Tarix — O\'zbekiston', host: 'behruz', players: 5, h: ago(1,10) },
    { code: 'RES09', name: 'Biologiya — Genetika', host: 'shoxrux', players: 4, h: ago(2) },
    { code: 'RES10', name: 'Adabiyot — O\'zbek', host: 'dildora', players: 7, h: ago(2,4) },
    { code: 'RES11', name: 'Ingliz Tili Grammar', host: 'kamola', players: 6, h: ago(2,8) },
    { code: 'RES12', name: 'Astronomiya', host: 'muhammad', players: 3, h: ago(3) },
    { code: 'RES13', name: 'Falsafa', host: 'feruza', players: 5, h: ago(3,5) },
    { code: 'RES14', name: 'Tibbiyot — Anatomiya', host: 'rustam', players: 8, h: ago(4) },
    { code: 'RES15', name: 'Ekologiya', host: 'bobur', players: 4, h: ago(4,6) },
    { code: 'RES16', name: 'Huquqshunoslik', host: 'komil', players: 6, h: ago(5) },
    { code: 'RES17', name: 'Iqtisodiyot', host: 'elyor', players: 7, h: ago(5,3) },
    { code: 'RES18', name: 'Psixologiya', host: 'sanjar', players: 5, h: ago(6) },
    { code: 'RES19', name: 'Geometriya', host: 'ulugbek', players: 8, h: ago(6,8) },
    { code: 'RES20', name: 'Tarix — Jahon', host: 'ravshan', players: 6, h: ago(7) },
    { code: 'RES21', name: 'Fizika — Optika', host: 'azamat', players: 4, h: ago(7,5) },
    { code: 'RES22', name: 'Kimyo — Anorganik', host: 'firdavs', players: 7, h: ago(8) },
    { code: 'RES23', name: 'Biologiya — Botanika', host: 'hamid', players: 5, h: ago(8,10) },
    { code: 'RES24', name: 'Matematika — Trigonometriya', host: 'abdulla', players: 9, h: ago(9) },
    { code: 'RES25', name: 'DTM — Matematika (PRE)', host: 'xurshid', players: 10, h: ago(10) },
  ];

  resultTests.forEach((rt, idx) => {
    const leaderboard = [];
    const topNames = ['jasur','aziza','botir','alisher','malika','sardor','nigora','davron','behruz','shoxrux'];
    const count = Math.min(rt.players, 10);

    for (let i = 0; i < count; i++) {
      const name = topNames[i % topNames.length];
      leaderboard.push({
        name: name + (i >= topNames.length ? (i+1) : ''),
        score: Math.max(100, 1000 - i * 100 - Math.floor(Math.random() * 50)),
        totalTime: Math.floor(20000 + Math.random() * 60000),
        emoji: EMOJIS[i % EMOJIS.length],
      });
    }

    // Score'larni kamayish tartibida saralash
    leaderboard.sort((a, b) => b.score - a.score);

    data.results[rt.code] = {
      test_name: rt.name,
      host: rt.host,
      date: rt.h,
      totalPlayers: rt.players,
      leaderboard: leaderboard.slice(0, 7),
    };
  });

  return data;
}

export default generateSeedData;
