# Cast Runbooks — Incident qo'llanmalari (C5-08)

Live Cast sessiyalarida incident bo'lsa, shu runbook bo'yicha harakat qiling.
Har bir runbook: SEV → Alomatlar → Darhol qadamlar → Tekshirish → Eskalatsiya.

## SEV klassifikatsiya (item 11)

| SEV | Ta'rif | Misol | Reaksiya |
|-----|--------|-------|----------|
| **SEV-0** | Javob kaliti / shaxsiy ma'lumot oshkor bo'ldi | answer-key exposure, personal-data incident | Darhol xizmatni pauza qilish, security lead, 1 soat ichida hisobot |
| **SEV-1** | To'liq xizmat uzilishi | all participants disconnect, region outage, CDN outage | Darhol failover/rollback, 2 soat ichida tiklanish |
| **SEV-2** | Qisman degradation | Redis outage, DB failure, ACK spike, retry storm | 4 soat ichida tiklanish, monitoring kuchaytirish |
| **SEV-3** | Minor xato | wrong reveal, moderation outage, deletion failure | Keyingi release'da tuzatish, ticket |

## Feature kill switches (item 12)

`services/cast/feature-switches.js` — incident paytida qismni darhol o'chirish:

```bash
CAST_FEATURE_POE=off node server.js
CAST_FEATURE_FORGEF=off
CAST_FEATURE_REHEARSAL=off
CAST_FEATURE_CHOREOGRAPHY=off
CAST_FEATURE_QUALITYLAB=off
CAST_FEATURE_MODERATION=off
```

O'chirib bo'lmaydiganlar (ground truth): `answer`, `questionFlow`, `session`.

## Runbooklar

| # | Incident | Runbook | SEV |
|---|----------|---------|-----|
| 1 | Host disconnect | [host-disconnect.md](host-disconnect.md) | SEV-2 |
| 2 | All participants disconnect | [all-participants-disconnect.md](all-participants-disconnect.md) | SEV-1 |
| 3 | Redis outage | [redis-outage.md](redis-outage.md) | SEV-2 |
| 4 | DB failure | [db-failure.md](db-failure.md) | SEV-2 |
| 5 | ACK spike | [ack-spike.md](ack-spike.md) | SEV-2 |
| 6 | Wrong reveal | [wrong-reveal.md](wrong-reveal.md) | SEV-3 |
| 7 | Join raid | [join-raid.md](join-raid.md) | SEV-2 |
| 8 | Moderation outage | [moderation-outage.md](moderation-outage.md) | SEV-3 |
| 9 | CDN outage | [cdn-outage.md](cdn-outage.md) | SEV-1 |
| 10 | Region outage | [region-outage.md](region-outage.md) | SEV-1 |
| 11 | Answer-key exposure | [answer-key-exposure.md](answer-key-exposure.md) | SEV-0 |
| 12 | Personal-data incident | [personal-data-incident.md](personal-data-incident.md) | SEV-0 |
| 13 | Rollback | [rollback.md](rollback.md) | SEV-1 |
| 14 | Deletion failure | [deletion-failure.md](deletion-failure.md) | SEV-3 |

## Umumiy diagnostika

```bash
# Health (realtime + backpressure + feature switches)
curl /health

# Cast telemetry snapshot (ACK p50/p95/p99, connections, drops)
curl -H "Authorization: Bearer $ADMIN" /admin/api/cast/telemetry

# Support bundle (director, PII-safe)
curl -X POST /api/cast/sessions/$SID/support-bundle

# Log trace — traceId bo'ylab REST → Socket → store
grep "\"traceId\":\"$TRACE\"" /var/log/deborah.log
```

## Dashboard

`../dashboards/cast.json` — Grafana-style dashboard: connections, ACK percentiles,
event drops, Redis lag, DB queue, projector stale, moderation age.
