# HEMIS GitHub + Tyutor — Resurs tahlili va nima olish mumkin

> **Sana:** 2026-08-03
> **Maqsad:** `tyutor.hemis.uz` platformasi va GitHub'dagi HEMIS bilan bog'liq ochiq repo'lardan Edikit uchun nima olish mumkinligini aniqlash.
> **Prinsip:** Faqat ochiq/xavfsiz resurslar; skrepling, parol, undocumented endpoint — taqiqlangan.

---

## 1. Tyutor platformasi (tyutor.hemis.uz) — nima ekanligi

### 1.1. Texnik holat (jonli test)

| Jihat | Topilma |
|---|---|
| HTTP | **200 — ochiq** (robots.txt `Allow: /`, sitemap.xml mavjud) |
| Framework | SPA (React/Vite) — `assets/index-D0MqHfYs.js` |
| Captcha | **Cloudflare Turnstile** (bot himoya) |
| Analytics | Google Analytics (G-6RM8C7TWXW) |
| Kirish | Login talab qiladi (HEMIS roli biriktirilgan) |
| API testlari | `/api`, `/api/v1`, `/api/site/index`, `/api/public` → 200 (SPA fallback — authsiz ma'lumot yo'q) |

### 1.2. Nima qiladi (rasmiy manbalar)

- **Individual tyutorlik faoliyati** — talabalar uchun tyutorlar tayinlash va ularning ishini boshqarish (hukumat qarori asosida, 2025).
- **Ijtimoiy faollik baholash** — talaba hujjatlar yuklaydi, tyutor ball qo'yadi; OTM rahbariyati nazorat qiladi ("Rahbariyat" roli bilan).
- **Grant taqsimoti integratsiyasi** — davlat grantini qayta taqsimlash: 80% akademik o'zlashtirish + 20% ijtimoiy faollik.
- **AI'dan foydalaniladi** — tyutorlar faoliyatini kuzatish/baholash uchun (rasmiy bayonot).
- **HEMIS bilan integratsiya** — kirish uchun HEMIS "Rahbariyat" roli; CSP `frame-ancestors` da HEMIS bilan bog'langan.

### 1.3. Edikit uchun nima olish mumkin (qonuniy/xavfsiz)

| # | Resurs | Qanday ishlatiladi | Bosqich |
|---|---|---|---|
| 1 | **Ijtimoiy faollik kontsepti (80/20)** | Edikit'ning "Ko'nikma/faollik" blokida (agar OTM Edikit'ni ham ishlatsa): talaba faolligini yig'ish — portfolio'da "ijtimoiy faollik" ko'rinishi | P2/P3 |
| 2 | **Hujjat asosidagi ball tizimi** | Portfolio'da: talaba hujjat yuklaydi → teacher/o'qituvchi ball qo'yadi (tyutor modeli Edikit'ning "teacher ball" flow'iga o'xshash) | P2 |
| 3 | **Baholash mezonlari ro'yxati** (11 yo'nalish: kitobxonlik, to'garaklar, sport, xalqaro, ma'naviy va h.k.) | Portfolio "yutuqlar" kategoriyalari sifatida — talaba o'z faolligini toifalab ko'rsatadi | P2 |
| 4 | **Guruh tyutori roli** | Edikit'da "co-teacher/guruh rahbari" rol patterni (tyutor = guruh rahbari) | P2 |
| 5 | **Ariza yuklash flow** (talaba hujjat yuklaydi → komissiya baholaydi) | Edikit'ning "special consideration/ariza" flow'iga o'xshash (Prompt 48) | P3 |
| 6 | **AI yordamida baholash nazorati** | Edikit'ning AI grading shadow (Prompt 51-52) bilan bir xil yo'nalish — tyutor platformasi AI'ni xuddi shunday ishlatadi (dalil: AI qo'llanilgani) | P2 |

**Olinmaydi:**
- ❌ Tyutor API/ma'lumotlari (login + Turnstile; authsiz data yo'q)
- ❌ Skrepling tyutor sahifalari
- ❌ Talaba/tyutor shaxsiy ma'lumotlari

**Xulosa:** tyutor.hemis.uz dan **kod/API emas, kontsept va flow'lar** olinadi: 80/20 faollik modeli, hujjat→ball flow, guruh tyutori roli, AI baholash nazorati. Bular Edikit'ning portfolio, co-teacher va AI grading'iga ilhom.

---

## 2. GitHub — HEMIS bilan bog'liq ochiq repo'lar

### 2.1. Topilgan repo'lar (GitHub Search API)

| Repo | Til | Nima | Baho |
|---|---|---|---|
| **homidjonov/hemis-oauth** | PHP (League OAuth2) | OAuth2 integratsiya namuna — endpointlar, client yaratish, user fields | ⭐ Foydali (dokumentatsiya sifatida) |
| **dasturchiuz/hemisapi** | PHP (Laravel) | HEMIS REST API kutubxonasi (getDeportmentList va h.k.), `rest/docs` havola | ⚠️ Foydali (endpoint ma'lumot), lekin API key talab |
| **jorayev-o6/Hemis** | — | "My hemis api" | ⚠️ Kichik/havaskor — kod ishonchi past |
| **Habibulla0108/Hemis_monitoring** | — | "Hemis malumotlarni api bilan ishlash" | ⚠️ Kichik — review kerak |
| **qobulovasror/read-hemis-bot** | Node.js | Telegram bot — HEMIS reyting ko'rish | ⚠️ Faqat ma'lumot; bot o'zi kerak emas |
| **abduvohidov/hemis-server** | Node.js/Express | Monolith server | ⚠️ Faqat struktura ilhomi |
| **HoPHNiDev/Hemis** | — | Test javoblarini olish (cheat) | ❌ TAQIQLANADI |

### 2.2. Nima olish mumkin (xavfsiz)

**A. `hemis-oauth` — eng qimmatli (dokumentatsiya):**
- Endpointlar: `student.hemis.uz/oauth/authorize`, `/oauth/access-token`, `/oauth/api/user`
- User fields: `id, uuid, university_id, type, firstname, surname, patronymic, login, picture, email, phone, birth_date`
- Client yaratish: HEMIS paneli → "Tizim/oAuth klientlar" → Client ID + Secret
- Bu — Edikit'ning HEMIS OAuth2 flow'i uchun **asosiy texnik manba** (qonuniy: rasmiy OAuth2).

**B. `hemisapi` — endpoint nomlari (faqat ma'lumot):**
- `getDeportmentList` (bo'limlar), pagination pattern — REST API strukturasini tushunish.
- `HEMISAPI_KEY` + `HEMISAPI_URL` (mas. `https://hemis.hemis.uz`) — API key kerak; `rest/docs` parolli (ochiq emas).
- **Olinmaydi:** API key'siz ishlab bo'lmaydi; repo eski (2024).

**C. Umumiy olinadiganlar:**
1. OAuth2 flow namunasi (PHP → Node.js'ga ko'chirish) — Edikit HEMIS login uchun.
2. User fields ro'yxati — mapping uchun.
3. REST API mavjudligi tasdig'i (key kerak — shartnomasiz emas).
4. Bot/reyting olish g'oyasi — Edikit'da Telegram bot orqali natija ko'rsatish (o'z boti bilan).

### 2.3. Olinmaydi / taqiqlanadi

- ❌ `HoPHNiDev/Hemis` (cheat) — test javoblarini olish noqonuniy
- ❌ GitHub'dagi `clientSecret` (`Vt5dnZtzK...`) — production'da ishlatilmaydi (compromised; faqat o'z test akkaunti bilan sinab ko'rish mumkin — research_auth 7-bo'lim)
- ❌ Havaskor repo'larning kodi bevosita nusxalanmaydi (security review'siz)
- ❌ `rest/docs` parolini buzish

---

## 3. Qilinadigan ishlar (tyutor + GitHub asosida)

### 3.1. HEMIS OAuth2 adapter (OTM client bo'lganda)

**Qanday:**
1. `hemis-oauth` namunasidan endpointlar + fields olib, Node.js adapter yozish:
   - `src/modules/auth/providers/hemis.js` — authorize/access-token/user
   - Zod schema: fields (id, uuid, university_id, type, firstname, surname, login, email, phone)
2. `users.hemis_id` UNIQUE; mapping (hemis_id ↔ user).
3. Client credential KMS; redirect allowlist; geofence (UZ server/proxy).
4. Login UI: "HEMIS bilan kirish" tugmasi — faqat OTM client ishga tushganda.

**Qabul mezonlari:**
- [ ] OAuth2 flow (mock provider test) yashil
- [ ] Fields mapping to'g'ri; IDOR yo'q
- [ ] Credential KMS; redirect allowlist

### 3.2. Portfolio "ijtimoiy faollik" bloki (tyutor kontsepti)

**Qanday:**
1. Portfolio'da kategoriyalar (tyutor mezonlari asosida): Kitobxonlik, To'garaklar (5 muhim tashabbus), Sport, Xalqaro, Ma'naviy-ma'rifiy, Ilmiy.
2. Talaba yutuq yuklaydi (hujjat/rasm) → teacher/o'qituvchi ball qo'yadi (80/20 modeli emas, shunchaki toifali yutuqlar).
3. Co-teacher/guruh rahbari roli — tyutor patterni (Prompt 14 bilan).
4. AI yordamchi: yutuq tavsifidan kategoriya aniqlash (VIP, P2).

**Qabul mezonlari:**
- [ ] Kategoriya + yuklash + ball flow ishlaydi
- [ ] Privacy: default-private; teacher ko'radi, boshqalar yo'q

### 3.3. Telegram bot — natija ko'rsatish (o'z boti)

**Qanday:**
1. Edikit o'z boti (@EdikitBot): talaba "Natijalarim", "Bugungi jadval" ni bot orqali ko'radi (read-hemis-bot g'oyasi — lekin o'z tizimidan).
2. Bog'lanish: settings → Telegram ulash (research_auth 1.3).

**Qabul mezonlari:**
- [ ] Bot ulash + natija so'rash flow ishlaydi
- [ ] PII minimal; faqat o'z ma'lumoti

---

## 4. Manbalar

- Jonli testlar (2026-08-03): tyutor.hemis.uz (200, SPA, Turnstile), hemis.uz (200), univer.hemis.uz (451 geofence), student.hemis.uz (302)
- gazeta.uz (2025-12-23) — tyutor.hemis.uz AI bilan yaratilgani, 80/20 indeks
- sammu.uz, spot.uz, talimxabarlari.uz (2025) — ijtimoiy faollik mezonlari (11 yo'nalish, ball tizimi)
- t.me/hemis_university — tyutor nazorat funksiyasi, grant ariza
- github.com/homidjonov/hemis-oauth — OAuth2 namuna (endpointlar, fields, client)
- github.com/dasturchiuz/hemisapi — REST API kutubxonasi (API key, rest/docs)
- GitHub Search API (2026-08-03) — hemis repo'lari ro'yxati
