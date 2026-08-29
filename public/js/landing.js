
(function(){
  'use strict';
  /* ═══ I18N ═══ */
  var I18N={
  uz:{
    'hdr.kirish':'Kirish',
    'hm.kirish':"O'qituvchi kirishi",'hm.cast':'Cast','hm.documents':'Hujjatlar',
    'join.k':"Tayyor cast",
    'join.h3':"Castga <em>kirish</em>",
    'join.p':'Kodni kiriting.',
    'join.err':'Kod 5–6 belgidan iborat bo\'lishi kerak (cast: 6 harf/raqam).',
    'join.go':'Kirish',
    'join.load':'Ulanmoqda… <i></i>',
    'join.ok':"Siz castga ulandingiz. Savol kutilmoqda.",
    'nav.cast':'Cast','nav.kirish':'Kirish','nav.register':"Ro'yxatdan o'tish",
    'head.kicker':'Savolni sinf ekraniga uzatish',
    'head.h1':'Savol — <em>ekranda</em>. Javob — telefonda.',
    'head.p':"Bir tugma bilan savol sinf ekraniga uzatiladi. Javoblar real vaqtda yig'iladi.",
    'beam.tx':'uzatilmoqda…',
    'live.live':'jonli',
    'live.q':"SQL'da jadvaldan takroriy yozuvlarni olib tashlab, faqat unikallarini qaytaruvchi operator qaysi?",
    'live.cap':'Response mosaic · 42 javob',
    'live.dev':'Dominant xato: B · 43%',
    'live.f1':'Savol cast qilindi','live.f2':"javoblar yig'ilmoqda",
    'under':'Bu — <b>cast</b>: savol ekranda, javoblar telefonda. Har bir savol shu tarzda uzatiladi.',
    'auth.k':"Kirish va ro'yxatdan o'tish",'auth.h2':'Tizimga kirish','auth.t1':'Kirish','auth.t2':"Ro'yxatdan o'tish",'auth.login':'Kirish','auth.register':"Ro'yxatdan o'tish",'auth.doneReg':"Ro'yxatdan o'tdingiz. Endi tizimga kira olasiz.",
    'auth.google':'Google bilan kirish',
    'auth.loginId':'Email yoki username',
    'auth.username':'Username',
    'auth.userFree':'✓ Bo\'sh — mos username',
    'auth.userTaken':'Bu username band — boshqasini tanlang',
    'auth.userReserved':'Bu nom tizim uchun ajratilgan',
    'auth.userInvalid':'2–50 belgi: lotin harflari, raqam, . _ -',
    'auth.passHint':'Kamida 8 belgi — harf va raqam',
    'auth.role':'Rolingiz','auth.roleStudent':'Talaba','auth.roleTeacher':"O'qituvchi",'auth.teacherLink':"O'qituvchi uchun to'liq ariza →",
    'err.net':'Tarmoq xatosi — qayta urinib ko\'ring',
    'err.wait':'Bir necha soniya kuting...','auth.or':'yoki email bilan',
    'auth.name':'Ism va familiya','auth.email':'Email','auth.pass':'Parol',
    'auth.doneLogin':'Kirish ruxsat tasdiqlangach ochiladi.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>kirishi</em>','admin.p':'Faqat administratorlar uchun.',
    'admin.loginL':'Login','admin.passL':'Parol','admin.go':'Kirish','admin.err':'Login yoki parol xato.','admin.ok':'Kirish muvaffaqiyatli',
    'ftr.col1t':'Sahifalar','ftr.l1':'Bosh sahifa','ftr.l2':'Cast','ftr.l3':'Kirish','ftr.l4':"Ro'yxatdan o'tish",
'ftr.teachers':"O'qituvchilar",
    'ftr.col2t':'Hujjatlar','ftr.l5':'Maxfiylik siyosati','ftr.l6':'Foydalanish shartlari','ftr.l7':'Cookie siyosati','ftr.l8':'Qonuniy ma\'lumot',
    'ftr.col3t':'Aloqa','ftr.l9':'Status',
    'ftr.col4t':'Til',
    'prov.g.off':'Google kirish serverda sozlanmagan (GOOGLE_CLIENT_ID). Administratorga murojaat qiling — hozir email bilan kiring.',
    
    'ftr.legal':'© 2026 Deborah · Savolni sinf ekraniga uzatish tizimi'
  },
  /* S14 (BUG-089c): /uz-cyrl landing — 60 ta data-i18n elementi klientda almashtiriladi,
     lekin I18Nda uz-cyrl yo'q edi → aralash skript (server kirill, data-i18n lotin) */
  'uz-cyrl':{
    'hdr.kirish':'Кириш',
    'hm.kirish':'Ўқитувчи кириши','hm.cast':'Cast','hm.documents':'Ҳужжатлар',
    'join.k':'Тайёр cast',
    'join.h3':'Castга <em>кириш</em>',
    'join.p':'Кодни киритинг.',
    'join.err':'Код 5–6 белгидан иборат бўлиши керак (cast: 6 ҳарф/рақам).',
    'join.go':'Кириш',
    'join.load':'Уланмоқда… <i></i>',
    'join.ok':'Сиз castга уланингиз. Савол кутилмоқда.',
    'nav.cast':'Cast','nav.kirish':'Кириш','nav.register':'Рўйхатдан ўтиш',
    'head.kicker':'Саволни синф экранига узатиш',
    'head.h1':'Савол — <em>экранда</em>. Жавоб — телефонда.',
    'head.p':'Бир тугма билан савол синф экранига узатилади. Жавоблар реал вақтда йиғилади.',
    'beam.tx':'узатилмоқда…',
    'live.live':'жонли',
    'live.q':"SQL'да жадвалдан такрорий ёзувларни олиб ташлаб, фақат уникалларини қайтарувчи оператор қайси?",
    'live.cap':'Response mosaic · 42 жавоб',
    'live.dev':'Доминант хато: B · 43%',
    'live.f1':'Савол cast қилинди','live.f2':'жавоблар йиғилмоқда',
    'under':'Бу — <b>cast</b>: савол экранда, жавоблар телефонда. Ҳар бир савол шу тарзда узатилади.',
    'auth.k':'Кириш ва рўйхатдан ўтиш','auth.h2':'Тизимга кириш','auth.t1':'Кириш','auth.t2':'Рўйхатдан ўтиш','auth.login':'Кириш','auth.register':'Рўйхатдан ўтиш','auth.doneReg':'Рўйхатдан ўтдингиз. Энди тизимга кира оласиз.',
    'auth.google':'Google билан кириш',
    'auth.loginId':'Email ёки username',
    'auth.username':'Username',
    'auth.userFree':"✓ Бўш — мос username",
    'auth.userTaken':'Бу username банд — бошқасини танланг',
    'auth.userReserved':'Бу ном тизим учун ажратилган',
    'auth.userInvalid':'2–50 белги: лотин ҳарфлари, рақам, . _ -',
    'auth.passHint':'Камида 8 белги — ҳарф ва рақам',
    'auth.role':'Ролингиз','auth.roleStudent':'Талаба','auth.roleTeacher':'Ўқитувчи','auth.teacherLink':"Ўқитувчи учун тўлиқ ариза →",
    'err.net':'Тармоқ хатоси — қайта уриниб кўринг',
    'err.wait':'Бир неча сония кутинг...','auth.or':'ёки email билан',
    'auth.name':'Исм ва фамилия','auth.email':'Email','auth.pass':'Парол',
    'auth.doneLogin':'Кириш рўхсат тасдиқлангач очилади.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>кириши</em>','admin.p':'Фақат администраторлар учун.',
    'admin.loginL':'Login','admin.passL':'Парол','admin.go':'Кириш','admin.err':'Логин ёки парол хато.','admin.ok':'Кириш муваффақиятли',
    'ftr.col1t':'Саҳифалар','ftr.l1':'Бош саҳифа','ftr.l2':'Cast','ftr.l3':'Кириш','ftr.l4':'Рўйхатдан ўтиш',
    'ftr.teachers':'Ўқитувчилар',
    'ftr.col2t':'Ҳужжатлар','ftr.l5':'Махфийлик сиёсати','ftr.l6':'Фойдаланиш шартлари','ftr.l7':'Cookie сиёсати','ftr.l8':"Қонуний маълумот",
    'ftr.col3t':'Алоқа','ftr.l9':'Status',
    'ftr.col4t':'Тил',
    'prov.g.off':'Google кириш серверда созланмаган (GOOGLE_CLIENT_ID). Администраторга мурожаат қилинг — ҳозир email билан киринг.',
    'ftr.legal':'© 2026 Deborah · Саволни синф экранига узатиш тизими'
  },
  ru:{
    'hdr.kirish':'Вход',
    'hm.kirish':'Вход для учителей','hm.cast':'Cast','hm.documents':'Документы',
    'join.k':'Готовый cast',
    'join.h3':'Вход в <em>cast</em>',
    'join.p':'Введите код.',
    'join.err':'Код должен быть из 5–6 символов (cast: 6 букв/цифр).',
    'join.go':'Войти',
    'join.load':'Подключение… <i></i>',
    'join.ok':'Вы вошли в cast. Ожидайте вопрос.',
    'nav.cast':'Cast','nav.kirish':'Вход','nav.register':'Регистрация',
    'head.kicker':'Трансляция вопроса на экран аудитории',
    'head.h1':'Вопрос — <em>на экране</em>. Ответ — в телефоне.',
    'head.p':'Одним действием вопрос выводится на экран аудитории. Ответы собираются в реальном времени.',
    'beam.tx':'передаётся…',
    'live.live':'в эфире',
    'live.q':'Какой оператор SQL удаляет повторяющиеся записи и возвращает только уникальные?',
    'live.cap':'Response mosaic · 42 ответа',
    'live.dev':'Доминирующая ошибка: B · 43%',
    'live.f1':'Вопрос транслирован','live.f2':'ответы собираются',
    'under':'Это — <b>cast</b>: вопрос на экране, ответы в телефоне. Так передаётся каждый вопрос.',
    'auth.k':'Вход и регистрация','auth.h2':'Вход в систему','auth.t1':'Вход','auth.t2':'Регистрация','auth.login':'Вход','auth.register':'Регистрация','auth.doneReg':'Вы зарегистрированы. Теперь можете войти.',
    'auth.google':'Войти через Google',
    'auth.loginId':'Email или имя пользователя',
    'auth.username':'Имя пользователя',
    'auth.userFree':'✓ Свободно — подходит',
    'auth.userTaken':'Это имя занято — выберите другое',
    'auth.userReserved':'Это имя зарезервировано системой',
    'auth.userInvalid':'2–50 символов: латиница, цифры, . _ -',
    'auth.passHint':'Минимум 8 символов — буквы и цифры',
    'auth.role':'Ваша роль','auth.roleStudent':'Студент','auth.roleTeacher':'Преподаватель','auth.teacherLink':'Полная заявка преподавателя →',
    'err.net':'Ошибка сети — попробуйте ещё раз',
    'err.wait':'Подождите несколько секунд...','auth.or':'или по email',
    'auth.name':'Имя и фамилия','auth.email':'Email','auth.pass':'Пароль',
    'auth.login':'Вход','auth.register':'Отправить запрос администратору',
    'auth.doneLogin':'Вход откроется после подтверждения доступа.',
    'admin.btn':'Admin','admin.k':'Панель админа','admin.h3':'Вход <em>администратора</em>','admin.p':'Только для администраторов.',
    'admin.loginL':'Логин','admin.passL':'Пароль','admin.go':'Войти','admin.err':'Неверный логин или пароль.','admin.ok':'Вход успешен',
    'ftr.col1t':'Страницы','ftr.l1':'Главная','ftr.l2':'Cast','ftr.l3':'Вход','ftr.l4':'Регистрация',
'ftr.teachers':'Преподавателям',
    'ftr.col2t':'Документы','ftr.l5':'Политика конфиденциальности','ftr.l6':'Условия использования','ftr.l7':'Политика cookies','ftr.l8':'Правовая информация',
    'ftr.col3t':'Контакты','ftr.l9':'Статус',
    'ftr.col4t':'Язык',
    'prov.g.off':'Вход через Google не настроен на сервере (GOOGLE_CLIENT_ID). Обратитесь к администратору — пока входите по email.',
    
    'ftr.legal':'© 2026 Deborah · Система трансляции вопроса на экран'
  },
  en:{
    'hdr.kirish':'Sign in',
    'hm.kirish':'Teacher sign in','hm.cast':'Cast','hm.documents':'Documents',
    'join.k':'Ready cast',
    'join.h3':'Join the <em>cast</em>',
    'join.p':'Enter the code.',
    'join.err':'The code must be 5–6 characters (cast: 6 letters/digits).',
    'join.go':'Join',
    'join.load':'Connecting… <i></i>',
    'join.ok':'You joined the cast. Waiting for the question.',
    'nav.cast':'Cast','nav.kirish':'Sign in','nav.register':'Sign up',
    'head.kicker':'Cast a question to the class screen',
    'head.h1':'Question — <em>on screen</em>. Answer — on phone.',
    'head.p':'With one action the question appears on the class screen. Answers are collected in real time.',
    'beam.tx':'casting…',
    'live.live':'live',
    'live.q':'Which SQL operator removes duplicate rows and returns only unique ones?',
    'live.cap':'Response mosaic · 42 answers',
    'live.dev':'Dominant error: B · 43%',
    'live.f1':'Question cast','live.f2':'collecting answers',
    'under':'This is <b>cast</b>: question on screen, answers on phones. Every question is delivered this way.',
    'auth.k':'Sign in & register','auth.h2':'Sign in','auth.t1':'Sign in','auth.t2':'Register','auth.login':'Sign in','auth.register':'Register','auth.doneReg':'You are registered. You can now sign in.',
    'auth.google':'Sign in with Google',
    'auth.loginId':'Email or username',
    'auth.username':'Username',
    'auth.userFree':'✓ Available — good pick',
    'auth.userTaken':'This username is taken — try another',
    'auth.userReserved':'This name is reserved by the system',
    'auth.userInvalid':'2–50 chars: letters, digits, . _ -',
    'auth.passHint':'At least 8 characters — letters and digits',
    'auth.role':'Your role','auth.roleStudent':'Student','auth.roleTeacher':'Teacher','auth.teacherLink':'Full teacher application →',
    'err.net':'Network error — please retry',
    'err.wait':'Please wait a few seconds...','auth.or':'or with email',
    'auth.name':'Full name','auth.email':'Email','auth.pass':'Password',
    'auth.login':'Sign in','auth.register':'Send request to admin',
    'auth.doneLogin':'Sign-in opens after access approval.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>sign-in</em>','admin.p':'Administrators only.',
    'admin.loginL':'Login','admin.passL':'Password','admin.go':'Sign in','admin.err':'Wrong login or password.','admin.ok':'Sign-in successful',
    'ftr.col1t':'Pages','ftr.l1':'Home','ftr.l2':'Cast','ftr.l3':'Sign in','ftr.l4':'Register',
'ftr.teachers':'For instructors',
    'ftr.col2t':'Documents','ftr.l5':'Privacy policy','ftr.l6':'Terms of use','ftr.l7':'Cookie policy','ftr.l8':'Legal notice',
    'ftr.col3t':'Contact','ftr.l9':'Status',
    'ftr.col4t':'Language',
    'prov.g.off':'Google sign-in is not configured on the server (GOOGLE_CLIENT_ID). Contact the administrator — use email for now.',
    
    'ftr.legal':'© 2026 Deborah · Cast questions to the class screen'
  }};
  var TITLES={uz:'Deborah — savolni sinf ekraniga uzatish',ru:'Deborah — трансляция вопроса на экран',en:'Deborah — cast questions to the class screen'};
  function applyLang(lang){
    var d=I18N[lang]||I18N.uz;
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k=el.getAttribute('data-i18n');
      if(d[k]!==undefined)el.innerHTML=d[k];
    });
    document.documentElement.setAttribute('lang', lang === 'uz-cyrl' ? 'uz-Cyrl' : lang); /* S14: BCP-47 canonical */
    document.title=TITLES[lang]||d.title;
    document.querySelectorAll('.lang button').forEach(function(b){b.classList.toggle('on',b.getAttribute('data-lang')===lang);});
    try{localStorage.setItem('deborah-lang',lang);}catch(e){}
    /* Real formalar: hidden lang sinxron */
    ['loginLang','regLang'].forEach(function(id){var i=document.getElementById(id);if(i)i.value=lang;});
  }
  function applyTheme(t){
    /* DeborahTheme engine (theme-core.js) — yagona haqiqat manbai (S07) */
    if(window.DeborahTheme&&window.DeborahTheme.setState){window.DeborahTheme.setState(t);}
    else{document.documentElement.setAttribute('data-theme',t);}
  }
  var savedLang='uz',savedTheme='dark';
  /* BUG-092 (S14): path-based sahifalar (/ru,/en,/uz-cyrl) — server tili USTUN.
     Oldin localStorage (default 'uz') har yuklanishda server renderini bosib o'tardi:
     /ru havolasi ochilsa ham kontent uz'ga qaytardi (SEO/ulashish havolalari buzilgan). */
  var _pl=location.pathname.split('/')[1];
  var pathLang=({'ru':'ru','en':'en','uz-cyrl':'uz-cyrl'})[_pl]||null;
  try{
    savedLang=pathLang||localStorage.getItem('deborah-lang')||'uz';
    /* I18Nga uz-cyrl qo'shildi (BUG-089c) — pathLang qoladi, server+klient bir xil til */
    // Engine kaliti (deborah-theme-state) birinchi — tanlangan tema saqlansin;
    // eski demo kaliti (deborah-theme) migratsiya; hamma yo'q = demo odati: birinchi tashrif dark.
    savedTheme=localStorage.getItem('deborah-theme-state')||localStorage.getItem('deborah-theme')||'dark';
  }catch(e){}
  applyTheme(savedTheme);
  if(savedLang) applyLang(savedLang); /* /uz-cyrl: server render (kirill) o'zgarmaydi */
  document.querySelectorAll('.lang button').forEach(function(b){
    b.addEventListener('click',function(){applyLang(b.getAttribute('data-lang'));});
  });
  document.querySelectorAll('[data-lang2]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();applyLang(a.getAttribute('data-lang2'));});
  });
  /* O'yinga kirish (kod) */
  
  /* ═══ REAL: Join (kod) → /play?code= ═══ */
  var joinOv=document.getElementById('joinOverlay');
  var joinCode=document.getElementById('jcode');
  var joinErr=document.getElementById('joinErr');
  var joinGo=document.getElementById('joinGo');
  var joinMsg=document.getElementById('joinMsg');
  function openJoin(){joinOv.classList.add('open');joinCode.value='';joinErr.classList.remove('show');joinMsg.classList.remove('show');joinGo.style.display='inline-block';setTimeout(function(){joinCode.focus();},80);}
  function closeJoin(){joinOv.classList.remove('open');}
  document.getElementById('joinClose').addEventListener('click',closeJoin);
  joinOv.addEventListener('click',function(e){if(e.target===joinOv)closeJoin();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&joinOv.classList.contains('open'))closeJoin();});
  joinCode.addEventListener('input',function(){
    /* BUG-049: cast kodlari A-Z2-9 (6 belgi) — faqat raqam emas */
    joinCode.value=joinCode.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,7);
    joinErr.classList.remove('show');
  });
  joinGo.addEventListener('click',function(){
    var v=joinCode.value.trim().toUpperCase();
    if(!/^[A-Z0-9]{5,6}$/.test(v)){joinErr.classList.add('show');joinCode.focus();return;}
    joinErr.classList.remove('show');
    joinMsg.classList.add('show');
    joinMsg.querySelector('.ok').style.display='none';
    joinMsg.querySelector('.load').style.display='flex';
    /* REAL: cast sessiyasiga o'tish */
    window.location.href='/play?code='+encodeURIComponent(v);
  });
  document.querySelectorAll('.nav a[href="#cast"], #hmenu a[href="#cast"]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();openJoin();});
  });
  /* Hamburger menyu */
  var hbtn=document.getElementById('hbtn'),hmenu=document.getElementById('hmenu');
  hbtn.addEventListener('click',function(e){e.stopPropagation();var open=hmenu.classList.toggle('open');hbtn.setAttribute('aria-expanded',open?'true':'false');});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'){hmenu.classList.remove('open');hbtn.setAttribute('aria-expanded','false');}});
  document.addEventListener('click',function(e){
    if(!hmenu.contains(e.target)&&e.target!==hbtn)hmenu.classList.remove('open');
  });
  hmenu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){hmenu.classList.remove('open');});});


  /* ═══ Tabs (Kirish / Ro'yxatdan o'tish) ═══ */
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

  /* ═══ REAL: Providerlar (Google) ═══ */
  var PROV=(window.__AUTH_PROVIDERS||{});
  document.querySelectorAll('.provider').forEach(function(b){
    b.addEventListener('click',function(){
      var d=I18N[document.documentElement.getAttribute('lang')]||I18N.uz;
      var prov=b.getAttribute('data-prov');
      var url='/auth/google';
      var on=PROV.google;
      if(on){window.location.href=url;return;}
      var msg=b.closest('form').querySelector('.auth-msg');
      if(msg){
        msg.textContent=d['prov.g.off'];
        msg.classList.add('show');
        setTimeout(function(){msg.classList.remove('show');},5200);
      }
    });
  });

  /* ═══ REAL: fReg — username LIVE tekshiruv (band/mavjud) ═══ */
  var doneReg=document.getElementById('doneReg');
  var rUser=document.getElementById('rUser');
  var rUserHint=document.getElementById('rUserHint');
  var userState={ok:false,checked:''};
  var userTimer=null;
  function L(){return I18N[document.documentElement.getAttribute('lang')]||I18N.uz;}
  rUser.addEventListener('input',function(){
    var v=rUser.value.trim();
    rUser.classList.remove('ok','err');rUserHint.className='fld-hint';rUserHint.textContent='';
    userState={ok:false,checked:v};
    clearTimeout(userTimer);
    if(!v){return;}
    if(v.length<2||v.length>50){rUser.classList.add('err');rUserHint.classList.add('err');rUserHint.textContent=L()['auth.userInvalid'];return;}
    userTimer=setTimeout(function(){
      fetch('/user/login/username-check?username='+encodeURIComponent(v),{credentials:'same-origin'})
        .then(function(r){return r.json();})
        .then(function(j){
          if(userState.checked!==v||j.reason==='rate'){return;}
          if(j.ok){rUser.classList.add('ok');rUserHint.classList.add('ok');rUserHint.textContent=L()['auth.userFree'];userState={ok:true,checked:v};}
          else{rUser.classList.add('err');rUserHint.classList.add('err');rUserHint.textContent=L()[j.reason==='taken'?'auth.userTaken':j.reason==='reserved'?'auth.userReserved':'auth.userInvalid'];userState={ok:false,checked:v};}
        }).catch(function(){});
    },450);
  });

  /* ═══ REAL: fetch submit (X-Landing JSON rejimi) — xato JOYIDA, 2-panel YO'Q ═══ */
  function submitAuth(formId,msgId,preCb){
    var form=document.getElementById(formId);
    var msg=document.getElementById(msgId);
    var btn=form.querySelector('.auth-submit');
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var d=L();
      if(preCb&&preCb(d)===false){return;}
      btn.disabled=true;var old=btn.innerHTML;btn.textContent=d['err.wait']||'...';
      msg.classList.remove('show');
      fetch(form.getAttribute('action'),{
        method:'POST',
        headers:{'content-type':'application/x-www-form-urlencoded','X-Landing':'1'},
        body:new URLSearchParams(new FormData(form)).toString(),
        credentials:'same-origin'
      }).then(function(r){return r.json().then(function(j){return {s:r.status,j:j};});})
        .then(function(r){
          if(r.j&&r.j.ok&&r.j.redirect){window.location.href=r.j.redirect;return;}
          msg.textContent=(r.j&&r.j.error)||d['err.net'];
          msg.classList.add('show');
        })
        .catch(function(){msg.textContent=d['err.net'];msg.classList.add('show');})
        .then(function(){btn.disabled=false;btn.innerHTML=old;});
    });
  }
  submitAuth('fLogin','doneLogin');
  submitAuth('fReg','doneReg',function(d){
    var v=rUser.value.trim();
    if(v&&rUser.classList.contains('err')){
      doneReg.textContent=rUserHint.textContent||d['auth.userInvalid'];
      doneReg.classList.add('show');
      return false;
    }
    /* BUG-035: O'qituvchi roli tanlanganda NATIV POST — server to'liq
       /user/register ariza sahifasini prefilled render qiladi (university/
       subject maydonlari u yerda). AJAX bu holatda HTML'ni o'qiy olmaydi. */
    var roleSel=document.querySelector('#fReg input[name="role"]:checked');
    if(roleSel&&roleSel.value==='teacher'){document.getElementById('fReg').submit();return false;}
    return true;
  });

  /* ═══ Tema — yumshoq o'tish (DeborahTheme engine) ═══ */
  var fx=document.getElementById('modeFx');
  document.getElementById('themeBtn').addEventListener('click',function(){
    var next=document.documentElement.getAttribute('data-resolved-theme')==='light'?'dark':'light';
    var oldBg=getComputedStyle(document.body).backgroundColor;
    fx.style.transition='none';
    fx.style.background=oldBg;
    fx.style.opacity='1';
    void fx.offsetWidth;
    applyTheme(next);
    fx.style.transition='opacity .5s ease';
    fx.style.opacity='0';
  });
/* ── Mosaic (mini) ── */
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
      d.style.opacity=0;
      mini.appendChild(d);cells.push(d);
    });
  })();
  /* ── Cast demo: avtomatik aylanish ── */
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
    clearT();
    beam.style.opacity=0;
    q.classList.remove('in');
    optEls.forEach(function(o){o.classList.remove('in');});
    cap.classList.remove('in');
    devnote.style.opacity=0;
    bars.forEach(function(b){b.style.width='0';});
    cells.forEach(function(c){c.style.opacity=0;c.style.transitionDelay='0s';});
  }
  var cycles=0,MAX_CYCLES=2;
  function run(){
    reset();
    cycles++;
    timers.push(setTimeout(function(){beam.style.opacity=1;},120));
    timers.push(setTimeout(function(){beam.style.opacity=0;q.classList.add('in');},T.q));
    optEls.forEach(function(o,ix){
      timers.push(setTimeout(function(){o.classList.add('in');},T.opts+ix*140));
    });
    timers.push(setTimeout(function(){
      cap.classList.add('in');
      bars.forEach(function(b){b.style.width=b.getAttribute('data-w')+'%';});
    },T.bars));
    cells.forEach(function(c,ix){
      timers.push(setTimeout(function(){c.style.transitionDelay=(ix%10)*90+'ms';c.style.opacity=1;},T.mosaic));
    });
    timers.push(setTimeout(function(){devnote.style.opacity=1;},T.note));
    if(cycles<MAX_CYCLES){timers.push(setTimeout(run,T.total));}
  }
  var t=84;
  setInterval(function(){
    t--;if(t<0)t=0;
    var m=('0'+Math.floor(t/60)).slice(-2),s=('0'+(t%60)).slice(-2);
    document.getElementById('scTime').textContent=m+':'+s;
  },1000);
  setTimeout(run,700);
})();
