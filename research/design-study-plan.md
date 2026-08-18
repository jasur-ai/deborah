# Deborah Design Study Plan (STYLE STEP 39)

> **Maqsad:** “Official, mature, distinctive” dizayn qarori real teacher/participant
> behavior va validated scales bilan tekshiriladi. Stakeholder ta'mi emas — evidence.
>
> **Status:** 📋 Reja — field execution oldidan. Instrumentlar `instruments/` da,
> tahlil `scripts/research-analyze.js`, natijalar `results/*.csv` → `report.md`.
>
> **Qoida (S39.12):** Hech qachon “users liked it” degan universal claim
> yozilmaydi. Har bir xulosa: task metric + confidence + qualitative themes bilan.

---

## 1. Tadqiqot savollari

| # | Savol | Instrument | Target |
|---|-------|-----------|--------|
| Q1 | Yangi dizayn “mature/official” deb qabul qilinadimi? | Semantic differential | Mature ≥5.8/7, Official ≥5.8/7 |
| Q2 | “Distinctive” — boshqa SaaS/quiz produkttidan ajraladimi? | 5-sec recall + VisAWI-S | Distinctive ≥5.2/7, recall ≥80% |
| Q3 | Task'lar tez va xatosiz bajariladimi? | First-click tasks | Primary CTA ≥80% |
| Q4 | Cognitive load teacher uchun maqbulmi? | NASA-TLX (light) | Mental demand ≤55/100 |
| Q5 | Brand elementlari (Evidence Mark, Signal Rail) eslab qolinadimi? | Fame/uniqueness | Name recall ≥60% |
| Q6 | Motion muhimmi — task success'ga ta'sir qiladimi? | Motion A/B | Success gap ≤10pp |
| Q7 | Turli muhitlarda o'qiladimi? | Environment study | Preference ≥70% |
| Q8 | Gamification anxiety/motivation balansimi? | Gamification study | Fairness ≥5.0/7 |

---

## 2. Segmentlar (S39.01)

Faqat designer/developer sample ishlatilmaydi. Har segmentdan **alohida** recruit:

| Segment | n (min) | Recruit kanali | Screener |
|---------|---------|----------------|----------|
| Teacher (Direktor + Builder rolida) | 12 | Maktab/universitet hamkorlar, o'qituvchi jamoalar | Haftada ≥3 marta sinov o'tkazadigan |
| Participant/Student | 12 | O'quvchilar, talabalar | Oxirgi 6 oyda test ishtirokchisi |
| Institution/Admin | 6 | Maktab administratorlari, metodistlar | Sinov jarayonlarini boshqaradigan |
| **Jami** | **30** | — | — |

Eslatma: qulaylik namunasi (convenience sample) bo'lsa — confidence pastroq
yoziladi va “universal claim” qilinmaydi.

## 3. Study design (S39.02)

**Blind between-subjects comparison** — 4 variant, random assign, participant
qaysi variantni ko'rganini bilmaydi:

| Variant | Tavsif |
|---------|--------|
| A. Current Deborah | Joriy production (STEP 1–38 natijasi) |
| B. New Deborah | Yangi visual identity (evidence mark, signal rail, cobalt palette) |
| C. Generic blue SaaS | Generic enterprise SaaS estetikasi (control) |
| D. Playful quiz | Bright gamified quiz estetikasi (control) |

Har variant uchun: **bir xil vazifalar, bir xil funksiyalar** — faqat styling
farqlanadi. Variant C/D mockup'lar `research/mocks/` da.

## 4. Procedure (har ishtirokchi ≈ 45–50 min)

| Bosqich | Vaqt | O'lchanadi |
|---------|------|-----------|
| 1. Rozilik + demografik | 3 min | consent.md |
| 2. 5-second test | 5 min | Recall (S39.03) |
| 3. First-click tasks ×4 | 10 min | Success/time/misclick (S39.04) |
| 4. Semantic differential | 5 min | 7 bipolar pair (S39.05) |
| 5. VisAWI-S + SUS + UEQ-short | 10 min | Aesthetics + usability (S39.06) |
| 6. NASA-TLX (light) — Director & Builder | 7 min | Cognitive load (S39.07) |
| 7. Fame/uniqueness test | 5 min | Brand recall (S39.08) |
| 8. Motion A/B | 5 min | Task success/perceived speed (S39.09) |
| 9. Environment preference | 5 min | Readability (S39.10) |
| 10. Gamification study | 5 min | Anxiety/fairness/motivation (S39.11) |

**Order counterbalancing:** task va instrument tartibi ishtirokchi bo'yicha
aylantiriladi (Latin square) — tartib effekti oldini olish.

## 5. Instruments (S39.05–S39.11)

Barcha shablonlar: `research/instruments/`

| Instrument | Manba | Itemlar | Tarjima |
|-----------|-------|---------|---------|
| Semantic differential | Mavrink (custom, bipolar) | 7 pair | uz/ru/en |
| VisAWI-S | Moshagen & Thielsch (2010) short | 9 | Back-translate |
| SUS | Brooke (1996) | 10 | Back-translate |
| UEQ short | Schrepp et al. | 8 | Back-translate |
| NASA-TLX (light) | Hart & Staveland (1988) | 6 dim | Back-translate |

> Tarjima protokoli: 2 mustaqil tarjimon + back-translate + pilot (n=3).
> Tarjima qilinmagan instrumentlar faqat asl tilida (en) qo'llaniladi va shunday
> qayd qilinadi.

## 6. Tahlil (S39.12)

`scripts/research-analyze.js` — `research/results/*.csv` ni o'qib:

1. **Task metrics**: success rate, time-to-task, misclick rate (har task bo'yicha)
2. **Semantic differential**: 7-pair mean + CI (95%)
3. **VisAWI-S**: 4 subscale (simplicity, diversity, colorfulness, craftsmanship)
4. **SUS**: 0–100 score (standard scoring)
5. **UEQ-short**: pragmatic + hedonic + overall
6. **NASA-TLX**: 6 dim + weighted overall
7. **Fame test**: recall %, uniqueness rating
8. **Motion A/B**: success gap, perceived speed, discomfort
9. **Gamification**: anxiety/fairness/motivation by segment
10. **Targets compare**: yuqoridagi targetlar bilan solishtirish → PASS/FAIL per target

**Xulosa qoidalari:**
- Har bir xulosa: `n`, effect size, CI bilan
- n < 12 bo'lsa — “exploratory” deb belgilanadi, confirmatory claim qilinmaydi
- Segment farqlari (teacher vs student) alohida hisobot qilinadi

## 7. Environment study (S39.10)

| Muhit | Simulyatsiya | O'lchov |
|-------|--------------|---------|
| Bright classroom | 800 lux, yorug' fon | Readability, preference |
| Dim room | 50 lux, projector | Readability, preference |
| Projector | 1024×768, 3m masofa | Readability |
| Mobile outdoors | 320px, sunlight (1500 lux) | Readability |

Har muhitda: theme (light/dark/high-contrast) preference + text o'qish vazifasi.

## 8. Gamification study (S39.11)

Leaderboard variantlari: **off / personal / team** — random order.
Har variantdan keyin:
- Anxiety (0–10)
- Fairness (1–7)
- Motivation (1–7)
- Qualitative: “Nima sababdan?”

Segment bo'yicha (teacher vs student) alohida.

## 9. Deliverables

| Fayl | Tavsif |
|------|--------|
| `research/results/raw/*.csv` | Xom ma'lumot (anonim) |
| `research/results/aggregate.json` | Script chiqishi |
| `research/report.md` | Yakuniy hisobot (template) |
| `research/mocks/` | C/D control variantlari |

## 10. Approval gate

Report'da **har bir target** bo'yicha: PASS / FAIL / N/A(evidence yetarli emas).
≥1 critical target FAIL bo'lsa — dizayn qayta ko'rib chiqiladi (STEP 40 rollout
oldidan).
