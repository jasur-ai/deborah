# Cast Capacity Certification (C5-09)

Tier'lardagi concurrent participant chegaralari va SLO natijalari.

## Tier chegaralari

| Tier | Concurrent | ACK p95 SLO | Recovery SLO |
|------|-----------|-------------|--------------|
| S    | 1–30      | ≤ 500ms     | ≤ 3s         |
| M    | 31–100    | ≤ 500ms     | ≤ 3s         |
| L    | 101–500   | ≤ 750ms     | ≤ 5s         |
| XL   | 501–1 000 | ≤ 750ms     | ≤ 5s         |
| XXL  | 1 001–10 000 | ≤ 1000ms | ≤ 8s         |

## Certified config

Har muvaffaqiyatli test run'i `tier-<TIER>.json` snapshot'ini yaratadi
(`scripts/cast-load-report.js` orqali). Har tier uchun `tier-*.md` faylida
batafsil natija va config saqlanadi.

## Release threshold (C5-09 "Proposed release threshold")

```
S/M ACK p95    ≤ 500ms
L/XL ACK p95   ≤ 750ms
XXL ACK p95    ≤ 1000ms
S/M recovery   ≤ 3s
L/XL recovery  ≤ 5s
XXL recovery   ≤ 8s
Accepted loss  = 0
```

## Runbook

```bash
# 1) Server'ni test rejimida ishga tushiring
NODE_ENV=test SESSION_SECRET=ci-secret-for-testing-0123 PORT=3457 node server.js

# 2) Session yarating (API orqali — qarang: load/README)
# 3) Load run
node scripts/cast-load-report.js --run all --base-url http://localhost:3457 \
  --session <sid> --join-code <code> --count 30
```

## Item holati

| Item | Scenario | Holat |
|------|----------|-------|
| 3  | Gradual join | `gradualJoin` |
| 5  | Final 2s answer burst | `answerBurst` |
| 8  | 10% reconnect storm | `reconnectStorm` |
| 14 | Soak (45–90 min) | `soak` (CI default kichik) |
| 16 | p50/p95/p99, error, loss report | `cast-load-report.js` |
| 17 | Accepted count vs ground truth | `summarizeMetrics.acceptedLoss` |
| 19 | Certified max config per tier | `tier-<TIER>.json` |
