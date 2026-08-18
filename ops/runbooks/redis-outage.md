# Runbook: Redis outage (SEV-2)

## Alomatlar
- `/health` → `realtime.redisOk: false`, `realtimeAdapter` degraded
- `redisLagMs` gauge o'smoqda
- XXL tier session yaratish 503 qaytarmoqda (admission blok — to'g'ri ishlayapti)

## Darhol qadamlar
1. Redis qayta ishga tushsin (restart / failover)
2. Redis qaytganida adapter avtomatik ulanadi (dynamic import, reconnect)
3. Session store MemoryStore'ga tushgan bo'lsa — yangi session'lar bitta node'da ishlayveradi (degraded, xavfsiz)
4. Support bundle orqali `redisLagMs` history'sini tekshiring

## Tekshirish
- `curl /health` → realtime holati tiklanganmi
- Cast session hali ishlayaptimi (director sahifa)

## Eskalatsiya
- 30 daqiqada Redis qaytmasa → SEV-1, Redis provider support
