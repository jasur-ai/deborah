# Geofence Reja — Davlat tizimlariga ulanish (AUTH A-17)

> **Status:** ✅ DONE (hujjatlashtirilgan — A-17 CHECKPOINT)
> **Manba:** `research_auth.md` §9–10 (Geofence, Audit), jonli testlar (A-13/A-14/A-15).

## 1. Maqsad

HEMIS va davlat ochiq ma'lumotlar tizimlari **faqat O'zbekiston hududidan** (UZ IP) ishlaydi.
Xorijiy IP'dan to'g'ridan-to'g'ri so'rov geoblokka uchraydi (451 / ulanish yo'q). Tizim
bunday holatda foydalanuvchiga aniq xabar ko'rsatishi va keraksiz takroriy so'rovlarni
yubormasligi shart.

## 2. Endpoint geofence jadvali (jonli tekshirilgan)

| Endpoint | Kutilgan | Amalda (A-13/14 test) | Izoh |
|---|---|---|---|
| `student.hemis.uz` | UZ IP → 200 | 302 (login sahifasiga) | REST + OAuth uchun asosiy base |
| `univer.hemis.uz` | UZ IP → 200 | **451** (geoblok) | OTM xodim paneli — server-to-server talab |
| `diplom.edu.uz` | UZ IP → 200 | **451** | Diplomalarni tekshirish — server-to-server |
| `data.gov.uz` | UZ IP → 200 | xorijiy → 000 (ulanish yo'q) | Ochiq ma'lumotlar — UZ proxy talab |
| `hemis.uz` | UZ IP → 200 | 200 (statik sahifa) | Umumiy portal — brauzer orqali OK |
| `tyutor.hemis.uz` | UZ IP → 200 | 200 | Tyutor paneli — brauzer orqali OK |

## 3. Yechim strategiyasi

### Yo'l A — Foydalanuvchi brauzeri orqali (muammo yo'q)
`hemis.uz`, `tyutor.hemis.uz`, `student.hemis.uz` login sahifasi — foydalanuvchi
brauzeri orqali (OAuth redirect). Geofence foydalanuvchi IP'siga bog'liq — agar
foydalanuvchi O'zbekistonda bo'lsa ishlaydi. **Bizning server geofence'dan o'tmaydi.**

### Yo'l B — Server-to-server (UZ server/proxy talab)
`univer.hemis.uz`, `diplom.edu.uz`, `data.gov.uz` REST API — **faqat UZ hududidagi
server/proxy orqali**. Yechimlar:
1. **UZ'da joylashgan VPS/proxy** (masalan, UZ domain + UZ IP) — REST proxy.
2. Server-to-server so'rovlar uchun `HEMIS_BASE_URL` o'rniga UZ proxy URL.
3. Geofence xatosi (451/000) bo'lsa → **sokin retry taqiqlanadi**, foydalanuvchiga
   "faqat O'zbekistondan" xabari, `geofence` kodi.

### Test muhiti
UZ proxy faqat **test**'da (mock); production'da haqiqiy UZ proxy/infra talab qilinadi.

## 4. Kodda amalga oshirish

| Modul | Geofence mexanizmi |
|---|---|
| `src/modules/auth/providers/hemis.js` | `restLogin` — geofence xatosi → `err.code='geofence'` → route 451 |
| `routes/hemis.js` | `err.code === 'geofence' ? 451` — client "faqat O'zbekistondan" |
| `src/modules/opendata/universities.js` | `LIVE_SOURCES` geofence → bundled CSV'ga fallback |
| `routes/opendata.js` | xorijiy/451 → cache'dan javob, retry cooldown |

## 5. Security guard

- Xorijiy IP → tashqi so'rov **yuborilmaydi** (SSRF guard bilan birga).
- `geofence` xatosi audit'da `outcome: fail, reason: geofence`.
- Takroriy so'rovlar: cooldown (A-13 fix) — 32s timeout'li so'rovlar spam qilmaydi.
- Parol hech qachon log'ga chiqmaydi; faqat `login` (username) audit'da.
