(function(){
  'use strict';
  /* ═══ DEBORAH LANDING — tasdiqlangan demo 1:1 ═══
     I18N + theme + reveal + cast-loop + stats + cards + route + signal + tabs
     Farq (real ulanish): fReg submit → username email'dan hosilanadi;
     fLogin — native POST /user/login (CSRF bilan). */
  /* ═══ I18N ═══ */
  var I18N={
  uz:{
    'hdr.kirish':'Kirish','nav.feat':'Imkoniyatlar','nav.qadam':'Qadamlar','nav.signal':'Signal','nav.kirish':'Kirish',
    'hero.kicker':"O'qituvchilar uchun · AI yordamchi bilan",
    'hero.h1':'O\'qituvchi ishi — <em>yengil</em>.<br>Dars — samarali.',
    'hero.lede':"Savol tuzish, slaydlar, baholash, qog'oz tekshirish — AI yordamchi bularni soniyalarda bajaradi. Siz darsga va talabalarga vaqt ajratasiz.",
    'hero.cta1':'Bepul boshlash','hero.cta2':'Imkoniyatlar','hero.scroll':'Scroll · imkoniyatlar',
    'beam.tx':'uzatilmoqda…','live.live':'jonli',
    'live.q':"SQL'da jadvaldan takroriy yozuvlarni olib tashlab, faqat unikallarini qaytaruvchi operator qaysi?",
    'live.cap':'Response mosaic · 42 javob','live.dev':'Dominant xato: B · 43%',
    'live.f1':'Savol cast qilindi','live.f2':"javoblar yig'ilmoqda",
    'stats.s1':'Savol tayyorlash — AI bilan','stats.s2':'AI yordamchi funksiyalar','stats.s3':'Tushunish o\'sishi',
    'feat.k':'Imkoniyatlar',
    'feat.h2':'O\'qituvchi ishini <em>yengillashtiradigan</em> imkoniyatlar.',
    'feat.p':'AI yordamchi rutin ishlarni o\'z zimmasiga oladi — siz o\'qitishga e\'tibor berasiz.',
    'feat.hint':'Imkoniyatni tanlang — tafsilot ochiladi',
    'feat.c1t':'AI savol generatsiyasi','feat.c1s':'Mavzudan test savollari soniyalarda.','feat.c1m':'50/30/20 taqsimot va validatorlar bilan; tayyor bankdan ham tanlash mumkin.',
    'feat.c2t':'AI slaydlar','feat.c2s':'Dars taqdimoti avtomatik tayyorlanadi.','feat.c2m':"Canva, Google Slides va Gamma'ga bir tugma bilan eksport qilinadi.",
    'feat.c3t':'AI baholash','feat.c3s':'Erkin javoblar avtomatik baholanadi.','feat.c3m':'Rubric va mezonlar asosida; natija serverda tasdiqlanadi.',
    'feat.c4t':'Maqola tavsiyalari','feat.c4s':"Har bir mavzu uchun o'qish materiallari.",'feat.c4m':'Maqolalar va manbalar avtomatik tavsiya etiladi.',
    'feat.c5t':"Qog'oz + OCR",'feat.c5s':"Qog'oz javob varaqlari skanerlanadi.",'feat.c5m':"OMR belgilash, qo'lyozma va matn OCR — barchasi bitta joyda.",
    'feat.c6t':'Savollar banki','feat.c6s':'QTI import/eksport va rubric.','feat.c6m':'Savollar, rubric va competency — bitta bankda.',
    'feat.c7t':'Jonli viktorina','feat.c7s':'Savol sinf ekraniga uzatiladi.','feat.c7m':"Javoblar jonli yig'iladi; signal va mosaic ko'rsatiladi.",
    'feat.c8t':'Hisobot','feat.c8s':'Dars yakunida avtomatik hisobot.','feat.c8m':'Sinf darajasidagi tahlil va natijalar.',
    'feat.c9t':'Imtihon nazorati','feat.c9s':'Kamera evidence bilan nazorat.','feat.c9m':'Xavfsizlik profillari va proctor hodisalari.',
    'qadam.k':'Qanday ishlaydi','qadam.h2':'Uch oddiy <em>qadam</em>.',
    'qadam.p':'Tayyorlang, uzating, tahlil qiling — qolganini tizim bajaradi.',
    'qadam.cite':'Yarat → Uzat → Tahlil',
    'qadam.l1':'01 · YARAT','qadam.l2':'02 · UZAT','qadam.l3':'03 · TAHLIL',
    'qadam.c1t':'Yarat','qadam.c1p':'Savol AI yordamida yoki bankdan tanlanadi — bir necha soniya.',
    'qadam.c2t':'Uzat','qadam.c2p':'Savol sinf ekraniga uzatiladi; javoblar telefonda ochiladi.',
    'qadam.c3t':'Tahlil','qadam.c3p':'Signal va hisobot: sinf holati bir qarashda.',
    'signal.k':'Sinf signali','signal.h2':'Tushunish — <em>dalil bilan</em> o\'lchanadi.',
    'signal.p':'Bitta savol, bitta muhokama: tushunish 43% dan 82% ga — o\'lchangan va tasdiqlangan.',
    'signal.col1':'Birinchi o\'lchov','signal.col2':'Muhokamadan keyin',
    'signal.mos1':'Response mosaic · 42 javob','signal.mos2':'Muhokamadan keyin',
    'signal.foot':'Bitta savol · tushunish <b>43% → 82%</b>',
    'signal.note':'Server-confirmed · shaxsiy reyting maxfiy',
    'auth.k':"O'qituvchi hisobi",'auth.h2':"O'qituvchi sifatida kirish",
    'auth.regTeacher':"Adminga so'rov yuborish",
    'auth.doneRegT':"So'rov adminga yuborildi. Tasdiqlashdan keyin hisob ochiladi — o'z-o'zidan ro'yxat yo'q.",
    'auth.google':'Google bilan kirish','auth.oneid':'OneID bilan kirish','auth.or':'yoki email bilan',
    'auth.name':'Ism va familiya','auth.email':'Email','auth.pass':'Parol',
    'auth.login':'Kirish','auth.register':"Adminga so'rov yuborish",
    'auth.doneLogin':'Kirish ruxsat tasdiqlangach ochiladi.',
    'auth.consent':'Maxfiylik siyosati va foydalanish shartlariga roziman',
    'auth.soon':'Tez orada ochiladi — hozir email bilan kiring',
    'cred.c1':'HEMIS / OneID','cred.c2':'Server-confirmed','cred.c3':'WCAG 2.2 AA','cred.c4':'QTI import',
    'cta.h2':'Ishni <em>osonlashtiring</em>.',
    'cta.p':"Ruxsat OTM ma'muriyati tomonidan beriladi. Tasdiqlash kutilayotganda ham imkoniyatlarni ko'rib chiqing.",
    'cta.b1':'Kirish','cta.b2':'Imkoniyatlar',
    'cta.stamp':'AI · CAST · SIGNAL · HISOBOT',
    'ftr.col1t':'Sahifalar','ftr.l1':'Cast','ftr.l2':'Imkoniyatlar','ftr.l3':'Kirish',
    'ftr.col2t':'Hujjatlar','ftr.l5':'Maxfiylik siyosati','ftr.l6':'Foydalanish shartlari','ftr.l7':'Xavfsizlik','ftr.l8':'Qonuniy ma\'lumot',
    'ftr.col3t':'Aloqa','ftr.l9':'Status',
    'ftr.col4t':'Til',
    'ftr.legal':'© 2026 Deborah · O\'qituvchilar uchun AI yordamchi'
  },
  ru:{
    'hdr.kirish':'Вход','nav.feat':'Возможности','nav.qadam':'Шаги','nav.signal':'Сигнал','nav.kirish':'Вход',
    'hero.kicker':'Для преподавателей · С ИИ-помощником',
    'hero.h1':'Работа преподавателя — <em>легче</em>.<br>Занятие — эффективнее.',
    'hero.lede':'Составление вопросов, слайды, проверка, обработка бумажных бланков — ИИ-помощник делает это за секунды. Вы уделяете время занятию и студентам.',
    'hero.cta1':'Начать бесплатно','hero.cta2':'Возможности','hero.scroll':'Листайте · возможности',
    'beam.tx':'передаётся…','live.live':'в эфире',
    'live.q':'Какой оператор SQL удаляет повторяющиеся записи и возвращает только уникальные?',
    'live.cap':'Response mosaic · 42 ответа','live.dev':'Доминирующая ошибка: B · 43%',
    'live.f1':'Вопрос транслирован','live.f2':'ответы собираются',
    'stats.s1':'Вопрос за секунды — с ИИ','stats.s2':'ИИ-функций','stats.s3':'Рост понимания',
    'feat.k':'Возможности',
    'feat.h2':'Возможности, которые <em>облегчают работу преподавателя</em>.',
    'feat.p':'ИИ-помощник берёт на себя рутину — вы занимаетесь преподаванием.',
    'feat.hint':'Выберите возможность — откроются детали',
    'feat.c1t':'Генерация вопросов ИИ','feat.c1s':'Тестовые вопросы по теме за секунды.','feat.c1m':'Распределение 50/30/20 и валидаторы; можно брать из готового банка.',
    'feat.c2t':'Слайды ИИ','feat.c2s':'Презентация занятия готовится автоматически.','feat.c2m':'Экспорт в Canva, Google Slides и Gamma одним действием.',
    'feat.c3t':'Проверка ИИ','feat.c3s':'Свободные ответы проверяются автоматически.','feat.c3m':'По рубрике и критериям; результат подтверждается на сервере.',
    'feat.c4t':'Рекомендация материалов','feat.c4s':'Чтение для каждой темы.','feat.c4m':'Статьи и источники подбираются автоматически.',
    'feat.c5t':'Бумага + OCR','feat.c5s':'Бумажные бланки сканируются.','feat.c5m':'Разметка OMR, рукописный и печатный текст — всё в одном месте.',
    'feat.c6t':'Банк вопросов','feat.c6s':'Импорт/экспорт QTI и рубрики.','feat.c6m':'Вопросы, рубрики и компетенции — в одном банке.',
    'feat.c7t':'Живая викторина','feat.c7s':'Вопрос выводится на экран.','feat.c7m':'Ответы собираются в реальном времени; сигнал и mosaic.',
    'feat.c8t':'Отчёты','feat.c8s':'Автоматический отчёт после занятия.','feat.c8m':'Анализ и результаты на уровне аудитории.',
    'feat.c9t':'Надзор за экзаменом','feat.c9s':'Контроль с видеосвидетельством.','feat.c9m':'Профили безопасности и события проктора.',
    'qadam.k':'Как это работает','qadam.h2':'Три простых <em>шага</em>.',
    'qadam.p':'Подготовьте, выведите на экран, проанализируйте — остальное система делает сама.',
    'qadam.cite':'Создать → Вывести → Проанализировать',
    'qadam.l1':'01 · СОЗДАТЬ','qadam.l2':'02 · ВЫВЕСТИ','qadam.l3':'03 · АНАЛИЗ',
    'qadam.c1t':'Создать','qadam.c1p':'Вопрос готовится с ИИ или выбирается из банка — за секунды.',
    'qadam.c2t':'Вывести','qadam.c2p':'Вопрос выводится на экран аудитории; ответы открываются на телефонах.',
    'qadam.c3t':'Анализ','qadam.c3p':'Сигнал и отчёт: состояние аудитории с одного взгляда.',
    'signal.k':'Сигнал аудитории','signal.h2':'Понимание измеряется <em>доказательством</em>.',
    'signal.p':'Один вопрос, одно обсуждение: понимание выросло с 43% до 82% — измерено и подтверждено.',
    'signal.col1':'Первый замер','signal.col2':'После обсуждения',
    'signal.mos1':'Response mosaic · 42 ответа','signal.mos2':'После обсуждения',
    'signal.foot':'Один вопрос · понимание <b>43% → 82%</b>',
    'signal.note':'Подтверждено сервером · личный рейтинг конфиденциален',
    'auth.k':'Deborah hisobi','auth.h2':'Hisobingizga kiring',
    'auth.regTeacher':'Отправить запрос администратору',
    'auth.doneRegT':'Запрос отправлен администратору. Доступ откроется после подтверждения — самостоятельной регистрации нет.',
    'auth.google':'Войти через Google','auth.oneid':'Войти через OneID','auth.or':'или по email',
    'auth.name':'Имя и фамилия','auth.email':'Email','auth.pass':'Пароль',
    'auth.login':'Вход','auth.register':'Отправить запрос администратору',
    'auth.doneLogin':'Вход откроется после подтверждения доступа.',
    'auth.consent':'Я согласен с политикой конфиденциальности и условиями использования',
    'auth.soon':'Откроется скоро — пока войдите по email',
    'cred.c1':'HEMIS / OneID','cred.c2':'Подтверждение сервером','cred.c3':'WCAG 2.2 AA','cred.c4':'Импорт QTI',
    'cta.h2':'Сделайте работу <em>проще</em>.',
    'cta.p':'Доступ назначается администрацией вуза. Пока идёт одобрение — изучите возможности.',
    'cta.b1':'Вход','cta.b2':'Возможности',
    'cta.stamp':'AI · CAST · SIGNAL · ОТЧЁТ',
    'ftr.col1t':'Страницы','ftr.l1':'Cast','ftr.l2':'Возможности','ftr.l3':'Вход',
    'ftr.col2t':'Документы','ftr.l5':'Политика конфиденциальности','ftr.l6':'Условия использования','ftr.l7':'Безопасность','ftr.l8':'Правовая информация',
    'ftr.col3t':'Контакты','ftr.l9':'Статус',
    'ftr.col4t':'Язык',
    'ftr.legal':'© 2026 Deborah · Для преподавателей — ИИ-помощник'
  },
  en:{
    'hdr.kirish':'Sign in','nav.feat':'Capabilities','nav.qadam':'Steps','nav.signal':'Signal','nav.kirish':'Sign in',
    'hero.kicker':'For instructors · With an AI assistant',
    'hero.h1':'Instructor work — <em>lighter</em>.<br>Lessons — more effective.',
    'hero.lede':'Writing questions, slides, grading, scanning paper — the AI assistant does these in seconds. You spend time on teaching and students.',
    'hero.cta1':'Start free','hero.cta2':'Capabilities','hero.scroll':'Scroll · capabilities',
    'beam.tx':'casting…','live.live':'live',
    'live.q':'Which SQL operator removes duplicate rows and returns only unique ones?',
    'live.cap':'Response mosaic · 42 answers','live.dev':'Dominant error: B · 43%',
    'live.f1':'Question cast','live.f2':'collecting answers',
    'stats.s1':'Question ready in seconds — with AI','stats.s2':'AI-assisted features','stats.s3':'Understanding growth',
    'feat.k':'Capabilities',
    'feat.h2':'Capabilities that <em>lighten the instructor\'s work</em>.',
    'feat.p':'The AI assistant handles the routine — you focus on teaching.',
    'feat.hint':'Select a capability to see the details',
    'feat.c1t':'AI question generation','feat.c1s':'MCQs from a topic in seconds.','feat.c1m':'50/30/20 split with validators; can also pick from the ready bank.',
    'feat.c2t':'AI slides','feat.c2s':'Lesson decks generated automatically.','feat.c2m':'Export to Canva, Google Slides and Gamma with one action.',
    'feat.c3t':'AI grading','feat.c3s':'Free-form answers graded automatically.','feat.c3m':'Based on a rubric and criteria; result is server-confirmed.',
    'feat.c4t':'Article suggestions','feat.c4s':'Reading for every topic.','feat.c4m':'Articles and sources are recommended automatically.',
    'feat.c5t':'Paper + OCR','feat.c5s':'Paper answer sheets are scanned.','feat.c5m':'OMR marking, handwriting and text OCR — all in one place.',
    'feat.c6t':'Question bank','feat.c6s':'QTI import/export and rubrics.','feat.c6m':'Questions, rubrics and competencies — in one bank.',
    'feat.c7t':'Live quiz','feat.c7s':'Cast the question to the screen.','feat.c7m':'Answers are collected live; signal and mosaic shown.',
    'feat.c8t':'Reports','feat.c8s':'Automatic report after each session.','feat.c8m':'Class-level analysis and results.',
    'feat.c9t':'Exam proctoring','feat.c9s':'Proctoring with camera evidence.','feat.c9m':'Security profiles and proctor events.',
    'qadam.k':'How it works','qadam.h2':'Three simple <em>steps</em>.',
    'qadam.p':'Prepare, cast, analyze — the system does the rest.',
    'qadam.cite':'Create → Cast → Analyze',
    'qadam.l1':'01 · CREATE','qadam.l2':'02 · CAST','qadam.l3':'03 · ANALYZE',
    'qadam.c1t':'Create','qadam.c1p':'A question is drafted with AI or picked from the bank — in seconds.',
    'qadam.c2t':'Cast','qadam.c2p':'The question appears on the class screen; answers open on phones.',
    'qadam.c3t':'Analyze','qadam.c3p':'Signal and report: read the room at a glance.',
    'signal.k':'Class signal','signal.h2':'Understanding is measured with <em>evidence</em>.',
    'signal.p':'One question, one discussion: understanding rose from 43% to 82% — measured and confirmed.',
    'signal.col1':'First measurement','signal.col2':'After discussion',
    'signal.mos1':'Response mosaic · 42 answers','signal.mos2':'After discussion',
    'signal.foot':'One question · understanding <b>43% → 82%</b>',
    'signal.note':'Server-confirmed · private ratings stay confidential',
    'auth.k':'Deborah hisobi','auth.h2':'Hisobingizga kiring',
    'auth.regTeacher':'Send request to admin',
    'auth.doneRegT':'Request sent to the admin. Access opens after approval — no self-registration.',
    'auth.google':'Sign in with Google','auth.oneid':'Sign in with OneID','auth.or':'or with email',
    'auth.name':'Full name','auth.email':'Email','auth.pass':'Password',
    'auth.login':'Sign in','auth.register':'Send request to admin',
    'auth.doneLogin':'Sign-in opens after access approval.',
    'auth.consent':'I agree to the privacy policy and terms of use',
    'auth.soon':'Opening soon — for now sign in with email',
    'cred.c1':'HEMIS / OneID','cred.c2':'Server-confirmed','cred.c3':'WCAG 2.2 AA','cred.c4':'QTI import',
    'cta.h2':'Make work <em>easier</em>.',
    'cta.p':'Access is granted by the university administration. While approval is pending, explore the capabilities.',
    'cta.b1':'Sign in','cta.b2':'Capabilities',
    'cta.stamp':'AI · CAST · SIGNAL · REPORT',
    'ftr.col1t':'Pages','ftr.l1':'Cast','ftr.l2':'Capabilities','ftr.l3':'Sign in',
    'ftr.col2t':'Documents','ftr.l5':'Privacy policy','ftr.l6':'Terms of use','ftr.l7':'Security','ftr.l8':'Legal notice',
    'ftr.col3t':'Contact','ftr.l9':'Status',
    'ftr.col4t':'Language',
    'ftr.legal':'© 2026 Deborah · For instructors — AI assistant'
  }};
  var TITLES={uz:'Deborah — o\'qituvchilar uchun AI yordamchi',ru:'Deborah — ИИ-помощник для преподавателей',en:'Deborah — AI assistant for instructors'};
  function applyLang(lang){
    var d=I18N[lang]||I18N.uz;
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k=el.getAttribute('data-i18n');
      if(d[k]!==undefined)el.innerHTML=d[k];
    });
    document.documentElement.setAttribute('lang',lang);
    document.title=TITLES[lang]||d.title;
    document.querySelectorAll('.lang button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-lang')===lang);});
    /* Real formalar: hidden lang sinxron */
    ['loginLang','regLang'].forEach(function(id){var i=document.getElementById(id);if(i)i.value=lang;});
    try{localStorage.setItem('deborah-lang',lang);}catch(e){}
  }
  function applyTheme(t){
    /* DeborahTheme engine (theme-core.js) — yagona haqiqat manbai (S07) */
    if(window.DeborahTheme&&window.DeborahTheme.setState){window.DeborahTheme.setState(t);}
    else{document.documentElement.setAttribute('data-theme',t);}
  }
  var savedLang='uz';
  try{savedLang=localStorage.getItem('deborah-lang')||'uz';}catch(e){}
  /* Tema — faqat DeborahTheme engine (boot script theme-core bilan sinxron) */
  applyLang(savedLang);
  document.querySelectorAll('.lang button').forEach(function(b){
    b.addEventListener('click',function(){applyLang(b.getAttribute('data-lang'));});
  });
  document.querySelectorAll('[data-lang2]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();applyLang(a.getAttribute('data-lang2'));});
  });
  var fx=document.getElementById('modeFx');
  /* theme-segmented + (ixtiyoriy) tbtn — DeborahTheme orqali */
  function bindTheme(el){
    if(!el)return;
    el.addEventListener('click',function(){
      var cur=document.documentElement.getAttribute('data-resolved-theme')||'dark';
      var next=cur==='light'?'dark':'light';
      if(fx){
        var oldBg=getComputedStyle(document.body).backgroundColor;
        fx.style.transition='none';
        fx.style.background=oldBg;
        fx.style.opacity='1';
        void fx.offsetWidth;
        applyTheme(next);
        fx.style.transition='opacity .5s ease';
        fx.style.opacity='0';
      } else { applyTheme(next); }
    });
  }
  document.querySelectorAll('[data-theme-state-btn]').forEach(bindTheme);
  bindTheme(document.getElementById('themeBtn'));
  /* Reveal */
  var io=new IntersectionObserver(function(es){es.forEach(function(en){if(en.isIntersecting){en.target.classList.add('in');io.unobserve(en.target)}})},{threshold:.15});
  document.querySelectorAll('.reveal').forEach(function(el){io.observe(el)});
  /* Cast demo loop — test freeze: __PW_FREEZE__ bo'lsa aylanmaydi (deterministik screenshot) */
  if(window.__PW_FREEZE__){/* deterministik screenshot — demo loop o'chgan */}
  else setTimeout(run,700);
  var q=document.getElementById('q');
  var optEls=document.querySelectorAll('[data-opt]');
  var bars=document.querySelectorAll('.opt .track i');
  var cap=document.querySelector('.cap');
  var devnote=document.getElementById('devnote');
  var beam=document.getElementById('beam');
  var T={q:1300,opts:2100,bars:3000,mosaic:3200,note:4300,total:9000};
  var timers=[];
  function clearT(){timers.forEach(clearTimeout);timers=[];}
  function reset(){
    clearT();beam.style.opacity=0;q.classList.remove('in');
    optEls.forEach(function(o){o.classList.remove('in');});cap.classList.remove('in');
    devnote.style.opacity=0;bars.forEach(function(b){b.style.width='0';});
    cells.forEach(function(c){c.style.opacity=0;c.style.transitionDelay='0s';});
  }
  var cycles=0,MAX_CYCLES=2;
  function run(){
    reset();
    cycles++;
    timers.push(setTimeout(function(){beam.style.opacity=1;},120));
    timers.push(setTimeout(function(){beam.style.opacity=0;q.classList.add('in');},T.q));
    optEls.forEach(function(o,ix){timers.push(setTimeout(function(){o.classList.add('in');},T.opts+ix*140));});
    timers.push(setTimeout(function(){cap.classList.add('in');bars.forEach(function(b){b.style.width=b.getAttribute('data-w')+'%';});},T.bars));
    cells.forEach(function(c,ix){timers.push(setTimeout(function(){c.style.transitionDelay=(ix%10)*90+'ms';c.style.opacity=1;},T.mosaic));});
    timers.push(setTimeout(function(){devnote.style.opacity=1;},T.note));
    if(cycles<MAX_CYCLES){timers.push(setTimeout(run,T.total));}
  }
  var mini=document.getElementById('mini');
  var cells=[];
  (function(){
    var dist=[20,43,27,10],n=42,arr=[];
    dist.forEach(function(d,i){var c=Math.round(d*n/100);for(var k=0;k<c;k++)arr.push(i);});
    while(arr.length<n)arr.push(-1);
    for(var i=arr.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=arr[i];arr[i]=arr[j];arr[j]=t;}
    var cls=['cr','gd','gr','bl'];
    arr.forEach(function(v){
      var d=document.createElement('div');
      d.className='cell'+(v<0?'':' '+cls[v]);
      d.style.opacity=0;mini.appendChild(d);cells.push(d);
    });
  })();
  var t=84;
  setInterval(function(){
    t--;if(t<0)t=0;
    var m=('0'+Math.floor(t/60)).slice(-2),s=('0'+(t%60)).slice(-2);
    document.getElementById('scTime').textContent=m+':'+s;
  },1000);
  /* Stats counters */
  var counted=false;
  var cio=new IntersectionObserver(function(es){es.forEach(function(en){
    if(en.isIntersecting&&!counted){counted=true;countStats();}
  })},{threshold:.4});
  cio.observe(document.querySelector('.stats'));
  function countStats(){
    var a=0,b=0,c=0,d=0,ti=0;
    var iv=setInterval(function(){
      ti++;
      a=Math.min(30,Math.round(30*ti/50));
      b=Math.min(10,Math.round(10*ti/50));
      c=Math.min(43,Math.round(43*ti/50));
      d=Math.min(82,Math.round(82*ti/50));
      document.getElementById('st1').textContent=a+' s';
      document.getElementById('st2').textContent=b+'+';
      document.getElementById('st3').textContent=c+'% → '+d+'%';
      if(ti>=50)clearInterval(iv);
    },30);
  }
  /* Imkoniyatlar: tanlash (blur focus) */
  var grid3=document.querySelector('.grid3');
  var activeCard=null;
  function closeCard(){
    if(!activeCard)return;
    var c=activeCard; activeCard=null;
    grid3.classList.remove('has-active');
    var first=c.getBoundingClientRect();
    c.classList.remove('active');
    var last=c.getBoundingClientRect();
    var dx=first.left-last.left, dy=first.top-last.top;
    var sx=first.width/last.width, sy=first.height/last.height;
    c.style.transition='none';
    c.style.transform='translate(calc(-50% + '+dx+'px), calc(-50% + '+dy+'px)) scale('+sx+','+sy+')';
    void c.offsetWidth;
    c.style.transition='transform .4s cubic-bezier(.22,.61,.36,1)';
    c.style.transform='translate(-50%,-50%) scale(1)';
    setTimeout(function(){c.style.transition='';},420);
  }
  function openCard(c){
    if(activeCard){closeCard();if(activeCard===c)return;}
    grid3.classList.add('has-active');
    var first=c.getBoundingClientRect();
    c.classList.add('active');
    var last=c.getBoundingClientRect();
    var dx=first.left-last.left, dy=first.top-last.top;
    var sx=first.width/last.width, sy=first.height/last.height;
    c.style.transition='none';
    c.style.transform='translate(calc(-50% + '+dx+'px), calc(-50% + '+dy+'px)) scale('+sx+','+sy+')';
    void c.offsetWidth;
    c.style.transition='transform .45s cubic-bezier(.22,.61,.36,1)';
    c.style.transform='translate(-50%,-50%) scale(1)';
    activeCard=c;
  }
  if(grid3){
    grid3.querySelectorAll('.f-card').forEach(function(c){
      c.addEventListener('click',function(){
        if(c.classList.contains('active')){closeCard();}
        else{openCard(c);}
      });
    });
  }
  document.addEventListener('keydown',function(e){if(e.key==='Escape')closeCard();});
  document.addEventListener('click',function(e){
    if(activeCard&&!activeCard.contains(e.target)&&e.target!==grid3)closeCard();
  });
  /* Qadamlar */
  var svg=document.querySelector('.route-svg');
  var route=document.getElementById('route');
  var gold=document.getElementById('routeGold');
  var runner=document.getElementById('runner');
  var checks=document.querySelectorAll('.j-check');
  var cards=document.querySelectorAll('.j-card');
  var total=route?route.getTotalLength():0;
  if(total){gold.style.strokeDasharray=total;gold.style.strokeDashoffset=total;}
  function onScroll(){
    if(!route)return;
    var r=svg.getBoundingClientRect(),vh=window.innerHeight;
    var p=Math.min(Math.max((vh*.6-r.top)/(r.height+vh*.3),0),1);
    var pt=route.getPointAtLength(total*p);
    runner.setAttribute('transform','translate('+pt.x+','+pt.y+')');
    runner.style.opacity=(p>.02&&p<.98)?1:0;
    gold.style.strokeDashoffset=total*(1-p);
    checks.forEach(function(c,i){
      c.classList.toggle('on',p>=(i+.5)/checks.length-.04);
      var card=cards[i];
      if(card){card.style.borderColor=(p>=(i+.5)/checks.length-.1&&p<=(i+.5)/checks.length+.14)?'var(--line2)':'';}
    });
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  onScroll();
  /* Signal panel */
  function mosaic(el,dist){
    var n=42,cells=[];
    dist.forEach(function(d,i){var c=Math.round(d*n/100);for(var k=0;k<c;k++)cells.push(i);});
    while(cells.length<n)cells.push(-1);
    for(var i=cells.length-1;i>0;i--){var j=Math.floor(Math.random()*(i+1));var t=cells[i];cells[i]=cells[j];cells[j]=t;}
    var cls=['cr','gd','gr','bl'];
    cells.forEach(function(v){
      var d=document.createElement('div');
      d.className='cell'+(v<0?'':' '+cls[v]);
      el.appendChild(d);
    });
  }
  mosaic(document.getElementById('mgrid1'),[20,43,27,10]);
  mosaic(document.getElementById('mgrid2'),[82,10,5,3]);
  var counted2=false;
  var pio=new IntersectionObserver(function(es){es.forEach(function(en){
    if(en.isIntersecting&&!counted2){counted2=true;countUp();}
  })},{threshold:.35});
  pio.observe(document.querySelector('.panel'));
  function countUp(){
    document.querySelectorAll('.bar i.crimson')[0].style.width='43%';
    document.querySelectorAll('.bar i.green')[0].style.width='82%';
    var n1=document.getElementById('n1'),n2=document.getElementById('n2');
    var a=0,b=0,ti=0;
    var iv=setInterval(function(){
      ti++;
      a=Math.min(43,Math.round(43*ti/60));
      b=Math.min(82,Math.round(82*ti/60));
      n1.textContent=a+'%';n2.textContent=b+'%';
      if(ti>=60)clearInterval(iv);
    },24);
  }
  /* Auth tabs + messages */
  var tabs=document.querySelectorAll('.tabs button');
  var fLogin=document.getElementById('fLogin'),fReg=document.getElementById('fReg');
  tabs.forEach(function(b){
    b.addEventListener('click',function(){
      var t=b.getAttribute('data-tab');
      tabs.forEach(function(x){x.classList.toggle('on',x===b);});
      fLogin.style.display=(t==='login')?'block':'none';
      fReg.style.display=(t==='reg')?'block':'none';
    });
  });
  document.querySelectorAll('.provider').forEach(function(b){
    b.addEventListener('click',function(){
      var d=I18N[document.documentElement.getAttribute('lang')]||I18N.uz;
      var msg=b.closest('form').querySelector('.auth-msg');
      if(msg){msg.textContent=d['auth.soon'];msg.classList.add('show');msg.style.display='block';
        setTimeout(function(){msg.classList.remove('show');},4200);}
    });
  });
  /* ── REAL ulanish ──
     fReg: username email lokal qismidan hosirlanadi (server pattern [a-zA-Z0-9_]). */
  var rUsername=document.getElementById('rUsername');
  function deriveUsername(){
    var email=(document.getElementById('rEmail').value||'').trim().toLowerCase();
    var local=email.split('@')[0]||'';
    var u=local.replace(/[^a-z0-9_]/g,'_').replace(/^_+|_+$/g,'').slice(0,18);
    if(!u){u='user_'+Math.random().toString(36).slice(2,7);}
    rUsername.value=u;
  }
  document.getElementById('fReg').addEventListener('submit',function(){
    deriveUsername();
    /* native POST davom etadi — server ko'rsatmasi o'sha yerda */
  });
  /* fLogin — native POST /user/login (CSRF + rate limit serverda) */
})();
