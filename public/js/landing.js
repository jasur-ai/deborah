
(function(){
  'use strict';
  /* ═══ I18N ═══ */
  var I18N={
  uz:{
    'hdr.kirish':'Kirish',
    'hm.kirish':'Kirish','hm.cast':'Cast','hm.documents':'Hujjatlar',
    'join.k':"Tayyor cast",
    'join.h3':"Castga <em>kirish</em>",
    'join.p':'Kodni kiriting.',
    'join.err':'Kod 5–7 xonadan iborat raqam bo\'lishi kerak.',
    'join.go':'Kirish',
    'join.load':'Ulanmoqda… <i></i>',
    'join.ok':"Siz castga ulandingiz. Savol kutilmoqda.",
    'nav.cast':'Cast','nav.kirish':'Kirish',
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
    'err.net':'Tarmoq xatosi — qayta urinib ko\'ring',
    'err.wait':'Bir necha soniya kuting...','auth.oneid':'OneID bilan kirish','auth.or':'yoki email bilan',
    'auth.name':'Ism va familiya','auth.email':'Email','auth.pass':'Parol',
    'auth.doneLogin':'Kirish ruxsat tasdiqlangach ochiladi.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>kirishi</em>','admin.p':'Faqat administratorlar uchun.',
    'admin.loginL':'Login','admin.passL':'Parol','admin.go':'Kirish','admin.err':'Login yoki parol xato.','admin.ok':'Kirish muvaffaqiyatli',
    'ftr.col1t':'Sahifalar','ftr.l1':'Bosh sahifa','ftr.l2':'Cast','ftr.l3':'Kirish','ftr.l4':"Ro'yxatdan o'tish",
'ftr.teachers':"O'qituvchilar",
    'ftr.col2t':'Hujjatlar','ftr.l5':'Maxfiylik siyosati','ftr.l6':'Foydalanish shartlari','ftr.l7':'Xavfsizlik','ftr.l8':'Qonuniy ma\'lumot',
    'ftr.col3t':'Aloqa','ftr.l9':'Status',
    'ftr.col4t':'Til',
    'prov.g.off':'Google kirish serverda sozlanmagan (GOOGLE_CLIENT_ID). Administratorga murojaat qiling — hozir email bilan kiring.',
    'prov.o.off':'OneID (HEMIS) serverda sozlanmagan. Administratorga murojaat qiling — hozir email bilan kiring.',
    'ftr.legal':'© 2026 Deborah · Savolni sinf ekraniga uzatish tizimi'
  },
  ru:{
    'hdr.kirish':'Вход',
    'hm.kirish':'Вход','hm.cast':'Cast','hm.documents':'Документы',
    'join.k':'Готовый cast',
    'join.h3':'Вход в <em>cast</em>',
    'join.p':'Введите код.',
    'join.err':'Код должен состоять из 5–7 цифр.',
    'join.go':'Войти',
    'join.load':'Подключение… <i></i>',
    'join.ok':'Вы вошли в cast. Ожидайте вопрос.',
    'nav.cast':'Cast','nav.kirish':'Вход',
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
    'err.net':'Ошибка сети — попробуйте ещё раз',
    'err.wait':'Подождите несколько секунд...','auth.oneid':'Войти через OneID','auth.or':'или по email',
    'auth.name':'Имя и фамилия','auth.email':'Email','auth.pass':'Пароль',
    'auth.login':'Вход','auth.register':'Отправить запрос администратору',
    'auth.doneLogin':'Вход откроется после подтверждения доступа.',
    'admin.btn':'Admin','admin.k':'Панель админа','admin.h3':'Вход <em>администратора</em>','admin.p':'Только для администраторов.',
    'admin.loginL':'Логин','admin.passL':'Пароль','admin.go':'Войти','admin.err':'Неверный логин или пароль.','admin.ok':'Вход успешен',
    'ftr.col1t':'Страницы','ftr.l1':'Главная','ftr.l2':'Cast','ftr.l3':'Вход','ftr.l4':'Регистрация',
'ftr.teachers':'Преподавателям',
    'ftr.col2t':'Документы','ftr.l5':'Политика конфиденциальности','ftr.l6':'Условия использования','ftr.l7':'Безопасность','ftr.l8':'Правовая информация',
    'ftr.col3t':'Контакты','ftr.l9':'Статус',
    'ftr.col4t':'Язык',
    'prov.g.off':'Вход через Google не настроен на сервере (GOOGLE_CLIENT_ID). Обратитесь к администратору — пока входите по email.',
    'prov.o.off':'OneID (HEMIS) не настроен на сервере. Обратитесь к администратору — пока входите по email.',
    'ftr.legal':'© 2026 Deborah · Система трансляции вопроса на экран'
  },
  en:{
    'hdr.kirish':'Sign in',
    'hm.kirish':'Sign in','hm.cast':'Cast','hm.documents':'Documents',
    'join.k':'Ready cast',
    'join.h3':'Join the <em>cast</em>',
    'join.p':'Enter the code.',
    'join.err':'The code must be a 5–7 digit number.',
    'join.go':'Join',
    'join.load':'Connecting… <i></i>',
    'join.ok':'You joined the cast. Waiting for the question.',
    'nav.cast':'Cast','nav.kirish':'Sign in',
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
    'err.net':'Network error — please retry',
    'err.wait':'Please wait a few seconds...','auth.oneid':'Sign in with OneID','auth.or':'or with email',
    'auth.name':'Full name','auth.email':'Email','auth.pass':'Password',
    'auth.login':'Sign in','auth.register':'Send request to admin',
    'auth.doneLogin':'Sign-in opens after access approval.',
    'admin.btn':'Admin','admin.k':'Admin panel','admin.h3':'Administrator <em>sign-in</em>','admin.p':'Administrators only.',
    'admin.loginL':'Login','admin.passL':'Password','admin.go':'Sign in','admin.err':'Wrong login or password.','admin.ok':'Sign-in successful',
    'ftr.col1t':'Pages','ftr.l1':'Home','ftr.l2':'Cast','ftr.l3':'Sign in','ftr.l4':'Register',
'ftr.teachers':'For instructors',
    'ftr.col2t':'Documents','ftr.l5':'Privacy policy','ftr.l6':'Terms of use','ftr.l7':'Security','ftr.l8':'Legal notice',
    'ftr.col3t':'Contact','ftr.l9':'Status',
    'ftr.col4t':'Language',
    'prov.g.off':'Google sign-in is not configured on the server (GOOGLE_CLIENT_ID). Contact the administrator — use email for now.',
    'prov.o.off':'OneID (HEMIS) is not configured on the server. Contact the administrator — use email for now.',
    'ftr.legal':'© 2026 Deborah · Cast questions to the class screen'
  }};
  var TITLES={uz:'Deborah — savolni sinf ekraniga uzatish',ru:'Deborah — трансляция вопроса на экран',en:'Deborah — cast questions to the class screen'};
  function applyLang(lang){
    var d=I18N[lang]||I18N.uz;
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var k=el.getAttribute('data-i18n');
      if(d[k]!==undefined)el.innerHTML=d[k];
    });
    document.documentElement.setAttribute('lang',lang);
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
  try{
    savedLang=localStorage.getItem('deborah-lang')||'uz';
    // Engine kaliti (deborah-theme-state) birinchi — tanlangan tema saqlansin;
    // eski demo kaliti (deborah-theme) migratsiya; hamma yo'q = demo odati: birinchi tashrif dark.
    savedTheme=localStorage.getItem('deborah-theme-state')||localStorage.getItem('deborah-theme')||'dark';
  }catch(e){}
  applyTheme(savedTheme);
  applyLang(savedLang);
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
    joinCode.value=joinCode.value.replace(/\D/g,'').slice(0,7);
    joinErr.classList.remove('show');
  });
  joinGo.addEventListener('click',function(){
    var v=joinCode.value.trim();
    if(v.length<5||v.length>7){joinErr.classList.add('show');joinCode.focus();return;}
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
  hbtn.addEventListener('click',function(e){e.stopPropagation();hmenu.classList.toggle('open');});
  document.addEventListener('click',function(e){
    if(!hmenu.contains(e.target)&&e.target!==hbtn)hmenu.classList.remove('open');
  });
  hmenu.querySelectorAll('a').forEach(function(a){a.addEventListener('click',function(){hmenu.classList.remove('open');});});

  /* ═══ REAL: Admin login → POST /admin/login ═══ */
  var adminOverlay=document.getElementById('adminOverlay');
  var adminForm=document.getElementById('adminForm');
  var adminErr=document.getElementById('adminErr');
  function openAdmin(){adminOverlay.classList.add('open');adminErr.classList.remove('show');adminForm.reset();setTimeout(function(){var f=document.getElementById('aLogin');if(f)f.focus();},120);}
  function closeAdmin(){adminOverlay.classList.remove('open');}
  document.getElementById('adminBtn').addEventListener('click',function(e){e.stopPropagation();openAdmin();});
  /* Foydalanuvchi talabi: admin 3-chiziq (hamburger) menyu ichida ham */
  document.querySelectorAll('#hmenu a[href="#admin"]').forEach(function(a){
    a.addEventListener('click',function(e){e.preventDefault();openAdmin();});
  });
  document.getElementById('adminClose').addEventListener('click',closeAdmin);
  adminOverlay.addEventListener('click',function(e){if(e.target===adminOverlay)closeAdmin();});
  document.addEventListener('keydown',function(e){if(e.key==='Escape'&&adminOverlay.classList.contains('open'))closeAdmin();});
  adminForm.addEventListener('submit',function(e){
    e.preventDefault();
    var d=I18N[document.documentElement.getAttribute('lang')]||I18N.uz;
    var login=document.getElementById('aLogin').value.trim();
    var pass=document.getElementById('aPass').value;
    if(!login||!pass){adminErr.textContent=d['admin.err'];adminErr.classList.add('show');return;}
    adminErr.style.color='';
    adminErr.textContent=d['admin.ok']||'…';
    adminErr.classList.add('show');
    fetch('/admin/login',{
      method:'POST',
      headers:{'content-type':'application/x-www-form-urlencoded'},
      body:new URLSearchParams({_csrf:window.__CSRF_TOKEN||'',username:login,password:pass}).toString(),
      redirect:'follow',
      credentials:'same-origin'
    }).then(function(r){
      /* MFA oqimi (/admin/mfa/enroll yoki /admin/mfa) = parol TO'G'RI belgisi —
         yakuniy URL admin zonasida va /admin/login emas = muvaffaqiyat. */
      var path='';
      try{path=new URL(r.url).pathname;}catch(_){path=r.url||'';}
      if(r.ok&&path.indexOf('/admin')===0&&path!=='/admin/login'){
        window.location.href=r.url;
      }else{
        adminErr.style.color='';
        adminErr.textContent=d['admin.err'];
        adminErr.classList.add('show');
      }
    }).catch(function(){
      adminErr.textContent=d['admin.err'];
      adminErr.classList.add('show');
    });
  });

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

  /* ═══ REAL: Providerlar (Google / OneID) ═══ */
  var PROV=(window.__AUTH_PROVIDERS||{});
  document.querySelectorAll('.provider').forEach(function(b){
    b.addEventListener('click',function(){
      var d=I18N[document.documentElement.getAttribute('lang')]||I18N.uz;
      var prov=b.getAttribute('data-prov');
      var url=(prov==='google')?'/auth/google':'/auth/hemis';
      var on=(prov==='google')?PROV.google:PROV.oneid;
      if(on){window.location.href=url;return;}
      var msg=b.closest('form').querySelector('.auth-msg');
      if(msg){
        msg.textContent=d[prov==='google'?'prov.g.off':'prov.o.off'];
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
