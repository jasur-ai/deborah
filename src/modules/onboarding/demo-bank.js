/**
 * AUTH B-17/B-18 — Demo savollar banki (Orient demo + First-win amaliyot)
 * ---------------------------------------------------------------------------
 * Universitar daraja, oson savollar, 4 til. Har fan × til = 5 savol (B-18 §06:
 * 5 savollik amaliyot). Answer key FAQAT server'da — public DTO'da `correct`
 * va `correctIndex` hech qachon chiqmaydi.
 *
 * Har savolda `explain` — elaborative feedback (B-18 §08: noto'g'ri javobga
 * izoh). `getDemoQuestion` (B-17 Orient: 1 savol) birinchi savolni qaytaradi;
 * `getFirstWinSet` (B-18: 5 savol) to'liq to'plamni qaytaradi.
 */
export const DEMO_SUBJECTS = ['matematika', 'dasturlash', 'ingliz_tili', 'tarix'];

export const FIRST_WIN_COUNT = 5;

export const DEMO_SUBJECT_LABELS = {
  matematika: { uz: 'Matematika', 'uz-cyrl': 'Математика', ru: 'Математика', en: 'Mathematics' },
  dasturlash: { uz: 'Dasturlash', 'uz-cyrl': 'Дастурлаш', ru: 'Программирование', en: 'Programming' },
  ingliz_tili: { uz: 'Ingliz tili', 'uz-cyrl': 'Инглиз тили', ru: 'Английский язык', en: 'English' },
  tarix: { uz: 'Tarix', 'uz-cyrl': 'Тарих', ru: 'История', en: 'History' },
};

// ── Bank: fan → til → savol[] (5 tadan). `correct` = to'g'ri option indeksi. ──
const BANK = {
  matematika: {
    uz: [
      { id: 'fwm-math-uz-1', text: '7 × 8 nechaga teng?', options: ['54', '56', '48', '64'], correct: 1, explain: '7 × 8 = 56. Ko\'paytirish jadvalining 7-bosqichi — 7, 14, 21, 28, 35, 42, 49, 56.' },
      { id: 'fwm-math-uz-2', text: '12 + 15 nechaga teng?', options: ['25', '27', '29', '32'], correct: 1, explain: '12 + 15 = 27. O\'nliklar: 10 + 10 = 20, birliklar: 2 + 5 = 7 → 27.' },
      { id: 'fwm-math-uz-3', text: '100 − 37 nechaga teng?', options: ['63', '73', '67', '53'], correct: 0, explain: '100 − 37 = 63. 100 dan 30 ayirsak 70, yana 7 ayirsak 63.' },
      { id: 'fwm-math-uz-4', text: '6 × 7 nechaga teng?', options: ['36', '42', '48', '54'], correct: 1, explain: '6 × 7 = 42. Ko\'paytirish jadvalining 6-bosqichi: 6, 12, 18, 24, 30, 36, 42.' },
      { id: 'fwm-math-uz-5', text: '81 ÷ 9 nechaga teng?', options: ['7', '8', '9', '11'], correct: 2, explain: '81 ÷ 9 = 9, chunki 9 × 9 = 81. Kvadrat ildiz hisoblashning asosi.' },
    ],
    'uz-cyrl': [
      { id: 'fwm-math-cyrl-1', text: '7 × 8 нечага тенг?', options: ['54', '56', '48', '64'], correct: 1, explain: '7 × 8 = 56. Кўпайтириш жадвалининг 7-босқичи.' },
      { id: 'fwm-math-cyrl-2', text: '12 + 15 нечага тенг?', options: ['25', '27', '29', '32'], correct: 1, explain: '12 + 15 = 27. Ўнликлар: 10 + 10 = 20, бирликлар: 2 + 5 = 7.' },
      { id: 'fwm-math-cyrl-3', text: '100 − 37 нечага тенг?', options: ['63', '73', '67', '53'], correct: 0, explain: '100 − 37 = 63. 100 дан 30 айирсак 70, яна 7 айирсак 63.' },
      { id: 'fwm-math-cyrl-4', text: '6 × 7 нечага тенг?', options: ['36', '42', '48', '54'], correct: 1, explain: '6 × 7 = 42. Кўпайтириш жадвалининг 6-босқичи.' },
      { id: 'fwm-math-cyrl-5', text: '81 ÷ 9 нечага тенг?', options: ['7', '8', '9', '11'], correct: 2, explain: '81 ÷ 9 = 9, чунки 9 × 9 = 81.' },
    ],
    ru: [
      { id: 'fwm-math-ru-1', text: 'Сколько будет 7 × 8?', options: ['54', '56', '48', '64'], correct: 1, explain: '7 × 8 = 56. Седьмая строка таблицы умножения.' },
      { id: 'fwm-math-ru-2', text: 'Сколько будет 12 + 15?', options: ['25', '27', '29', '32'], correct: 1, explain: '12 + 15 = 27. Десятки: 10 + 10 = 20, единицы: 2 + 5 = 7.' },
      { id: 'fwm-math-ru-3', text: 'Сколько будет 100 − 37?', options: ['63', '73', '67', '53'], correct: 0, explain: '100 − 37 = 63. 100 − 30 = 70, затем 70 − 7 = 63.' },
      { id: 'fwm-math-ru-4', text: 'Сколько будет 6 × 7?', options: ['36', '42', '48', '54'], correct: 1, explain: '6 × 7 = 42. Шестая строка таблицы умножения.' },
      { id: 'fwm-math-ru-5', text: 'Сколько будет 81 ÷ 9?', options: ['7', '8', '9', '11'], correct: 2, explain: '81 ÷ 9 = 9, так как 9 × 9 = 81.' },
    ],
    en: [
      { id: 'fwm-math-en-1', text: 'What is 7 × 8?', options: ['54', '56', '48', '64'], correct: 1, explain: '7 × 8 = 56. The 7th row of the multiplication table.' },
      { id: 'fwm-math-en-2', text: 'What is 12 + 15?', options: ['25', '27', '29', '32'], correct: 1, explain: '12 + 15 = 27. Tens: 10 + 10 = 20, ones: 2 + 5 = 7.' },
      { id: 'fwm-math-en-3', text: 'What is 100 − 37?', options: ['63', '73', '67', '53'], correct: 0, explain: '100 − 37 = 63. 100 − 30 = 70, then 70 − 7 = 63.' },
      { id: 'fwm-math-en-4', text: 'What is 6 × 7?', options: ['36', '42', '48', '54'], correct: 1, explain: '6 × 7 = 42. The 6th row of the multiplication table.' },
      { id: 'fwm-math-en-5', text: 'What is 81 ÷ 9?', options: ['7', '8', '9', '11'], correct: 2, explain: '81 ÷ 9 = 9 because 9 × 9 = 81.' },
    ],
  },

  dasturlash: {
    uz: [
      { id: 'fwm-prog-uz-1', text: 'HTML nimani anglatadi?', options: ['Hyper Text Markup Language', 'Home Tool Markup Language', 'Hyperlinks Text Markup', 'Hech biri'], correct: 0, explain: 'HTML — Hyper Text Markup Language: sahifa tuzilishini belgilovchi markup tili.' },
      { id: 'fwm-prog-uz-2', text: 'CSS nima uchun ishlatiladi?', options: ['Ma\'lumot saqlash', 'Sahifa uslubi va dizayni', 'Tarmoq ulanishi', 'Parol shifrlash'], correct: 1, explain: 'CSS — Cascading Style Sheets: sahifaning rang, shrift, joylashuv kabi uslubini boshqaradi.' },
      { id: 'fwm-prog-uz-3', text: 'JavaScript qayerda ishlaydi?', options: ['Faqat serverda', 'Faqat ma\'lumotlar bazasida', 'Brauzerda va serverda (Node.js)', 'Faqat operatsion tizimda'], correct: 2, explain: 'JavaScript brauzerda (frontend) va Node.js orqali serverda (backend) ishlaydi.' },
      { id: 'fwm-prog-uz-4', text: 'Loop (tsikl) nima?', options: ['Xatolarni topish', 'Kodni qayta-qayta bajarish', 'Fayl ochish', 'Ma\'lumot shifrlash'], correct: 1, explain: 'Tsikl — kod blokini shart bajarilguncha qayta-qayta bajarish (for, while).' },
      { id: 'fwm-prog-uz-5', text: 'Variable (o\'zgaruvchi) nima?', options: ['Doimiy son', 'Qiymat saqlovchi nomlangan joy', 'Kod izohi', 'Brauzer oynasi'], correct: 1, explain: 'O\'zgaruvchi — qiymatni saqlab, keyin foydalanish uchun nomlangan xotira joyi.' },
    ],
    'uz-cyrl': [
      { id: 'fwm-prog-cyrl-1', text: 'HTML нимани англатади?', options: ['Hyper Text Markup Language', 'Home Tool Markup Language', 'Hyperlinks Text Markup', 'Ҳеч бири'], correct: 0, explain: 'HTML — Hyper Text Markup Language: саҳифа тузилишини белгиловчи маркап тили.' },
      { id: 'fwm-prog-cyrl-2', text: 'CSS нима учун ишлатилади?', options: ['Маълумот сақлаш', 'Саҳифа услуби ва дизайни', 'Тармоқ уланиши', 'Парол шифрлаш'], correct: 1, explain: 'CSS — Cascading Style Sheets: саҳифанинг ранг, шрифт, жойлашув услубини бошқаради.' },
      { id: 'fwm-prog-cyrl-3', text: 'JavaScript қаерда ишлайди?', options: ['Фақат серверда', 'Фақат маълумотлар базасида', 'Браузерда ва серверда (Node.js)', 'Фақат операцион тизимда'], correct: 2, explain: 'JavaScript браузерда (frontend) ва Node.js орқали серверда (backend) ишлайди.' },
      { id: 'fwm-prog-cyrl-4', text: 'Loop (цикл) нима?', options: ['Хатоларни топиш', 'Кодни қайта-қайта бажариш', 'Файл очиш', 'Маълумот шифрлаш'], correct: 1, explain: 'Цикл — код блогини шарт бажарилгунча қайта-қайта бажариш (for, while).' },
      { id: 'fwm-prog-cyrl-5', text: 'Variable (ўзгарувчи) нима?', options: ['Доимий сон', 'Қиймат сақловчи номланган жой', 'Код изоҳи', 'Браузер ойнаси'], correct: 1, explain: 'Ўзгарувчи — қийматни сақлаб, кейин фойдаланиш учун номланган хотира жойи.' },
    ],
    ru: [
      { id: 'fwm-prog-ru-1', text: 'Что означает HTML?', options: ['Hyper Text Markup Language', 'Home Tool Markup Language', 'Hyperlinks Text Markup', 'Ничего из выше'], correct: 0, explain: 'HTML — Hyper Text Markup Language: язык разметки, определяющий структуру страницы.' },
      { id: 'fwm-prog-ru-2', text: 'Для чего используется CSS?', options: ['Хранение данных', 'Стиль и дизайн страницы', 'Сетевое соединение', 'Шифрование пароля'], correct: 1, explain: 'CSS — Cascading Style Sheets: управляет цветом, шрифтом, расположением элементов.' },
      { id: 'fwm-prog-ru-3', text: 'Где работает JavaScript?', options: ['Только на сервере', 'Только в базе данных', 'В браузере и на сервере (Node.js)', 'Только в ОС'], correct: 2, explain: 'JavaScript работает в браузере (frontend) и на сервере через Node.js (backend).' },
      { id: 'fwm-prog-ru-4', text: 'Что такое цикл (loop)?', options: ['Поиск ошибок', 'Повторное выполнение кода', 'Открытие файла', 'Шифрование данных'], correct: 1, explain: 'Цикл — многократное выполнение блока кода, пока условие истинно (for, while).' },
      { id: 'fwm-prog-ru-5', text: 'Что такое переменная?', options: ['Постоянное число', 'Именованное место для хранения значения', 'Комментарий кода', 'Окно браузера'], correct: 1, explain: 'Переменная — именованная область памяти для хранения значения и последующего использования.' },
    ],
    en: [
      { id: 'fwm-prog-en-1', text: 'What does HTML stand for?', options: ['Hyper Text Markup Language', 'Home Tool Markup Language', 'Hyperlinks Text Markup', 'None of the above'], correct: 0, explain: 'HTML stands for Hyper Text Markup Language — the markup language that structures a page.' },
      { id: 'fwm-prog-en-2', text: 'What is CSS used for?', options: ['Storing data', 'Styling and layout of a page', 'Network connections', 'Password encryption'], correct: 1, explain: 'CSS (Cascading Style Sheets) controls the look of a page: colors, fonts, positioning.' },
      { id: 'fwm-prog-en-3', text: 'Where does JavaScript run?', options: ['Server only', 'Database only', 'In the browser and on the server (Node.js)', 'OS only'], correct: 2, explain: 'JavaScript runs in the browser (frontend) and on the server via Node.js (backend).' },
      { id: 'fwm-prog-en-4', text: 'What is a loop?', options: ['Finding bugs', 'Repeating a block of code', 'Opening a file', 'Encrypting data'], correct: 1, explain: 'A loop repeats a block of code until a condition is met (for, while).' },
      { id: 'fwm-prog-en-5', text: 'What is a variable?', options: ['A constant number', 'A named place that stores a value', 'A code comment', 'A browser window'], correct: 1, explain: 'A variable is a named memory location that stores a value for later use.' },
    ],
  },

  ingliz_tili: {
    uz: [
      { id: 'fwm-en-uz-1', text: '"Book" so\'zining ma\'nosi?', options: ['Kitob', 'Daftar', 'Qalam', 'Stol'], correct: 0, explain: '"Book" — kitob. O\'qish uchun mo\'ljallangan sahifalar to\'plami.' },
      { id: 'fwm-en-uz-2', text: '"go" fe\'lining o\'tgan zamon shakli?', options: ['goed', 'went', 'gone', 'going'], correct: 1, explain: '"go"ning o\'tgan zamon shakli — "went" (nopok to\'g\'ri fe\'l).' },
      { id: 'fwm-en-uz-3', text: '"Hello" so\'zining ma\'nosi?', options: ['Xayr', 'Salom', 'Rahmat', 'Kechirasiz'], correct: 1, explain: '"Hello" — salom: kutib olish so\'zi.' },
      { id: 'fwm-en-uz-4', text: '"Apple" nima?', options: ['Sabzavot', 'Meva', 'Gul', 'Daraxt turi'], correct: 1, explain: '"Apple" — olma, meva turi.' },
      { id: 'fwm-en-uz-5', text: '"Big" so\'zining antonimi (qarama-qarshisi)?', options: ['large', 'small', 'tall', 'wide'], correct: 1, explain: '"Big" (katta) ning antonimi — "small" (kichik).' },
    ],
    'uz-cyrl': [
      { id: 'fwm-en-cyrl-1', text: '«Book» сўзининг маъноси?', options: ['Китоб', 'Дафтар', 'Қалам', 'Стол'], correct: 0, explain: '«Book» — китоб.' },
      { id: 'fwm-en-cyrl-2', text: '«go» феълининг ўтган замон шакли?', options: ['goed', 'went', 'gone', 'going'], correct: 1, explain: '«go»нинг ўтган замон шакли — «went» (нотўғри феъл).' },
      { id: 'fwm-en-cyrl-3', text: '«Hello» сўзининг маъноси?', options: ['Хайр', 'Салом', 'Рахмат', 'Кечирасиз'], correct: 1, explain: '«Hello» — салом.' },
      { id: 'fwm-en-cyrl-4', text: '«Apple» нима?', options: ['Сабзавот', 'Мева', 'Гул', 'Дарахт тури'], correct: 1, explain: '«Apple» — олма, мева тури.' },
      { id: 'fwm-en-cyrl-5', text: '«Big» сўзининг антоними?', options: ['large', 'small', 'tall', 'wide'], correct: 1, explain: '«Big» (катта) антоними — «small» (кичик).' },
    ],
    ru: [
      { id: 'fwm-en-ru-1', text: 'Перевод слова "Book"?', options: ['Книга', 'Тетрадь', 'Ручка', 'Стол'], correct: 0, explain: '"Book" — книга.' },
      { id: 'fwm-en-ru-2', text: 'Прошедшая форма глагола "go"?', options: ['goed', 'went', 'gone', 'going'], correct: 1, explain: 'Прошедшая форма "go" — "went" (неправильный глагол).' },
      { id: 'fwm-en-ru-3', text: 'Перевод слова "Hello"?', options: ['Пока', 'Привет', 'Спасибо', 'Извините'], correct: 1, explain: '"Hello" — приветствие.' },
      { id: 'fwm-en-ru-4', text: 'Что такое "Apple"?', options: ['Овощ', 'Фрукт', 'Цветок', 'Вид дерева'], correct: 1, explain: '"Apple" — яблоко, вид фрукта.' },
      { id: 'fwm-en-ru-5', text: 'Антоним слова "Big"?', options: ['large', 'small', 'tall', 'wide'], correct: 1, explain: 'Антоним "big" (большой) — "small" (маленький).' },
    ],
    en: [
      { id: 'fwm-en-en-1', text: 'Choose the correct past form: "go" →', options: ['goed', 'went', 'gone', 'going'], correct: 1, explain: 'The past simple of "go" is "went" (irregular verb).' },
      { id: 'fwm-en-en-2', text: 'What does "hello" mean?', options: ['Goodbye', 'A greeting', 'Thank you', 'Sorry'], correct: 1, explain: '"Hello" is a greeting used when you meet someone.' },
      { id: 'fwm-en-en-3', text: 'An apple is a...', options: ['vegetable', 'fruit', 'flower', 'tree type'], correct: 1, explain: 'An apple is a fruit that grows on trees.' },
      { id: 'fwm-en-en-4', text: 'The opposite of "big" is...', options: ['large', 'small', 'tall', 'wide'], correct: 1, explain: '"Big" and "small" are antonyms — opposite in meaning.' },
      { id: 'fwm-en-en-5', text: 'Which word means "a place where books are kept"?', options: ['school', 'library', 'market', 'office'], correct: 1, explain: 'A library is a place where books are kept and borrowed.' },
    ],
  },

  tarix: {
    uz: [
      { id: 'fwm-hist-uz-1', text: 'Samarqand qaysi davlatda joylashgan?', options: ['O\'zbekiston', 'Qozog\'iston', 'Tojikiston', 'Qirg\'iziston'], correct: 0, explain: 'Samarqand O\'zbekistonning eng qadimiy shaharlaridan biri (2700+ yil).' },
      { id: 'fwm-hist-uz-2', text: 'Amir Temur qaysi sulola asoschisi edi?', options: ['Boburiylar', 'Temuriylar', 'Somoniy', 'Xorazmshohlar'], correct: 1, explain: 'Amir Temur (1336–1405) Temuriylar sulolasiga asos solgan buyuk sarkarda.' },
      { id: 'fwm-hist-uz-3', text: 'O\'zbekistonning poytaxti qaysi shahar?', options: ['Samarqand', 'Buxoro', 'Toshkent', 'Namangan'], correct: 2, explain: 'Toshkent — O\'zbekiston poytaxti va eng yirik shahri.' },
      { id: 'fwm-hist-uz-4', text: 'Registon maydoni qaysi shaharda?', options: ['Buxoro', 'Xiva', 'Samarqand', 'Termiz'], correct: 2, explain: 'Registon — Samarqanddagi mashhur maydon, uchta madrasa bilan o\'ralgan.' },
      { id: 'fwm-hist-uz-5', text: 'Buyuk ipak yo\'li nima edi?', options: ['Harbiy yo\'l', 'Savdo yo\'llari tarmog\'i', 'Temir yo\'l', 'Suv kanali'], correct: 1, explain: 'Buyuk ipak yo\'li — Sharq va G\'arbni bog\'lagan qadimiy savdo yo\'llari tarmog\'i.' },
    ],
    'uz-cyrl': [
      { id: 'fwm-hist-cyrl-1', text: 'Самарқанд қайси давлатда жойлашган?', options: ['Ўзбекистон', 'Қозоғистон', 'Тожикистон', 'Қирғизистон'], correct: 0, explain: 'Самарқанд Ўзбекистоннинг энг қадимий шаҳарларидан бири.' },
      { id: 'fwm-hist-cyrl-2', text: 'Амир Темур қайси сулола асосчиси эди?', options: ['Бобурийлар', 'Темурийлар', 'Сомоний', 'Хоразмшоҳлар'], correct: 1, explain: 'Амир Темур (1336–1405) Темурийлар сулоласига асос солган.' },
      { id: 'fwm-hist-cyrl-3', text: 'Ўзбекистоннинг пойтахти қайси шаҳар?', options: ['Самарқанд', 'Бухоро', 'Тошкент', 'Наманган'], correct: 2, explain: 'Тошкент — Ўзбекистон пойтахти.' },
      { id: 'fwm-hist-cyrl-4', text: 'Регистон майдони қайси шаҳарда?', options: ['Бухоро', 'Хива', 'Самарқанд', 'Термиз'], correct: 2, explain: 'Регистон — Самарқанддаги машҳур майдон.' },
      { id: 'fwm-hist-cyrl-5', text: 'Буюк ипак йўли нима эди?', options: ['Ҳарбий йўл', 'Савдо йўллари тармоғи', 'Темир йўл', 'Сув канали'], correct: 1, explain: 'Буюк ипак йўли — Шарқ ва Ғарбни боғлаган қадимий савдо йўллари тармоғи.' },
    ],
    ru: [
      { id: 'fwm-hist-ru-1', text: 'В какой стране находится Самарканд?', options: ['Узбекистан', 'Казахстан', 'Таджикистан', 'Кыргызстан'], correct: 0, explain: 'Самарканд — один из древнейших городов Узбекистана (2700+ лет).' },
      { id: 'fwm-hist-ru-2', text: 'Основателем какой династии был Амир Темур?', options: ['Бабуриды', 'Тимуриды', 'Саманиды', 'Хорезмшахи'], correct: 1, explain: 'Амир Темур (1336–1405) основал династию Тимуридов.' },
      { id: 'fwm-hist-ru-3', text: 'Столица Узбекистана?', options: ['Самарканд', 'Бухара', 'Ташкент', 'Наманган'], correct: 2, explain: 'Ташкент — столица и крупнейший город Узбекистана.' },
      { id: 'fwm-hist-ru-4', text: 'В каком городе находится площадь Регистан?', options: ['Бухара', 'Хива', 'Самарканд', 'Термез'], correct: 2, explain: 'Регистан — знаменитая площадь в Самарканде, окружённая тремя медресе.' },
      { id: 'fwm-hist-ru-5', text: 'Что такое Великий шёлковый путь?', options: ['Военная дорога', 'Сеть торговых путей', 'Железная дорога', 'Водный канал'], correct: 1, explain: 'Великий шёлковый путь — сеть древних торговых путей, соединявших Восток и Запад.' },
    ],
    en: [
      { id: 'fwm-hist-en-1', text: 'In which country is Samarkand located?', options: ['Uzbekistan', 'Kazakhstan', 'Tajikistan', 'Kyrgyzstan'], correct: 0, explain: 'Samarkand is one of Uzbekistan\'s oldest cities (2700+ years).' },
      { id: 'fwm-hist-en-2', text: 'Which dynasty was founded by Amir Timur?', options: ['Mughals', 'Timurids', 'Samanids', 'Khwarezmshahs'], correct: 1, explain: 'Amir Timur (1336–1405) founded the Timurid dynasty.' },
      { id: 'fwm-hist-en-3', text: 'What is the capital of Uzbekistan?', options: ['Samarkand', 'Bukhara', 'Tashkent', 'Namangan'], correct: 2, explain: 'Tashkent is the capital and largest city of Uzbekistan.' },
      { id: 'fwm-hist-en-4', text: 'In which city is Registan Square?', options: ['Bukhara', 'Khiva', 'Samarkand', 'Termez'], correct: 2, explain: 'Registan is a famous square in Samarkand surrounded by three madrasas.' },
      { id: 'fwm-hist-en-5', text: 'What was the Great Silk Road?', options: ['A military road', 'A network of trade routes', 'A railway', 'A water canal'], correct: 1, explain: 'The Great Silk Road was a network of ancient trade routes linking East and West.' },
    ],
  },
};

function publicDto(q) {
  // Answer key server'da — `correct` va `explain` DTO'da YO'Q (§11).
  return { id: q.id, text: q.text, options: q.options };
}

function subjectLangSet(subject, lang) {
  const set = BANK[subject]?.[lang];
  if (set && set.length >= FIRST_WIN_COUNT) return set;
  // Fallback: shu fanning uz seti (barcha tillar to'liq, lekin himoya uchun)
  return BANK[subject]?.uz || [];
}

/** B-17 Orient: 1 demo savol (public DTO). */
export function getDemoQuestion(subject, lang) {
  const set = subjectLangSet(subject, lang);
  return set[0] ? publicDto(set[0]) : null;
}

/** B-18 §06: 5 savollik to'plam (public DTO'lar). */
export function getFirstWinSet(subject, lang) {
  const set = subjectLangSet(subject, lang);
  return set.slice(0, FIRST_WIN_COUNT).map(publicDto);
}

/**
 * B-17 Orient demo: birinchi savol javobini server'da tekshiradi.
 * (B-18 first-win uchun `checkFirstWinAnswer` — pastga qarang.)
 */
export function checkDemoAnswer(subject, lang, questionId, answerIndex) {
  const set = BANK[subject]?.[lang] || BANK[subject]?.uz || [];
  const q = set.find((x) => x.id === questionId);
  if (!q) return { ok: false, error: 'unknown_question' };
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= q.options.length) {
    return { ok: false, error: 'invalid_answer' };
  }
  return { ok: true, correct: answerIndex === q.correct, correctIndex: q.correct };
}

/**
 * B-18 §08: javobni server'da tekshiradi + elaborative feedback (izoh).
 * `explain` faqat javob berilgach qaytariladi — bank ochiq emas.
 */
export function checkFirstWinAnswer(subject, lang, questionId, answerIndex) {
  const set = BANK[subject]?.[lang] || BANK[subject]?.uz || [];
  const q = set.find((x) => x.id === questionId);
  if (!q) return { ok: false, error: 'unknown_question' };
  if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= q.options.length) {
    return { ok: false, error: 'invalid_answer' };
  }
  return {
    ok: true,
    correct: answerIndex === q.correct,
    correctIndex: q.correct,
    explain: q.explain,
  };
}

/** Bank to'liqligi (test uchun): har fan × til = 5 savol. */
export function demoBankCoverage() {
  const report = {};
  for (const s of DEMO_SUBJECTS) {
    const byLang = {};
    for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) {
      byLang[lang] = (BANK[s]?.[lang] || []).length;
    }
    report[s] = byLang;
  }
  return report;
}

/** B-17 compat: 4 til × 4 fan soni (eski kontrakt — ba'zi testlar ishlatadi). */
export function demoBankCoverageCount() {
  const cov = demoBankCoverage();
  const out = {};
  for (const s of DEMO_SUBJECTS) {
    let total = 0;
    for (const lang of ['uz', 'uz-cyrl', 'ru', 'en']) total += cov[s][lang];
    out[s] = total;
  }
  return out;
}
