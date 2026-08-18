# Runbook: ACK spike (SEV-2)

## Alomatlar
- ACK p99 keskin o'sdi (odatda < 100ms → > 1000ms)
- `backpressure` → degraded1/degraded2
- `eventDrops` (P3) o'smoqda — bu himoya ishlayapti

## Darhol qadamlar
1. Nima spike'ni qo'zg'atdi: participant soni? Redis lag? DB queue?
2. Backpressure avtomatik: P3 (animation/analytics) drop qilinadi — xavfsiz
3. `cast:degradation` event'i director'ga bordi — o'qituvchi "Kechikish yuqori" ko'radi
4. Katta lobby (join raid) bo'lsa → admission queue ishlayapti, kutib turing
5. Zarur bo'lsa `CAST_FEATURE_POE=off` (media payload kamayadi)

## Tekshirish
- ACK p50/p95/p99 normal holatga qaytdimi
- Answer ACK'lar hech qachon drop bo'lmaganini tekshiring (ground truth)

## Eskalatsiya
- 15 daqiqada qaytmasa → SEV-1, capacity review
