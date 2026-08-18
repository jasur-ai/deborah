/**
 * Edikit — Legal Documents (AUTH D-24)
 * ---------------------------------------------------------------------------
 * Privacy policy + Terms + Cookie policy — 4 til (uz / uz-cyrl / ru / en).
 * Auth'ga oid bo'limlar (D-24 §07-§09): email/telegram_id/hemis_id/device
 * fingerprint/audit/consent; NIST parol siyosati/MFA/teacher approval/bloklash;
 * cookie (session/remember/CSRF non-HttpOnly, 3rd-party yo'q).
 *
 * Qoidalar:
 *  - Secret/parol hech qachon hujjatda YO'Q (D-24 §15).
 *  - Havolalar allowlist: faqat security@edikit.uz / support@edikit.uz.
 *  - Har o'zgarishda version + changelog (D-24 §27).
 *  - Aniq, adolatli, tushunarli til (universitar daraja).
 */

export const LEGAL_LANGS = ['uz', 'uz-cyrl', 'ru', 'en'];
export const DEFAULT_LEGAL_LANG = 'uz';
export const LEGAL_VERSION = '1.0.0';
export const LEGAL_LAST_REVIEWED = '2026-08-17';
export const LEGAL_CONTACT = {
  security: 'security@edikit.uz',
  support: 'support@edikit.uz',
};

/** Noma'lum til → default. */
export function resolveLegalLang(lang) {
  return LEGAL_LANGS.includes(lang) ? lang : DEFAULT_LEGAL_LANG;
}

/**
 * Bitta hujjatni oladi (lang + doc).
 * @param {string} lang 'uz' | 'uz-cyrl' | 'ru' | 'en'
 * @param {'privacy'|'terms'|'cookies'} doc
 */
export function getLegalDoc(lang, doc) {
  const l = resolveLegalLang(lang);
  const d = LEGAL_DOCS[l]?.[doc];
  if (!d) return null;
  return {
    lang: l,
    doc,
    version: d.version,
    lastReviewed: d.lastReviewed,
    changelog: d.changelog,
    title: d.title,
    sections: d.sections,
    contact: LEGAL_CONTACT,
  };
}

/** Barcha hujjatlar versiyalarining qisqacha ko'rinishi (footer/consent uchun). */
export function getLegalMeta() {
  return {
    version: LEGAL_VERSION,
    lastReviewed: LEGAL_LAST_REVIEWED,
    langs: LEGAL_LANGS,
    contact: LEGAL_CONTACT,
  };
}

const P = ({ title, sections }) => ({ title, version: LEGAL_VERSION, lastReviewed: LEGAL_LAST_REVIEWED, changelog: [{ version: LEGAL_VERSION, date: LEGAL_LAST_REVIEWED, note: 'Initial version' }], sections });

export const LEGAL_DOCS = {
  // ─────────────────────────── UZ (lotin) ───────────────────────────
  uz: {
    privacy: P({
      title: 'Maxfiylik siyosati',
      sections: [
        { id: 'intro', heading: 'Kirish', body: [
          'Edikit — taʼlim platformasi (keyingi oʼrinlarda «Xizmat»). Ushbu Maxfiylik siyosati Xizmatdan foydalanishda shaxsiy maʼlumotlaringiz qanday yigʼilishi, ishlatilishi, saqlanishi va himoya qilinishini tushuntiradi.',
          'Xizmatdan foydalanish orqali siz ushbu siyosat shartlariga rozilik bildirasiz. Rozilik bermasangiz, Xizmatdan foydalanmang.',
        ] },
        { id: 'data', heading: 'Qanday maʼlumotlar yigʼiladi', body: [
          'Roʼyxatdan oʼtishda: foydalanuvchi nomi, elektron pochta manzili (email), ism (ixtiyoriy), parolning kriptografik xeshi (argon2id — parolning oʼzi saqlanmaydi).',
          'Xavfsizlik maqsadida: qurilma izi (device fingerprint) faqat xesh koʼrinishida, IP-manzil xeshi va taxminiy shahar, sessiya yozuvlari, audit jurnali (kirish, parol oʼzgartirish, muhim amallar).',
          'Agar ulasangiz: Telegram bildirishnoma identifikatori (telegram_id), universitet tizimidagi identifikator (hemis_id).',
          'Rozilik yozuvi: qaysi shartnoma versiyasiga, qachon rozilik berganingiz.',
        ] },
        { id: 'purpose', heading: 'Maʼlumotlardan foydalanish maqsadi', body: [
          'Xizmat koʼrsatish: hisobingizni boshqarish, kirish, imtihon va topshiriq jarayonlari.',
          'Xavfsizlik: firibgarlik, kirish hujumlari (brute-force, credential stuffing) va suiisteʼmollikni aniqlash hamda bloklash.',
          'Aloqa: elektron pochta tasdiqlash, parolni tiklash, muhim xavfsizlik bildirishnomalari (roʼyxatdan oʼtishga rozilik bergan email orqali).',
          'Maʼlumotlar faqat yuqoridagi maqsadlar uchun ishlatiladi; marketing uchun roziligingizsiz ishlatilmaydi.',
        ] },
        { id: 'retention', heading: 'Saqlash muddati', body: [
          'Hisob maʼlumotlari: hisob faol ekan, saqlanadi. Hisobni oʼchirishni soʼrasangiz (DSAR) — 30 kunlik imtiyoz davridan soʼng qaytarib boʼlmaydigan tarzda tozalanadi.',
          'Sessiya: 12 soatgacha (mutlaq muddat), harakatsizlikda 30 daqiqa.',
          'Audit jurnali: qonun talablari va xavfsizlik tekshiruvlari uchun cheklangan muddatda saqlanadi, shundan soʼng anonimlashtiriladi yoki oʼchiriladi.',
        ] },
        { id: 'dsar', heading: 'Sizning huquqlaringiz (DSAR)', body: [
          'Oʼzbekiston qonunchiligiga muvofiq quyidagi huquqlarga egasiz: maʼlumotlaringizdan nusxa olish (eksport), notoʼgʼri maʼlumotlarni tuzatish, qayta ishlashni cheklash, hisobni oʼchirish.',
          'Bularni «Sozlamalar → Maxfiylik» boʼlimida yoki security@edikit.uz orqali soʼrashingiz mumkin. Soʼrov 30 kun ichida koʼrib chiqiladi.',
          'Qonuniy majburiyat (masalan, sud qarori) boʼlsa, oʼchirish vaqtincha cheklanishi mumkin.',
        ] },
        { id: 'law', heading: 'Qonunchilik', body: [
          'Maʼlumotlar Oʼzbekiston Respublikasining shaxsiy maʼlumotlar toʼgʼrisidagi qonunchiligiga muvofiq qayta ishlanadi.',
          'Operator maʼlumotlarni qonun talab qilgan hollardan tashqari uchinchi shaxslarga bermaydi.',
        ] },
        { id: 'contact', heading: 'Bogʼlanish', body: [
          'Maxfiylik boʼyicha savollar uchun: security@edikit.uz (xavfsizlik masalalari) yoki support@edikit.uz (umumiy savollar).',
          'Ushbu siyosatga oʼzgartirish kiritilsa, yangi versiya va sana ushbu sahifada koʼrsatiladi.',
        ] },
      ],
    }),
    terms: P({
      title: 'Foydalanish shartlari',
      sections: [
        { id: 'intro', heading: 'Kirish', body: [
          'Ushbu shartlar Edikit Xizmatidan foydalanish qoidalarini belgilaydi. Roʼyxatdan oʼtish orqali siz ushbu shartlarga rozilik bildirasiz.',
        ] },
        { id: 'account', heading: 'Hisob', body: [
          'Har bir foydalanuvchi bitta hisob yaratishi mumkin. Hisob maʼlumotlari (foydalanuvchi nomi, parol) faqat oʼzingizga tegishli boʼlishi shart.',
          'Hisobingizdan foydalanish uchun siz javobgarsiz. Parolingizni hech kimga bermang.',
        ] },
        { id: 'password', heading: 'Parol siyosati', body: [
          'Parol kamida 15 ta belgidan iborat boʼlishi tavsiya etiladi (muhim hisoblar uchun kamida 8 ta). Maksimal uzunlik — 128 belgi.',
          'Murakkablik talablari (maxsus belgi/raqam majburiyati) qoʼllanilmaydi — uzoq parol xavfsizroq. Kiritilgan parol maʼlum boʼlgan parol buzilishlari (breach) roʼyxatiga solishtiriladi.',
          'Parol faqat xesh koʼrinishida saqlanadi (argon2id); hech kim, jumladan operator ham, uni koʼra olmaydi.',
        ] },
        { id: 'mfa', heading: 'Ikki bosqichli tekshiruv (MFA)', body: [
          'Xavfsizlikni oshirish uchun ikki bosqichli tekshiruv (TOTP) yoqish tavsiya etiladi.',
          'Oʼqituvchi va administrator hisoblari uchun MFA talab qilinishi mumkin.',
          'MFA kodlari va zaxira kodlarni xavfsiz joyda saqlang; ular yoʼqolsa, hisobni tiklash 72 soatgacha davom etishi mumkin.',
        ] },
        { id: 'teacher', heading: 'Oʼqituvchi arizalari', body: [
          'Oʼqituvchi sifatida roʼyxatdan oʼtish — ariza sifatida koʼrib chiqiladi. Universitet va fan maʼlumotlari tasdiqlash uchun ishlatiladi.',
          'Ariza rad etilishi yoki qoʼshimcha maʼlumot soʼralishi mumkin.',
        ] },
        { id: 'blocking', heading: 'Hisobni bloklash', body: [
          'Quyidagi hollarda hisob vaqtincha yoki doimiy bloklanishi mumkin: parolni koʼp marta notoʼgʼri kiritish, bot/avtomatlashtirilgan hujumlar, suiisteʼmol, qoidalarni buzish.',
          'Bloklangan foydalanuvchi sababni support@edikit.uz orqali soʼrashi mumkin.',
        ] },
        { id: 'abuse', heading: 'Suiisteʼmol', body: [
          'Taqiqlanadi: boshqa foydalanuvchi hisobiga kirishga urinish, Xizmatni buzish, spam, taʼlim jarayonini firibgarlik bilan buzish, noqonuniy kontent tarqatish.',
          'Suiisteʼmol aniqlansa, hisob bloklanadi va zarur hollarda huquqni muhofaza qilish organlariga xabar beriladi.',
        ] },
        { id: 'changes', heading: 'Oʼzgartirishlar', body: [
          'Ushbu shartlar vaqti-vaqti bilan yangilanishi mumkin. Muhim oʼzgarishlar haqida email orqali xabar beriladi.',
          'Yangilangan shartlardan foydalanishni davom ettirish — ularga rozilik bildiradi. Version va sana har doim ushbu sahifada koʼrsatiladi.',
        ] },
      ],
    }),
    cookies: P({
      title: 'Cookie siyosati',
      sections: [
        { id: 'intro', heading: 'Kirish', body: [
          'Ushbu siyosat Xizmat ishlatadigan cookie fayllari va shunga oʼxshash texnologiyalarni tushuntiradi.',
        ] },
        { id: 'session', heading: 'Sessiya cookie', body: [
          '«connect.sid» — sessiya cookie. Tizimga kirganingizda yaratiladi, kirish holatingizni saqlaydi. HttpOnly va SameSite=Lax atributlari bilan himoyalangan.',
          'Sessiya 30 daqiqa harakatsizlikdan yoki 12 soatdan soʼng tugaydi.',
        ] },
        { id: 'remember', heading: '«Eslab qolish» cookie', body: [
          '«Eslab qolish» funksiyasini tanlasangiz, selector/verifier juftligi saqlanadi — 30 kun davomida qayta kirish shart emas.',
          'HttpOnly atributiga ega; parol hech qachon cookieʼda saqlanmaydi.',
        ] },
        { id: 'csrf', heading: 'Xavfsizlik (CSRF) token', body: [
          'Formalar bilan birga yuboriladigan CSRF token cookieʼsi non-HttpOnly — brauzer skripti (JavaScript) uni oʼqishi kerak. Bu token muhim maʼlumotlarni oʼz ichiga olmaydi va sessiyaga bogʼliq.',
        ] },
        { id: 'thirdparty', heading: 'Uchinchi tomon cookie fayllari', body: [
          'Xizmat uchinchi tomon cookie fayllaridan (reklama, tahlil kuzatuvi) foydalanmaydi.',
        ] },
        { id: 'manage', heading: 'Cookielarni boshqarish', body: [
          'Cookie fayllarini brauzer sozlamalari orqali oʼchirishingiz yoki bloklashingiz mumkin. Ammo baʼzi funksiyalar (kirish, sessiya) cookie fayllarisiz ishlamaydi.',
        ] },
      ],
    }),
  },

  // ─────────────────────────── UZ (kirill) ───────────────────────────
  'uz-cyrl': {
    privacy: P({
      title: 'Макфийлик сиёсати',
      sections: [
        { id: 'intro', heading: 'Кириш', body: [
          'Edikit — таълим платформаси (кейинги ўринларда «Хизмат»). Ушбу Макфийлик сиёсати Хизматдан фойдаланишда шахсий маълумотларингиз қандай йиғилиши, ишлатилиши, сақланиши ва ҳимоя қилинишини тушунтиради.',
          'Хизматдан фойдаланиш орқали сиз ушбу сиёсат шартларига розилик билдирасиз. Розилик бермасангиз, Хизматдан фойдаланманг.',
        ] },
        { id: 'data', heading: 'Қандай маълумотлар йиғилади', body: [
          'Рўйхатдан ўтишда: фойдаланувчи номи, электрон почта манзили (email), исм (ихтиёрий), паролнинг криптографик хеши (argon2id — паролнинг ўзи сақланмайди).',
          'Хавфсизлик мақсадида: қурилма изи (device fingerprint) фақат хеш кўринишида, IP-манзил хеши ва тахминий шаҳар, сессия ёзувлари, аудит журнали (кириш, парол ўзгартириш, муҳим амаллар).',
          'Агар уласангиз: Telegram билдиришнома идентификатори (telegram_id), университет тизимидаги идентификатор (hemis_id).',
          'Розилик ёзуви: қайси шартнома версиясига, қачон розилик берганингиз.',
        ] },
        { id: 'purpose', heading: 'Маълумотлардан фойдаланиш мақсади', body: [
          'Хизмат кўрсатиш: ҳисобингизни бошқариш, кириш, имтиҳон ва топшириқ жараёнлари.',
          'Хавфсизлик: фирибгарлик, кириш ҳужумлари (brute-force, credential stuffing) ва суиистеъмолликни аниқлаш ҳамда блоклаш.',
          'Алоқа: электрон почта тасдиқлаш, паролни тиклаш, муҳим хавфсизлик билдиришномалари (рўйхатдан ўтишга розилик берган email орқали).',
          'Маълумотлар фақат юқоридаги мақсадлар учун ишлатилади; маркетинг учун розилигингизсиз ишлатилмайди.',
        ] },
        { id: 'retention', heading: 'Сақлаш муддати', body: [
          'Ҳисоб маълумотлари: ҳисоб фаол экан, сақланади. Ҳисобни ўчиришни сўрасангиз (DSAR) — 30 кунлик имтиёз давридан сўнг қайтариб бўлмайдиган тарзда тозаланади.',
          'Сессия: 12 соатгача (мутлақ муддат), ҳаракатсизликда 30 дақиқа.',
          'Аудит журнали: қонун талаблари ва хавфсизлик текширувлари учун чекланган муддатда сақланади, шундан сўнг анонимлаштирилади ёки ўчирилади.',
        ] },
        { id: 'dsar', heading: 'Сизнинг ҳуқуқларингиз (DSAR)', body: [
          'Ўзбекистон қонунчилигига мувофиқ қуйидаги ҳуқуқларга эгасиз: маълумотларингиздан нусха олиш (экспорт), нотўғри маълумотларни тузатиш, қайта ишлашни чеклаш, ҳисобни ўчириш.',
          'Буларни «Созламалар → Макфийлик» бўлимида ёки security@edikit.uz орқали сўрашингиз мумкин. Сўров 30 кун ичида кўриб чиқилади.',
          'Қонуний мажбурият (масалан, суд қарори) бўлса, ўчириш вақтинча чекланиши мумкин.',
        ] },
        { id: 'law', heading: 'Қонунчилик', body: [
          'Маълумотлар Ўзбекистон Республикасининг шахсий маълумотлар тўғрисидаги қонунчилигига мувофиқ қайта ишланади.',
          'Оператор маълумотларни қонун талаб қилган ҳоллардан ташқари учинчи шахсларга бермайди.',
        ] },
        { id: 'contact', heading: 'Боғланиш', body: [
          'Макфийлик бўйича саволлар учун: security@edikit.uz (хавфсизлик масалалари) ёки support@edikit.uz (умумий саволлар).',
          'Ушбу сиёсатга ўзгартириш киритилса, янги версия ва сана ушбу саҳифада кўрсатилади.',
        ] },
      ],
    }),
    terms: P({
      title: 'Фойдаланиш шартлари',
      sections: [
        { id: 'intro', heading: 'Кириш', body: [
          'Ушбу шартлар Edikit Хизматидан фойдаланиш қоидаларини белгилайди. Рўйхатдан ўтиш орқали сиз ушбу шартларга розилик билдирасиз.',
        ] },
        { id: 'account', heading: 'Ҳисоб', body: [
          'Ҳар бир фойдаланувчи битта ҳисоб яратиши мумкин. Ҳисоб маълумотлари (фойдаланувчи номи, парол) фақат ўзингизга тегишли бўлиши шарт.',
          'Ҳисобингиздан фойдаланиш учун сиз жавобгарсиз. Паролингизни ҳеч кимга берманг.',
        ] },
        { id: 'password', heading: 'Парол сиёсати', body: [
          'Парол камида 15 та белгидан иборат бўлиши tavsiya этилади (муҳим ҳисоблар учун камида 8 та). Максимал узунлик — 128 белги.',
          'Мураккаблик талаблари (махсус белги/рақам мажбурияти) қўлланмайди — узоқ парол хавфсизроқ. Киритилган парол маълум бўлган парол бузилишлари (breach) рўйхатига солиштирилади.',
          'Парол фақат хеш кўринишида сақланади (argon2id); ҳеч ким, жумладан оператор ҳам, уни кўра олмайди.',
        ] },
        { id: 'mfa', heading: 'Икки босқичли текширув (MFA)', body: [
          'Хавфсизликни ошириш учун икки босқичли текширув (TOTP) ёқиш tavsiya этилади.',
          'Ўқитувчи ва администратор ҳисоблари учун MFA талаб қилиниши мумкин.',
          'MFA кодлари ва захира кодларни хавфсиз жойда сақланг; улар йўқолса, ҳисобни тиклаш 72 соатгача давом этиши мумкин.',
        ] },
        { id: 'teacher', heading: 'Ўқитувчи аризалари', body: [
          'Ўқитувчи сифатида рўйхатдан ўтиш — ариза сифатида кўриб чиқилади. Университет ва фан маълумотлари тасдиқлаш учун ишлатилади.',
          'Ариза рад этилиши ёки қўшимча маълумот сўралиши мумкин.',
        ] },
        { id: 'blocking', heading: 'Ҳисобни блоклаш', body: [
          'Қуйидаги ҳолларда ҳисоб вақтинча ёки доимий блокланиши мумкин: паролни кўп марта нотўғри киритиш, бот/автоматлаштирилган ҳужумлар, суиистеъмол, қоидаларни бузиш.',
          'Блокланган фойдаланувчи сабабни support@edikit.uz орқали сўраши мумкин.',
        ] },
        { id: 'abuse', heading: 'Суиистеъмол', body: [
          'Тақиқланади: бошқа фойдаланувчи ҳисобига киришга уриниш, Хизматни бузиш, спам, таълим жараёнини фирибгарлик билан бузиш, ноқонуний контент тарқатиш.',
          'Суиистеъмол аниқланса, ҳисоб блокланади ва зарур ҳолларда ҳуқуқни муҳофаза қилиш органларига хабар берилади.',
        ] },
        { id: 'changes', heading: 'Ўзгартиришлар', body: [
          'Ушбу шартлар вақти-вақти билан янгиланиши мумкин. Муҳим ўзгаришлар ҳақида email орқали хабар берилади.',
          'Янгиланган шартлардан фойдаланишни давом эттириш — уларга розилик билдиради. Версия ва сана ҳар доим ушбу саҳифада кўрсатилади.',
        ] },
      ],
    }),
    cookies: P({
      title: 'Cookie сиёсати',
      sections: [
        { id: 'intro', heading: 'Кириш', body: [
          'Ушбу сиёсат Хизмат ишлатадиган cookie файллари ва шунга ўхшаш технологияларни тушунтиради.',
        ] },
        { id: 'session', heading: 'Сессия cookie', body: [
          '«connect.sid» — сессия cookie. Тизимга кирганингизда яратилади, кириш ҳолатингизни сақлайди. HttpOnly ва SameSite=Lax атрибутлари билан ҳимояланган.',
          'Сессия 30 дақиқа ҳаракатсизликдан ёки 12 соатдан сўнг тугайди.',
        ] },
        { id: 'remember', heading: '«Эслаб қолиш» cookie', body: [
          '«Эслаб қолиш» функциясини танласангиз, selector/verifier жуфтлиги сақланади — 30 кун давомида қайта кириш шарт эмас.',
          'HttpOnly атрибутига эга; парол ҳеч қачон cookieʼда сақланмайди.',
        ] },
        { id: 'csrf', heading: 'Хавфсизлик (CSRF) токени', body: [
          'Формалар билан бирга юбориладиган CSRF токени cookieʼси non-HttpOnly — браузер скрипти (JavaScript) уни ўқиши керак. Бу токен муҳим маълумотларни ўз ичига олмайди ва сессияга боғлиқ.',
        ] },
        { id: 'thirdparty', heading: 'Учинчи томон cookie файллари', body: [
          'Хизмат учинчи томон cookie файлларидан (реклама, таҳлил кузатуви) фойдаланмайди.',
        ] },
        { id: 'manage', heading: 'Cookielarni бошқариш', body: [
          'Cookie файлларини браузер созламалари орқали ўчиришингиз ёки блоклашингиз мумкин. Аммо баъзи функциялар (кириш, сессия) cookie файлларисиз ишламайди.',
        ] },
      ],
    }),
  },

  // ─────────────────────────── RU ───────────────────────────
  ru: {
    privacy: P({
      title: 'Политика конфиденциальности',
      sections: [
        { id: 'intro', heading: 'Введение', body: [
          'Edikit — образовательная платформа (далее «Сервис»). Настоящая Политика конфиденциальности объясняет, как собираются, используются, хранятся и защищаются ваши персональные данные при использовании Сервиса.',
          'Используя Сервис, вы соглашаетесь с условиями настоящей политики. Если вы не согласны, не используйте Сервис.',
        ] },
        { id: 'data', heading: 'Какие данные собираются', body: [
          'При регистрации: имя пользователя, адрес электронной почты (email), имя (по желанию), криптографический хеш пароля (argon2id — сам пароль не хранится).',
          'В целях безопасности: отпечаток устройства (device fingerprint) только в виде хеша, хеш IP-адреса и примерный город, записи сессий, журнал аудита (вход, смена пароля, важные действия).',
          'Если подключите: идентификатор уведомлений Telegram (telegram_id), идентификатор в системе университета (hemis_id).',
          'Запись согласия: на какую версию соглашения и когда вы согласились.',
        ] },
        { id: 'purpose', heading: 'Цели использования данных', body: [
          'Предоставление услуг: управление аккаунтом, вход, процессы экзаменов и заданий.',
          'Безопасность: обнаружение и блокировка мошенничества, атак на вход (brute-force, credential stuffing) и злоупотреблений.',
          'Связь: подтверждение электронной почты, восстановление пароля, важные уведомления безопасности (на email, указанный при регистрации).',
          'Данные используются только для указанных целей; для маркетинга — только с вашего согласия.',
        ] },
        { id: 'retention', heading: 'Сроки хранения', body: [
          'Данные аккаунта: хранятся, пока аккаунт активен. При запросе на удаление (DSAR) — безвозвратно очищаются после 30-дневного льготного периода.',
          'Сессия: до 12 часов (абсолютный срок), при бездействии — 30 минут.',
          'Журнал аудита: хранится ограниченное время для требований законодательства и проверок безопасности, затем анонимизируется или удаляется.',
        ] },
        { id: 'dsar', heading: 'Ваши права (DSAR)', body: [
          'В соответствии с законодательством Узбекистана вы имеете право: получить копию данных (экспорт), исправить неверные данные, ограничить обработку, удалить аккаунт.',
          'Запросить можно в разделе «Настройки → Конфиденциальность» или через security@edikit.uz. Запрос рассматривается в течение 30 дней.',
          'При наличии юридического обязательства (например, решения суда) удаление может быть временно ограничено.',
        ] },
        { id: 'law', heading: 'Законодательство', body: [
          'Данные обрабатываются в соответствии с законодательством Республики Узбекистан о персональных данных.',
          'Оператор не передаёт данные третьим лицам, кроме случаев, предусмотренных законом.',
        ] },
        { id: 'contact', heading: 'Контакты', body: [
          'По вопросам конфиденциальности: security@edikit.uz (вопросы безопасности) или support@edikit.uz (общие вопросы).',
          'При изменении политики новая версия и дата указываются на этой странице.',
        ] },
      ],
    }),
    terms: P({
      title: 'Условия использования',
      sections: [
        { id: 'intro', heading: 'Введение', body: [
          'Настоящие условия определяют правила использования Сервиса Edikit. Регистрируясь, вы соглашаетесь с этими условиями.',
        ] },
        { id: 'account', heading: 'Аккаунт', body: [
          'Каждый пользователь может создать один аккаунт. Данные аккаунта (имя пользователя, пароль) должны быть известны только вам.',
          'Вы несёте ответственность за использование аккаунта. Никому не сообщайте свой пароль.',
        ] },
        { id: 'password', heading: 'Политика паролей', body: [
          'Рекомендуется пароль не менее 15 символов (для важных аккаунтов — не менее 8). Максимальная длина — 128 символов.',
          'Требования к сложности (обязательные спецсимволы/цифры) не применяются — длинный пароль безопаснее. Введённый пароль проверяется по списку известных утечек (breach).',
          'Пароль хранится только в виде хеша (argon2id); никто, включая оператора, не может его увидеть.',
        ] },
        { id: 'mfa', heading: 'Двухфакторная аутентификация (MFA)', body: [
          'Для повышения безопасности рекомендуется включить двухфакторную аутентификацию (TOTP).',
          'Для аккаунтов преподавателей и администраторов MFA может быть обязательной.',
          'Храните коды MFA и резервные коды в безопасном месте; при их потере восстановление аккаунта может занять до 72 часов.',
        ] },
        { id: 'teacher', heading: 'Заявки преподавателей', body: [
          'Регистрация в качестве преподавателя рассматривается как заявка. Данные об университете и предмете используются для подтверждения.',
          'Заявка может быть отклонена или запрошены дополнительные данные.',
        ] },
        { id: 'blocking', heading: 'Блокировка аккаунта', body: [
          'Аккаунт может быть временно или постоянно заблокирован в следующих случаях: многократный неверный ввод пароля, бот/автоматизированные атаки, злоупотребление, нарушение правил.',
          'Заблокированный пользователь может узнать причину через support@edikit.uz.',
        ] },
        { id: 'abuse', heading: 'Злоупотребления', body: [
          'Запрещено: попытки доступа к чужому аккаунту, нарушение работы Сервиса, спам, мошенничество в учебном процессе, распространение незаконного контента.',
          'При обнаружении злоупотреблений аккаунт блокируется, при необходимости информируются правоохранительные органы.',
        ] },
        { id: 'changes', heading: 'Изменения', body: [
          'Настоящие условия могут периодически обновляться. О важных изменениях сообщается по email.',
          'Продолжение использования Сервиса после обновления означает согласие с новыми условиями. Версия и дата всегда указаны на этой странице.',
        ] },
      ],
    }),
    cookies: P({
      title: 'Политика использования cookie',
      sections: [
        { id: 'intro', heading: 'Введение', body: [
          'Настоящая политика объясняет использование файлов cookie и аналогичных технологий Сервисом.',
        ] },
        { id: 'session', heading: 'Сессионный cookie', body: [
          '«connect.sid» — сессионный cookie. Создаётся при входе в систему и сохраняет состояние входа. Защищён атрибутами HttpOnly и SameSite=Lax.',
          'Сессия завершается через 30 минут бездействия или через 12 часов.',
        ] },
        { id: 'remember', heading: 'Cookie «Запомнить меня»', body: [
          'При выборе функции «Запомнить меня» сохраняется пара selector/verifier — повторный вход не требуется в течение 30 дней.',
          'Имеет атрибут HttpOnly; пароль никогда не хранится в cookie.',
        ] },
        { id: 'csrf', heading: 'Токен безопасности (CSRF)', body: [
          'Cookie токена CSRF, отправляемый вместе с формами, — non-HttpOnly: браузерный скрипт (JavaScript) должен его читать. Токен не содержит чувствительных данных и привязан к сессии.',
        ] },
        { id: 'thirdparty', heading: 'Сторонние cookie', body: [
          'Сервис не использует сторонние cookie-файлы (реклама, аналитическое отслеживание).',
        ] },
        { id: 'manage', heading: 'Управление cookie', body: [
          'Вы можете удалить или заблокировать cookie через настройки браузера. Однако некоторые функции (вход, сессия) не работают без cookie.',
        ] },
      ],
    }),
  },

  // ─────────────────────────── EN ───────────────────────────
  en: {
    privacy: P({
      title: 'Privacy Policy',
      sections: [
        { id: 'intro', heading: 'Introduction', body: [
          'Edikit is an education platform (the «Service»). This Privacy Policy explains how your personal data is collected, used, stored and protected when you use the Service.',
          'By using the Service you agree to the terms of this policy. If you do not agree, do not use the Service.',
        ] },
        { id: 'data', heading: 'What data we collect', body: [
          'On registration: username, email address, name (optional), and a cryptographic hash of your password (argon2id — the password itself is never stored).',
          'For security: a device fingerprint stored only as a hash, a hash of your IP address with an approximate city, session records, and an audit log (sign-in, password changes, sensitive actions).',
          'If connected: your Telegram notification identifier (telegram_id) and your university system identifier (hemis_id).',
          'A consent record: which version of the agreement you accepted and when.',
        ] },
        { id: 'purpose', heading: 'How we use your data', body: [
          'Providing the Service: managing your account, sign-in, exam and assignment flows.',
          'Security: detecting and blocking fraud, credential attacks (brute-force, credential stuffing) and abuse.',
          'Communication: email verification, password reset, and important security notices (to the email provided at registration).',
          'Data is used only for the purposes above; it is never used for marketing without your consent.',
        ] },
        { id: 'retention', heading: 'Retention periods', body: [
          'Account data: kept while your account is active. On a deletion request (DSAR) it is irreversibly purged after a 30-day grace period.',
          'Session: up to 12 hours (absolute timeout); 30 minutes of inactivity.',
          'Audit log: kept for a limited period to meet legal and security requirements, then anonymized or deleted.',
        ] },
        { id: 'dsar', heading: 'Your rights (DSAR)', body: [
          'Under the legislation of Uzbekistan you have the right to: export a copy of your data, correct inaccurate data, restrict processing, and delete your account.',
          'You can request these in Settings → Privacy or via security@edikit.uz. Requests are processed within 30 days.',
          'If a legal obligation exists (e.g. a court order), deletion may be temporarily restricted.',
        ] },
        { id: 'law', heading: 'Legal framework', body: [
          'Data is processed in accordance with the personal data legislation of the Republic of Uzbekistan.',
          'The operator does not share data with third parties except as required by law.',
        ] },
        { id: 'contact', heading: 'Contact', body: [
          'For privacy questions: security@edikit.uz (security matters) or support@edikit.uz (general questions).',
          'If this policy is updated, the new version and date will be shown on this page.',
        ] },
      ],
    }),
    terms: P({
      title: 'Terms of Service',
      sections: [
        { id: 'intro', heading: 'Introduction', body: [
          'These terms define the rules for using the Edikit Service. By registering you agree to these terms.',
        ] },
        { id: 'account', heading: 'Account', body: [
          'Each user may create one account. Your account credentials (username, password) must remain private to you.',
          'You are responsible for activity on your account. Never share your password.',
        ] },
        { id: 'password', heading: 'Password policy', body: [
          'A password of at least 15 characters is recommended (at least 8 for lower-risk accounts). Maximum length is 128 characters.',
          'No complexity requirements (mandatory symbols/digits) are imposed — longer passwords are safer. Passwords are checked against known breach lists.',
          'Passwords are stored only as hashes (argon2id); no one, including the operator, can read them.',
        ] },
        { id: 'mfa', heading: 'Two-factor authentication (MFA)', body: [
          'Enabling two-factor authentication (TOTP) is recommended for stronger security.',
          'MFA may be required for teacher and administrator accounts.',
          'Keep your MFA codes and backup codes safe; if lost, account recovery may take up to 72 hours.',
        ] },
        { id: 'teacher', heading: 'Teacher applications', body: [
          'Registering as a teacher is treated as an application. University and subject details are used for verification.',
          'An application may be rejected or further information may be requested.',
        ] },
        { id: 'blocking', heading: 'Account blocking', body: [
          'An account may be temporarily or permanently blocked in cases such as: repeated incorrect passwords, bot/automated attacks, abuse, or violation of these rules.',
          'A blocked user may ask for the reason via support@edikit.uz.',
        ] },
        { id: 'abuse', heading: 'Abuse', body: [
          'Prohibited: attempting to access another user\'s account, disrupting the Service, spamming, academic fraud, or distributing unlawful content.',
          'Abuse leads to account blocking and, where necessary, notification of law enforcement.',
        ] },
        { id: 'changes', heading: 'Changes', body: [
          'These terms may be updated from time to time. Significant changes are announced by email.',
          'Continuing to use the Service after an update means you accept the new terms. Version and date are always shown on this page.',
        ] },
      ],
    }),
    cookies: P({
      title: 'Cookie Policy',
      sections: [
        { id: 'intro', heading: 'Introduction', body: [
          'This policy explains the cookies and similar technologies used by the Service.',
        ] },
        { id: 'session', heading: 'Session cookie', body: [
          '«connect.sid» is the session cookie. It is created when you sign in and keeps you signed in. It is protected with HttpOnly and SameSite=Lax attributes.',
          'The session expires after 30 minutes of inactivity or after 12 hours.',
        ] },
        { id: 'remember', heading: '«Remember me» cookie', body: [
          'If you choose «Remember me», a selector/verifier pair is stored so you do not need to sign in again for 30 days.',
          'It has the HttpOnly attribute; your password is never stored in a cookie.',
        ] },
        { id: 'csrf', heading: 'Security (CSRF) token', body: [
          'The CSRF token cookie sent with forms is non-HttpOnly: browser scripts (JavaScript) must be able to read it. It contains no sensitive data and is bound to your session.',
        ] },
        { id: 'thirdparty', heading: 'Third-party cookies', body: [
          'The Service does not use third-party cookies (advertising or analytics tracking).',
        ] },
        { id: 'manage', heading: 'Managing cookies', body: [
          'You can delete or block cookies through your browser settings. However, some features (sign-in, session) will not work without cookies.',
        ] },
      ],
    }),
  },
};
