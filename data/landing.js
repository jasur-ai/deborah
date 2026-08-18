/**
 * Deborah — Landing Copy Bank (STEP 21/22/23)
 * -----------------------------------------------------------------
 *  - LANDING_LANGS: ['uz', 'uz-cyrl', 'ru', 'en']
 *  - LANDING_COPY[lang]: landing matnlari (hero/stage/how/roles/features/trust/cta/footer)
 *  - STATS_COPY[lang]: ochiq ma'lumotlar stats bloki label'lari
 *  - resolveLandingLang(langKey): URL/lang cookie -> canonical lang
 *
 * Qoidalar (S21/S22 testlari bilan):
 *  - fake proof claim yo'q ("Official platform", "10,000+" va h.k.)
 *  - hero.sub: task+outcome, vague so'zlar yo'q (zamonaviy/modern/premium...)
 *  - how.teacherSteps[0]=ask, [2]=adapt
 *  - trust.items 4 ta: icon privacy|camera|a11y|rank, link /privacy|/security|/accessibility
 *  - stage.participants "30" ni o'z ichiga oladi; phoneValues 4 ta
 */

export const LANDING_LANGS = ['uz', 'uz-cyrl', 'ru', 'en'];

export function resolveLandingLang(langKey) {
  const k = String(langKey || 'uz').toLowerCase();
  if (k.startsWith('ru')) return 'ru';
  if (k.startsWith('en')) return 'en';
  if (k.includes('cyrl') || k === 'uz-cyrl') return 'uz-cyrl';
  return 'uz';
}

export const LANDING_COPY = {
  uz: {
    meta: {
      title: 'Deborah — jonli baholash tizimi',
      description: 'Savol tuzing, sinf ekraniga uzating, javoblarni jonli ko\'ring. OTM o\'qituvchilari uchun jonli baholash.',
    },
    header: {
      cta: 'Kirish',
      switcherLabel: 'Tilni tanlash',
    },
    hero: {
      badge: 'Jonli baholash tizimi',
      h1: 'Sinf nimani tushunganini — dars vaqtida ko\'ring',
      sub: 'Savolni sinf ekraniga uzatasiz, talabalar telefonda anonim javob beradi, natija darhol yig\'iladi va dominant xato ko\'rinadi. Darsni shu dalilga qarab davom ettirasiz.',
      ctaPrimary: 'Darsga tayyorlanish',
      ctaSecondary: 'Demo\'ni ko\'rish',
      participantCta: 'Kod bilan ulanish',
    },
    stage: {
      label: 'Jonli sessiya',
      participants: '30 ishtirokchi',
      question: 'SQL\'da takroriy yozuvlarni olib tashlaydigan operator qaysi?',
      coverage: 'Qamrov: 30/30',
      discuss: 'Muhokama tavsiya',
      correct: 'To\'g\'ri: 82%',
      phoneValues: ['SELECT DISTINCT', 'SELECT UNIQUE ALL', 'SELECT FILTER', 'SELECT REMOVE'],
    },
    demo: {
      title: 'Mini demo — sinab ko\'ring',
      hint: 'Bu demo: savol uzatiladi, javob tanlaysiz, natija ko\'rsatiladi.',
      cta: 'Demoni boshlash',
    },
    how: {
      title: 'Qanday ishlaydi',
      teacherTab: 'O\'qituvchi',
      studentTab: 'Talaba',
      teacherSteps: [
        { title: 'Savol yarating', desc: 'Mavzudan test savolini AI tayyorlaydi yoki bankdan tanlaysiz.' },
        { title: 'Ekranga uzating', desc: 'Savol sinf ekranida ochiladi, talabalar telefonda javob beradi.' },
        { title: 'Moslashtiring', desc: 'Dominant xatoni ko\'rib, muhokama yoki qayta tushuntirishni tanlaysiz.' },
      ],
      studentSteps: [
        { title: 'Kod bilan ulaning', desc: 'O\'qituvchi bergan kodni kiritasiz va savolni ko\'rasiz.' },
        { title: 'Javob bering', desc: 'Variantni tanlaysiz — javob anonim yig\'iladi.' },
        { title: 'Natijani ko\'ring', desc: 'Shaxsiy natijangiz va sinf signali keyingi bosqichda ochiladi.' },
      ],
    },
    roles: {
      label: 'Kim uchun',
      teacherTitle: 'O\'qituvchilar',
      teacherSub: 'Savol tuzish, cast qilish va natijani bir joyda boshqaring.',
      teacherPoints: [
        'AI savol generatsiyasi',
        'Jonli sinf signali',
        'Avtomatik hisobot',
      ],
      teacherCta: "O'qituvchi sifatida boshlash",
      studentTitle: 'Talabalar',
      studentSub: 'Kod bilan ulaning va anonim javob bering.',
      studentPoints: [
        'Telefonda javob berish',
        'Shaxsiy natija',
        'Reyting maxfiyligi',
      ],
      studentCta: 'Talaba sifatida boshlash',
    },
    features: {
      title: 'Imkoniyatlar',
      desc: 'Darsni dalilga tayanib boshqaring — qog\'oz va soniyalarda.',
      cards: [
        { title: 'Xavfsiz topshirish', desc: 'Preflight va secure submit — ish hech qachon yo\'qolmaydi.' },
        { title: 'Sinf signali', desc: 'Dominant xato bir qarashda: mosayka va yo\'lak grafigi.' },
        { title: 'Avtomatik baholash', desc: 'Rubric bo\'yicha AI baholaydi, natija serverda tasdiqlanadi.' },
        { title: 'Taraqqiyot', desc: 'Sinf darajasidagi natijalar va o\'sish dinamikasi.' },
        { title: 'Qamrov xaritasi', desc: 'Qaysi mavzu zaifligini sinf bo\'ylab ko\'rasiz.' },
        { title: 'AI yordamchi', desc: 'Mavzuni tushuntiradi, savol va material taklif qiladi.' },
      ],
    },
    trust: {
      title: 'Ishonch asoslari',
      desc: 'Maxfiylik, xavfsizlik va foydalanish qulayligi — ta\'lim muhitiga mos.',
      readMore: 'Batafsil',
      items: [
        { icon: 'privacy', title: 'Maxfiylik', desc: 'Javoblar anonim, shaxsiy ma\'lumotlar shifrlanadi.', link: '/privacy' },
        { icon: 'camera', title: 'Nazorat', desc: 'Imtihonlarda kamera evidence opsiyasi.', link: '/security' },
        { icon: 'a11y', title: 'Foydalanish', desc: 'WCAG 2.2 AA — barcha uchun ochiq interfeys.', link: '/accessibility' },
        { icon: 'rank', title: 'Tartib', desc: 'Server-confirmed natijalar va audit jurnali.', link: '/security' },
      ],
    },
    cta: {
      title: 'Darsingizni jonli o\'lchashni boshlang',
      desc: 'Ro\'yxatdan o\'ting va savol tuzishni sinab ko\'ring.',
      button: 'Boshlash',
    },
    footer: {
      colProduct: 'Mahsulot',
      productFeatures: 'Imkoniyatlar',
      productDemo: 'Demo',
      productHow: 'Qanday ishlaydi',
      productRoles: 'Rollar',
      colCast: 'Cast',
      castJoin: 'Kod bilan ulanish',
      colLegal: 'Hujjatlar',
      terms: 'Shartlar',
      privacy: 'Maxfiylik',
      security: 'Xavfsizlik',
      accessibility: 'Foydalanish',
      colUtility: 'Xizmat',
      admin: 'Administrator',
      telegram: 'Telegram',
      langs: 'Tillar',
      rights: '© 2026 Deborah. Barcha huquqlar himoyalangan.',
    },
  },

  'uz-cyrl': {
    meta: {
      title: 'Deborah — жонли баҳолаш тизими',
      description: 'Савол тузинг, синф экранига узатинг, жавобларни жонли кўринг. ОТМ ўқитувчилари учун жонли баҳолаш.',
    },
    header: {
      cta: 'Кириш',
      switcherLabel: 'Тилни танлаш',
    },
    hero: {
      badge: 'Жонли баҳолаш тизими',
      h1: 'Синф нимани тушунганини шу заҳоти кўринг',
      sub: 'Саволни синф экранига узатасиз, талабалар телефонда аноним жавоб беради, натижа дарҳол йиғилади ва доминант хато кўринади. Дарсни шу далилга қараб давом эттирасиз.',
      ctaPrimary: 'Дарсга тайёрланиш',
      ctaSecondary: 'Демони кўриш',
      participantCta: 'Код билан уланиш',
    },
    stage: {
      label: 'Жонли сессия',
      participants: '30 иштирокчи',
      question: 'SQL\'да такрорий ёзувларни олиб ташлайдиган оператор қайси?',
      coverage: 'Қамров: 30/30',
      discuss: 'Муҳокама тавсия',
      correct: 'Тўғри: 82%',
      phoneValues: ['SELECT DISTINCT', 'SELECT UNIQUE ALL', 'SELECT FILTER', 'SELECT REMOVE'],
    },
    demo: {
      title: 'Мини демо — синаб кўринг',
      hint: 'Бу демо: савол узатилади, жавоб танлайсиз, натижа кўрсатилади.',
      cta: 'Демони бошлаш',
    },
    how: {
      title: 'Қандай ишлайди',
      teacherTab: 'Ўқитувчи',
      studentTab: 'Талаба',
      teacherSteps: [
        { title: 'Савол яратинг', desc: 'Мавзудан тест саволини AI тайёрлайди ёки банкдан танлайсиз.' },
        { title: 'Экранга узатинг', desc: 'Савол синф экранида очилади, талабалар телефонда жавоб беради.' },
        { title: 'Мослаштиринг', desc: 'Доминант хатони кўриб, муҳокама ёки қайта тушунтиришни танлайсиз.' },
      ],
      studentSteps: [
        { title: 'Код билан уланинг', desc: 'Ўқитувчи берган кодни киритасиз ва саволни кўрасиз.' },
        { title: 'Жавоб беринг', desc: 'Вариантни танлайсиз — жавоб аноним йиғилади.' },
        { title: 'Натижани кўринг', desc: 'Шахсий натижангиз ва синф сигнали кейинги босқичда очилади.' },
      ],
    },
    roles: {
      label: 'Ким учун',
      teacherTitle: 'Ўқитувчилар',
      teacherSub: 'Савол тузиш, cast қилиш ва натижани бир жойда бошқаринг.',
      teacherPoints: [
        'AI савол генерацияси',
        'Жонли синф сигнали',
        'Автоматик ҳисобот',
      ],
      teacherCta: 'Ўқитувчи сифатида бошлаш',
      studentTitle: 'Талабалар',
      studentSub: 'Код билан уланинг ва аноним жавоб беринг.',
      studentPoints: [
        'Телефонда жавоб бериш',
        'Шахсий натижа',
        'Рейтинг махфийлиги',
      ],
      studentCta: 'Талаба сифатида уланиш',
    },
    features: {
      title: 'Имкониятлар',
      desc: 'Дарсни далилга таяниб бошқаринг — қоғоз ва сонияларда.',
      cards: [
        { title: 'Хавфсиз топшириш', desc: 'Preflight ва secure submit — иш ҳеч қачон йўқолмайди.' },
        { title: 'Синф сигнали', desc: 'Доминант хато бир қарашда: мозаика ва йўлак графиги.' },
        { title: 'Автоматик баҳолаш', desc: 'Rubric бўйича AI баҳолайди, натижа серверда тасдиқланади.' },
        { title: 'Тараққиёт', desc: 'Синф даражасидаги натижалар ва ўсиш динамикаси.' },
        { title: 'Қамров харитаси', desc: 'Қайси мавзу заифлигини синф бўйлаб кўрасиз.' },
        { title: 'AI ёрдамчи', desc: 'Мавзуни тушунтиради, савол ва материал таклиф қилади.' },
      ],
    },
    trust: {
      title: 'Ишонч асослари',
      desc: 'Махфийлик, хавфсизлик ва фойдаланиш қулайлиги — таълим муҳитига мос.',
      readMore: 'Батафсил',
      items: [
        { icon: 'privacy', title: 'Махфийлик', desc: 'Жавоблар аноним, шахсий маълумотлар шифрланади.', link: '/privacy' },
        { icon: 'camera', title: 'Назорат', desc: 'Имтиҳонларда камера evidence опцияси.', link: '/security' },
        { icon: 'a11y', title: 'Фойдаланиш', desc: 'WCAG 2.2 AA — барча учун очиқ интерфейс.', link: '/accessibility' },
        { icon: 'rank', title: 'Тартиб', desc: 'Server-confirmed натижалар ва аудит журнали.', link: '/security' },
      ],
    },
    cta: {
      title: 'Дарсингизни жонли ўлчашни бошланг',
      desc: 'Рўйхатдан ўтинг ва савол тузишни синаб кўринг.',
      button: 'Бошлаш',
    },
    footer: {
      colProduct: 'Маҳсулот',
      productFeatures: 'Имкониятлар',
      productDemo: 'Демо',
      productHow: 'Қандай ишлайди',
      productRoles: 'Роллар',
      colCast: 'Cast',
      castJoin: 'Код билан уланиш',
      colLegal: 'Ҳужжатлар',
      terms: 'Шартлар',
      privacy: 'Махфийлик',
      security: 'Хавфсизлик',
      accessibility: 'Фойдаланиш',
      colUtility: 'Хизмат',
      admin: 'Администратор',
      telegram: 'Telegram',
      langs: 'Тиллар',
      rights: '© 2026 Deborah. Барча ҳуқуқлар ҳимояланган.',
    },
  },

  ru: {
    meta: {
      title: 'Deborah — система живого оценивания',
      description: 'Создайте вопрос, выведите на экран аудитории, следите за ответами вживую. Живое оценивание для преподавателей вузов.',
    },
    header: {
      cta: 'Вход',
      switcherLabel: 'Выбор языка',
    },
    hero: {
      badge: 'Система живого оценивания',
      h1: 'Узнайте, что понял класс — прямо на занятии',
      sub: 'Вы выводите вопрос на экран, студенты отвечают анонимно с телефона, результат собирается сразу и видна доминирующая ошибка. Вы продолжаете занятие на основе этого факта.',
      ctaPrimary: 'Подготовить занятие',
      ctaSecondary: 'Посмотреть демо',
      participantCta: 'Войти по коду',
    },
    stage: {
      label: 'Живая сессия',
      participants: '30 участников',
      question: 'Какой оператор SQL удаляет повторяющиеся записи?',
      coverage: 'Охват: 30/30',
      discuss: 'Рекомендуем обсудить',
      correct: 'Верно: 82%',
      phoneValues: ['SELECT DISTINCT', 'SELECT UNIQUE ALL', 'SELECT FILTER', 'SELECT REMOVE'],
    },
    demo: {
      title: 'Мини-демо — попробуйте',
      hint: 'Это демо: вопрос выводится, вы выбираете ответ, показывается результат.',
      cta: 'Запустить демо',
    },
    how: {
      title: 'Как это работает',
      teacherTab: 'Преподаватель',
      studentTab: 'Студент',
      teacherSteps: [
        { title: 'Задайте вопрос', desc: 'ИИ готовит тестовый вопрос по теме, или вы берёте из банка.' },
        { title: 'Выведите на экран', desc: 'Вопрос открывается на экране аудитории, студенты отвечают с телефона.' },
        { title: 'Адаптируйте', desc: 'Видите доминирующую ошибку и выбираете обсуждение или повторное объяснение.' },
      ],
      studentSteps: [
        { title: 'Войдите по коду', desc: 'Вводите код от преподавателя и видите вопрос.' },
        { title: 'Ответьте', desc: 'Выбираете вариант — ответ собирается анонимно.' },
        { title: 'Посмотрите результат', desc: 'Личный результат и сигнал аудитории открываются на следующем этапе.' },
      ],
    },
    roles: {
      label: 'Для кого',
      teacherTitle: 'Преподавателям',
      teacherSub: 'Создавайте вопросы, выводите на экран и управляйте результатами в одном месте.',
      teacherPoints: [
        'Генерация вопросов ИИ',
        'Живой сигнал аудитории',
        'Автоматический отчёт',
      ],
      teacherCta: 'Начать как преподаватель',
      studentTitle: 'Студентам',
      studentSub: 'Входите по коду и отвечайте анонимно.',
      studentPoints: [
        'Ответ с телефона',
        'Личный результат',
        'Конфиденциальность рейтинга',
      ],
      studentCta: 'Войти как студент',
    },
    features: {
      title: 'Возможности',
      desc: 'Управляйте занятием на основе фактов — на бумаге и за секунды.',
      cards: [
        { title: 'Безопасная сдача', desc: 'Preflight и secure submit — работа не теряется никогда.' },
        { title: 'Сигнал аудитории', desc: 'Доминирующая ошибка с одного взгляда: мозаика и график.' },
        { title: 'Автопроверка', desc: 'ИИ оценивает по рубрике, результат подтверждается на сервере.' },
        { title: 'Прогресс', desc: 'Результаты на уровне аудитории и динамика роста.' },
        { title: 'Карта охвата', desc: 'Видите слабые темы по всей аудитории.' },
        { title: 'ИИ-помощник', desc: 'Объясняет тему, предлагает вопросы и материалы.' },
      ],
    },
    trust: {
      title: 'Основания доверия',
      desc: 'Конфиденциальность, безопасность и доступность — подходит для образования.',
      readMore: 'Подробнее',
      items: [
        { icon: 'privacy', title: 'Конфиденциальность', desc: 'Ответы анонимны, личные данные шифруются.', link: '/privacy' },
        { icon: 'camera', title: 'Контроль', desc: 'Опция видеосвидетельства на экзаменах.', link: '/security' },
        { icon: 'a11y', title: 'Доступность', desc: 'WCAG 2.2 AA — интерфейс открыт для всех.', link: '/accessibility' },
        { icon: 'rank', title: 'Порядок', desc: 'Server-confirmed результаты и журнал аудита.', link: '/security' },
      ],
    },
    cta: {
      title: 'Начните живое измерение занятия',
      desc: 'Зарегистрируйтесь и попробуйте создать вопрос.',
      button: 'Начать',
    },
    footer: {
      colProduct: 'Продукт',
      productFeatures: 'Возможности',
      productDemo: 'Демо',
      productHow: 'Как работает',
      productRoles: 'Роли',
      colCast: 'Cast',
      castJoin: 'Войти по коду',
      colLegal: 'Документы',
      terms: 'Условия',
      privacy: 'Конфиденциальность',
      security: 'Безопасность',
      accessibility: 'Доступность',
      colUtility: 'Сервис',
      admin: 'Администратор',
      telegram: 'Telegram',
      langs: 'Языки',
      rights: '© 2026 Deborah. Все права защищены.',
    },
  },

  en: {
    meta: {
      title: 'Deborah — live assessment platform',
      description: 'Write a question, cast it to the class screen, watch answers live. Live assessment for higher-education instructors.',
    },
    header: {
      cta: 'Sign in',
      switcherLabel: 'Language switcher',
    },
    hero: {
      badge: 'Live assessment platform',
      h1: 'See what your class understands — during the lesson',
      sub: 'You cast a question to the screen, students answer anonymously on their phones, results aggregate instantly and the dominant error becomes visible. You continue the lesson based on that evidence.',
      ctaPrimary: 'Prepare a lesson',
      ctaSecondary: 'See the demo',
      participantCta: 'Join with a code',
    },
    stage: {
      label: 'Live session',
      participants: '30 participants',
      question: 'Which SQL operator removes duplicate rows?',
      coverage: 'Coverage: 30/30',
      discuss: 'Discuss recommended',
      correct: 'Correct: 82%',
      phoneValues: ['SELECT DISTINCT', 'SELECT UNIQUE ALL', 'SELECT FILTER', 'SELECT REMOVE'],
    },
    demo: {
      title: 'Mini demo — try it',
      hint: 'This is a demo: a question is cast, you pick an answer, the result is shown.',
      cta: 'Start the demo',
    },
    how: {
      title: 'How it works',
      teacherTab: 'Instructor',
      studentTab: 'Student',
      teacherSteps: [
        { title: 'Ask', desc: 'AI drafts a test question from the topic, or you pick one from the bank.' },
        { title: 'Cast', desc: 'The question opens on the class screen; students answer on their phones.' },
        { title: 'Adapt', desc: 'You see the dominant error and choose discussion or a re-explanation.' },
      ],
      studentSteps: [
        { title: 'Join with a code', desc: 'Enter the code from your instructor and see the question.' },
        { title: 'Answer', desc: 'Pick an option — your answer is collected anonymously.' },
        { title: 'See the result', desc: 'Your personal result and the class signal open at the next stage.' },
      ],
    },
    roles: {
      label: 'Who it is for',
      teacherTitle: 'Instructors',
      teacherSub: 'Author questions, cast them and manage results in one place.',
      teacherPoints: [
        'AI question generation',
        'Live class signal',
        'Automatic reports',
      ],
      teacherCta: 'Start as instructor',
      studentTitle: 'Students',
      studentSub: 'Join with a code and answer anonymously.',
      studentPoints: [
        'Answer on your phone',
        'Personal result',
        'Private ranking',
      ],
      studentCta: 'Join as student',
    },
    features: {
      title: 'Features',
      desc: 'Run the class on evidence — on paper and in seconds.',
      cards: [
        { title: 'Safe submit', desc: 'Preflight and secure submit — work is never lost.' },
        { title: 'Class signal', desc: 'The dominant error at a glance: mosaic and rail chart.' },
        { title: 'Auto-grading', desc: 'AI grades against a rubric; the result is server-confirmed.' },
        { title: 'Progress', desc: 'Class-level results and growth dynamics.' },
        { title: 'Coverage map', desc: 'See which topics are weak across the class.' },
        { title: 'AI assistant', desc: 'Explains topics and suggests questions and materials.' },
      ],
    },
    trust: {
      title: 'Basis of trust',
      desc: 'Privacy, security and accessibility — built for education.',
      readMore: 'Learn more',
      items: [
        { icon: 'privacy', title: 'Privacy', desc: 'Answers are anonymous; personal data is encrypted.', link: '/privacy' },
        { icon: 'camera', title: 'Proctoring', desc: 'Camera evidence option for exams.', link: '/security' },
        { icon: 'a11y', title: 'Accessibility', desc: 'WCAG 2.2 AA — an interface open to everyone.', link: '/accessibility' },
        { icon: 'rank', title: 'Order', desc: 'Server-confirmed results and an audit log.', link: '/security' },
      ],
    },
    cta: {
      title: 'Start measuring your lesson live',
      desc: 'Register and try authoring a question.',
      button: 'Get started',
    },
    footer: {
      colProduct: 'Product',
      productFeatures: 'Features',
      productDemo: 'Demo',
      productHow: 'How it works',
      productRoles: 'Roles',
      colCast: 'Cast',
      castJoin: 'Join with a code',
      colLegal: 'Documents',
      terms: 'Terms',
      privacy: 'Privacy',
      security: 'Security',
      accessibility: 'Accessibility',
      colUtility: 'Service',
      admin: 'Administrator',
      telegram: 'Telegram',
      langs: 'Languages',
      rights: '© 2026 Deborah. All rights reserved.',
    },
  },
};

export const STATS_COPY = {
  uz: {
    title: 'Ochiq ma\'lumotlar',
    universitiesLabel: 'oliy ta\'lim muassasasi',
    studentsLabel: 'talaba',
    sourceLabel: 'Manba:',
    licenseLabel: 'litsenziya',
  },
  'uz-cyrl': {
    title: 'Очиқ маълумотлар',
    universitiesLabel: 'олий таълим муассасаси',
    studentsLabel: 'талаба',
    sourceLabel: 'Манба:',
    licenseLabel: 'лицензия',
  },
  ru: {
    title: 'Открытые данные',
    universitiesLabel: 'высших учебных заведений',
    studentsLabel: 'студентов',
    sourceLabel: 'Источник:',
    licenseLabel: 'лицензия',
  },
  en: {
    title: 'Open data',
    universitiesLabel: 'higher education institutions',
    studentsLabel: 'students',
    sourceLabel: 'Source:',
    licenseLabel: 'license',
  },
};
