# Edikit TEACHER WORKSPACE — DEEP RESEARCH (dashboard, test-builder, natija, roster, admin-ish)

> **Holat:** research bosqichi. `views/role/teacher.ejs`, `views/user/create-test.ejs`, `views/user/camera-pilot.ejs` — teacher tarafi (teacher section allaqachon qurilgan — CAST_IMPLEMENTATION_PLAN, research.md). Bu hujjat teacher workspace UI/UX'ini maydalab o'rganadi: glanceable dashboard, authoring flow, grading, analytics, role-based.
> **Asosiy g'oya (style.md 0):** Teacher = sokin, aniq, professional, yuqori information density, neutral surfaces, minimal motion. "Teacher's dashboard displays detailed class performance."

---

## 1. Teacher dashboard — evidence

### 1.1. "Glanceable decision cockpit" (style.md 23) — evidence asos

Teacher dashboard'ning maqsadi (MDPI co-design + zigpoll + cfder):
- O'qituvchi **vaqt bosimi ostida** — "under time pressure" (gitnexa)
- 3 savolga javob berishi kerak: (1) qaysi talaba xavfda? (2) qaysi test yaxshi o'tmadi? (3) keyin nima qilish kerak? (cfder)
- **Konteks bilan:** "completion rate" o'zi emas — trend/benchmark (multipurposethemes)
- **Intervyu evidence (MDPI):** o'qituvchilar "wops! I thought this student was further along" — progress vizualizatsiyasi eng qadrli; fan/class/student bo'yicha filter kerak (Teacher 2: "pick both class and student")

### 1.2. Teacher dashboard struktura

```text
╔═ TEACHER WORKSPACE ═══════════════════════════════
║ Sidebar (professional, sokin):
║   Bosh sahifa · Testlar · Jonli Cast · Talabalar · Roster · Natijalar · Sozlamalar
╠═ OVERVIEW (glanceable) ══════════════════════════
║ KPI kartalar (kam, konteks bilan):
║   • Yaqinlashayotgan testlar (sana)
║   • Oxirgi test natijasi (class average + trend)
║   • Xavf ostidagi talabalar (alert, threshold-based — zigpoll)
║   • Tekshirish kutilayotgan ishlar (agar)
║ Quick actions: [Test yaratish] [Cast boshlash] [Roster import]
╠═ CLASS PERFORMANCE (drill-down) ═════════════════
║ Fan/class/guruh filter; line chart (trend); distribution (histogram)
║ Dominant distractor (style.md 41.5: teacher-private distribution)
║ Before/after revote (Cast'dan keyin)
╠═ STUDENTS ═══════════════════════════════════════
║ Ro'yxat + search + status; student detail (profil, tarix, xavf signal)
╚══════════════════════════════════════════════════
```

### 1.3. Dashboard qoidalari (teacher uchun)

- **High density OK** (style.md: teacher yuqori density) — lekin "KPI → chart → table" tartibi (reddit PowerBI SQLGene: "KPIs -> Charts -> Tables; summarized then detailed")
- **Whitespace ishlatish** — "you aren't paying per pixel"; tooltip/drillthrough'ga offload (SQLGene)
- **Preattentive attributes** — rang/size bilan darhol ko'rinadigan signal (SQLGene)
- **Threshold alerts** — "attendance drops, performance declines" → intervention (zigpoll)
- **Customizable widgets** (P2) — "teachers need filters by date/course/group" (multipurposethemes)
- **Role-based view** — instructor: course engagement; advisor: student risk (cfder)
- **Konsistent color semantics** (gitnexa) — xuddi shu rang bir xil ma'no
- **Intervyu (MDPI):** o'qituvchilar o'zlari ma'lumot qo'shmasa — qadrli ("If teachers don't have to add information, it's more appealing")

---

## 2. Test-builder (authoring) — spec

### 2.1. Authoring flow (research.md 5.2 + assessment lifecycle)

```text
1. [Test yaratish] → 2. Sarlavha/fan/guruh → 3. Savollar qo'shish → 4. Sozlamalar → 5. Saqlash
```

Evidence-based qoidalar:
- **Step-based content flow** — "creates momentum" (instapage: step-based flow momentum)
- **Auto-save** — hech qachon ish yo'qolmaydi (authgear: don't clear input; xuddi shu auto-save)
- **Savol turlari** (research.md 5.3): MC, TF, matching... — UI'da aniq, izchil
- **AI generator** (research.md 8): "50/30/20 difficulty" — UI'da darhol ko'rsatish, tahrirlash mumkin
- **Progress indicator** (multi-step): "Qadam 2/4" — completion oshiradi (staticforms)
- **Preview** — testni qanday ko'rinishini oldindan ko'rish (teacher va student view)
- **Distractor sifati** (research.md 8.4) — AI taklifi, teacher tasdiqlaydi

### 2.2. Form/input qoidalari (teacher authoring — yuqori density)

- Top-aligned labels (fomr.io: single eye fixation — eng tez)
- Single-column asosiy; guruhlash (multi-column faqat mantiqiy juftlar)
- Inline validation (22% xato kamayadi)
- Field soni minimal; progressive profiling
- "Feature gating by action" (digia): AI generator'ni birinchi savoldan keyin taklif qilish

---

## 3. Natija/grading — spec

### 3.1. Gradescope/WebAssign evidence (softwareworld, capterra)

- Gradescope: **intuitive grading**, AI yordam, feedback — "streamline administrative tasks"
- Grading UI: ro'yxat → student → answer → ball → feedback (keyboard bilan tez)
- Ball berish: rubrik (research.md 7.4) — aniq ko'rinadigan rubrik paneli
- **Confidence routing** (research.md 7.5) — AI autograde + teacher spot-check

### 3.2. Grading interface qoidalari

```text
1. Queue: "Tekshirish kutilayotgan" — soni aniq
2. Har submission: savol + student javob + rubrik + ball input + feedback
3. Keyboard: 1-5 ball, arrow navigation — tezlik (teacher density)
4. Auto-save; batch approve
5. Natija e'lon: bir marta bosish bilan class'ga (B-32 notification)
```

### 3.3. Analytics (teacher)

- **Distribution** — "assessments are appropriately calibrated" (cfder: distribution charts)
- **Item analysis** (research.md 8.5) — har savol uchun: to'g'ri % , distractor tanlov
- **Trend** — line chart, class/student
- **Risk flags** — threshold-based (zigpoll) + recommended intervention
- **Export** — CSV (sanitized, formula-injection himoya)

---

## 4. Roster / Talabalar

- Roster import (A-10/11, C-11): Excel — xavfsiz; progress UI; xato ro'yxati; rollback
- Talabalar ro'yxati: search, filter (guruh/fan), status
- Student detail: profil, natija tarixi, xavf signali, portfolio
- Invite (B-11/12): email/invite link — batch (B-36)

---

## 5. Role-based UX (reddit r/userexperience evidence)

- **Bitta akkaunt, ko'p rol** (KoalaTrainer): "single account and multiple roles" — rolga qarab nav qismlari o'zgaradi
- **"If a user sees a button they can't interact with, why are they seeing it?"** (ProfessorApe) — faqat kerakli element ko'rinadi
- **User stories juda kichik** — "User Student views...", bitta harakat (ProfessorApe)
- Teacher + student ikkalasi bo'lishi mumkin — rol switcher (ux design pattern: "switch to admin" button, captainhungrycat)

---

## 6. Teacher panel — qabul mezonlari

1. Dashboard: KPI → charts → table; threshold alerts; trend konteksi
2. Authoring: step flow + auto-save + preview + AI taklif (tahrirlanadigan)
3. Grading: queue + rubrik + keyboard + auto-save + batch
4. Analytics: distribution + item analysis + trend + risk flag + export
5. Roster: import + invite + student detail (xavf signali)
6. Role-based: faqat kerakli element; rol switcher (teacher+student)
7. Density: yuqori, lekin whitespace + drill-down; color semantics barqaror
8. Motion: minimal (panel 220-280ms); reduced-motion
9. Mobile: ko'rish uchun yaxshi (density kamayadi); action'lar desktop'da
10. Style: bitta token oilasi (cobalt/cyan/amber)

---

## 7. Manbalar

style.md (23 — glanceable cockpit) · research.md (assessment lifecycle, AI generator, grading pipeline, roster) · CAST_IMPLEMENTATION_PLAN.md · mdpi.com 13/12/1190 (teacher LAD co-design) · zigpoll.com (school dashboard) · cfder.org (academic dashboard) · multipurposethemes.com (LMS dashboard) · gitnexa.com (education analytics) · datacamp.com (charts) · uxpin.com (dashboard principles) · reddit r/PowerBI (SQLGene dashboard best practices) · reddit r/userexperience (roles) · gradescope (softwareworld/capterra) · instapage.com (step-based flow) · digia.tech (feature gating) · fomr.io (labels) · wesoftyou.com (edtech personas)
