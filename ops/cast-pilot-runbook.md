# Cast — Real-Class Field Pilot Runbook (T-06)

**Maqsad:** Real sinfda Cast'ni bosqichma-bosqich (F0→F6) sinash, metrikalar yig'ish,
severity triage qilish va faqat signed field report bilan keyingi tierga o'tish.

---

## 1. Bosqichlar (Tiered Rollout)

```text
F0 internal 5–10      — ichki jamoa, o'quv sinfi simulyatsiyasi
F1 volunteer 10–15    — ko'ngillilar (teacher + students)
F2 real class 20–35   — haqiqiy sinf darsi
F3 lecture 80–150     — katta auditoriya ma'ruzasi
F4 institution 300–500— institut/maktab bo'ylab
F5 scheduled 1 000    — rejalashtirilgan ommaviy sessiya
F6 certified 10 000   — sertifikatlangan ommaviy sessiya
```

**Har bir bosqichda:** approved test + preset ishlatiladi (konfiguratsiya oldindan
tekshirilgan — `assertJoinCodeFormat`, `resolvePreset` validatsiyadan o'tgan).

**Tugallanish sharti:**
- F3 (80–150) **siz** classroom GA **yo'q**.
- F5/F6 **siz** 1k/10k **claim yo'q**.

---

## 2. Pilot Metrikalari (har sessiya)

`scripts/cast-pilot-metrics.js` yordamida yig'iladi (admin `/api/cast/telemetry` dan).

| Metrika | Formula | Maqsad (tier bo'yicha) |
|---------|---------|------------------------|
| Setup time | session create → first question open (s) | F0<60s, F2<120s, F3<180s |
| Join completion | joined / eligible ×100% | ≥95% |
| ACK success | accepted acks / sent ×100% | ≥98% |
| Coverage | answered / joined ×100% | ≥90% |
| Recovery | recoverySuccess / recovery ×100% | ≥95% |
| Unplanned stop | session end without director end | 0 |
| ACK p95 | answer ack p95 (ms) | <800ms F0-F2, <1500ms F3+ |
| Teacher load | 1-5 o'lchov (feedback form) | ≤3 |

**O'lchash vositalari:**
- `GET /api/cast/telemetry` (admin) — `counters.joins`, `counters.acks`, `counters.ackErrors`,
  `counters.recovery`, `counters.recoverySuccess`, `ack.answer.p95`
- `scripts/cast-synthetic-monitor.js` — critical flow (join→answer→ACK→reveal) davriy tekshiruvi
- Signed field report (pastda) — har pilotdan keyin

---

## 3. Bosqich Check-list (rejaga mos T-06)

| # | Item | Qayerda tekshiriladi |
|---|------|---------------------|
| 1 | Har bosqich uchun approved test+preset | `resolvePreset` + preflight (test yozilgan: cast-config/presets) |
| 2 | 3m/8m/15m projector viewing | Real projector — manual (font-size kontrast CSS mavjud) |
| 3 | Bright/dim room | Manual — kontrast CSS + high-contrast toggle |
| 4 | 720p/1080p, 4:3/16:9 | Manual — responsive CSS (320px testi T-05'da bor) |
| 5 | Weak Wi-Fi corner | `resilience.networkTelemetry`, reconnect + replay (T-02/T-03 recovery test) |
| 6 | Low-end Android + iPhone Safari | Manual real device — `cast-a11y-suite` keyboard/320px asos |
| 7 | Teacher one-hand remote | Manual — director keyboard shortcuts (KEYBOARD_HINTS) |
| 8 | Screen-reader participant | NVDA/VoiceOver manual runbook (T-05'da hujjat) |
| 9 | Audio-off + reduced-motion | CSS `prefers-reduced-motion` + toggle (T-05 test) |
| 10 | Setup/join/ACK/coverage/recovery o'lchash | `scripts/cast-pilot-metrics.js` (pastda) |
| 11 | Teacher cognitive load | Feedback form (signed report §5) |
| 12 | Student pressure/fairness | Feedback form (signed report §6) |
| 13 | Severity triage | §4 Stop criteria bo'yicha |
| 14 | Stop criterion → session stop | Ops darhol session to'xtatadi |
| 15 | Signed field report → keyingi tier | Faqat report imzolangandan keyin |

---

## 4. Stop Criteria (SEV-0 — session darhol to'xtatiladi)

```text
answer-key exposure           — javob kaliti participant/ekranga chiqsa
accepted-answer loss          — qabul qilingan javob yo'qolsa
wrong correct-answer reveal   — noto'g'ri javob ko'rsatilsa
unmoderated harmful projector content — moderator'siz zararli kontent ekranda
host ownership failure        — host nazorati yo'qolsa
critical accessibility failure — kritik a11y buzilishi
privacy/consent scope breach  — rozilik doirasidan chiqish
```

Har bir stop — SEV-0 hisoblanadi: service pause, security lead chaqiriladi,
`scripts/security-ci.js` + support bundle (PII-safe) olinadi.

---

## 5. Signed Field Report shabloni

```markdown
# Field Report — Tier: F[N] | Sessiya: [id] | Sana: [date]

## Pilotchi (signed)
- O'tkazuvchi: [name/role]
- Imzo: [date + signature]

## Sessiya profili
- Bosqich: F0/F1/F2/F3/F4/F5/F6
- O'quvchilar: [N] | Qurilmalar: [list] | Tarmoq: [Wi-Fi/hotspot]
- Preset: [preset id] | Test: [test id] | Projector: [3m/8m/15m]

## Metrikalar
| Metrika | Qiymat | Maqsad | Holat |
|---------|--------|--------|-------|
| Setup time | ...s | <[tier target]s | ✅/❌ |
| Join completion | ...% | ≥95% | ✅/❌ |
| ACK success | ...% | ≥98% | ✅/❌ |
| Coverage | ...% | ≥90% | ✅/❌ |
| Recovery | ...% | ≥95% | ✅/❌ |
| Unplanned stop | ... | 0 | ✅/❌ |

## Severity triage
- [SEV-0/1/2/3] [tavsif] → [chora]
- ...

## Teacher cognitive load (1-5): [score] + [izoh]
## Student fairness/pressure (1-5): [score] + [izoh]

## Qaror
- [ ] Keyingi tierga o'tish (F[N+1]) — barcha metrikalar ✅ va SEV-0 yo'q
- [ ] Qayta sinash — [sabab]
- [ ] To'xtatish — [sabab]
```

---

## 6. Foydalanish

```bash
# 1) Pilot metrikalarini yig'ish (admin login kerak)
node scripts/cast-pilot-metrics.js --base http://localhost:PORT

# 2) Critical flow davriy tekshiruvi (ops alert)
node scripts/cast-synthetic-monitor.js --interval 60

# 3) Telemetry health (qo'lda)
curl -H "Cookie: <admin-session>" http://localhost:PORT/api/cast/telemetry
```

**Qoida:** Har pilotdan keyin severity triage qilinadi. SEV-0 bo'lsa session to'xtaydi.
Keyingi tierga faqat signed field report bilan o'tiladi.
