# Cast — F4–F6 Certification Runbook (C5-12)

**Maqsad:** Field pilot tier'lari (F4/F5/F6) uchun load certification'ni bajarish,
har tier uchun SLO gate'idan o'tish va signed certification report bilan
keyingi darajaga o'tish. Bu T-06 pilot runbook'ining **load-verification qatlami**.

---

## 1. F-tier ↔ Load-tier mapping

Pilot tier'lari real-sinf bosqichlari; load tier'lari (C5-09) texnik yuk
chegaralari. Certification har ikki darajani bog'laydi:

| Pilot tier | Hajm | Load tier | ACK p95 SLO | Recovery SLO | Test o'lchovi |
|-----------|------|-----------|-------------|--------------|---------------|
| **F4** | 300–500 | **L** (101–500) | ≤ 750ms | ≤ 5s | `--count 400` |
| **F5** | 1 000 | **XL** (501–1 000) | ≤ 750ms | ≤ 5s | `--count 1000` |
| **F6** | 10 000 | **XXL** (1 001–10 000) | ≤ 1000ms | ≤ 8s | `--count 10000` |

> F0–F3 (5–150) uchun C5-09 S/M tier'lari qo'llaniladi — alohida certification
> talab qilinmaydi (T-06 runbook qamrab oladi).

---

## 2. SLO Gate (har tier uchun)

```text
F4/F5: ACK p95 ≤ 750ms,  accepted-answer loss = 0,  recovery ≤ 5s
F6:    ACK p95 ≤ 1000ms, accepted-answer loss = 0,  recovery ≤ 8s
```

**SLO gate shartlari:**
1. Barcha 4 scenario o'tadi: `gradualJoin`, `answerBurst`, `reconnectStorm`, `soak`
2. `acceptedLoss` = 0 — ground-truth solishtiruv (majburiy)
3. ACK p95 belgilangan threshold'dan past
4. `ops/capacity/tier-<T>.json` certified snapshot yozilgan
5. Signed certification report (pastdagi template) imzolangan

**Exit code:** 0 = barcha SLO'lar o'tdi; 1 = birortasi o'tmadi (CI'da fail).

---

## 3. Bajarish tartibi (har tier uchun)

```bash
# 1. Server ishga tushirilgan (NODE_ENV=production yoki prod'ga yaqin)
# 2. Session + join code yaratilgan (approved test + preset)

# F4 (400 concurrent)
node scripts/cast-load-report.js --run all \
  --base-url https://cast.example.com \
  --session <sid> --join-code <code> --count 400

# F5 (1000 concurrent)
node scripts/cast-load-report.js --run all \
  --base-url https://cast.example.com \
  --session <sid> --join-code <code> --count 1000

# F6 (10000 concurrent) — maxsus sertifikatsiya run'i
node scripts/cast-load-report.js --run all \
  --base-url https://cast.example.com \
  --session <sid> --join-code <code> --count 10000
```

**Muhim:** F6 (10K) run'i uchun:
- Production infra (Redis session store + multi-node) **majburiy**
- Local JSON DB `--count 10000` uchun **mo'ljallanmagan** (sync IO) — C5-09'da qayd etilgan
- Soak scenario `--questions N` bilan kamida 30 daqiqa (real SLO ishonchliligi)

---

## 4. Certified snapshot tekshiruvi

Har muvaffaqiyatli run `ops/capacity/tier-<T>.json` yozadi:

```json
{
  "certifiedAt": "…",
  "tier": "L",
  "concurrentParticipants": 400,
  "certified": true
}
```

Certification tekshiruvi uchun:
```bash
node scripts/cast-certification.js --tier F4 --snapshot ops/capacity/tier-L.json
node scripts/cast-certification.js --tier F5 --snapshot ops/capacity/tier-XL.json
node scripts/cast-certification.js --tier F6 --snapshot ops/capacity/tier-XXL.json
```

Script quyidagilarni tekshiradi:
- F-tier → load-tier mapping to'g'ri
- Snapshot `certified: true` va `acceptedLoss == 0`
- Snapshot yoshi 30 kundan oshmagan (yangi sertifikat kerak)
- Exit code 0 = certification valid, 1 = invalid

---

## 5. Signed Certification Report (template)

Har tier certification'idan keyin to'ldiriladi va `ops/capacity/cert-<F>.md`'ga saqlanadi.

```markdown
# Cast Certification — <F4|F5|F6>

- **Tier:** F<X> (<hajm> concurrent)
- **Load tier:** <L|XL|XXL>
- **Date:** <YYYY-MM-DD>
- **Certified by:** <name/role>
- **Server env:** <production|staging> · <single|multi-node> · <DB type>
- **Test:** <test name> · <preset id> · <version>

## SLO natijalari

| Scenario | ACK p95 (ms) | acceptedLoss | Recovery (s) | SLO |
|----------|-------------|--------------|--------------|-----|
| gradualJoin | … | 0 | … | ✅/❌ |
| answerBurst | … | 0 | … | ✅/❌ |
| reconnectStorm | … | 0 | … | ✅/❌ |
| soak | … | 0 | … | ✅/❌ |

## Xulosa

- **Certified:** ✅/❌
- **Qaydlar:** <anomalies, config, infra detallari>
- **Imzo:** <signed>

---
```

---

## 6. Gating (qachon keyingi darajaga o'tiladi)

| Bosqich | Shart |
|---------|-------|
| F3 → F4 | T-06 F3 signed field report + F4 load certification (L) pass |
| F4 → F5 | F4 signed field report + F5 load certification (XL) pass |
| F5 → F6 | F5 signed field report + F6 load certification (XXL) pass |
| F6 GA | F6 certification + signed report + operations sign-off |

> F5/F6 **siz** 1k/10k **claim qilinmaydi** (plan gating sharti).
