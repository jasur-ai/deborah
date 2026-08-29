# Runbook: DB failure (SEV-2)

## Alomatlar
- Answer submit `ok: false` qaytarmoqda (ACK error counter o'smoqda)
- `dbQueueDepth` gauge o'smoqda
- `STALE_REVISION` / transaction abort log'larda

## Darhol qadamlar
1. **Xizmatni pauza qilmang** — answer'lar uchun ground truth saqlanadi; retry qilinadi
2. DB holatini tekshiring (write path)
3. Session'lar read-only davom etadi (open/close/reveal state in-memory + event-store)
4. DB qaytganda `duplicates` counter — client retry'lar kutilganmi tekshiring

## Tekshirish
- `commitEvent` xatolari to'xtadimi
- ACK p95 me'yorda

## Eskalatsiya
- 10 daqiqada DB qaytmasa → SEV-1, DB provider on-call
