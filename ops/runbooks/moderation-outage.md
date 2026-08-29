# Runbook: Moderation outage (SEV-3)

## Alomatlar
- Moderation wall yangilanmayapti / provider xato
- `moderationAgeMs` gauge o'smoqda
- Confusion/poe moderation signal'lari kechikmoqda

## Darhol qadamlar
1. Moderation service degrade holatda — session o'zi ishlayveradi (ground truth ta'sirlanmaydi)
2. Provider status: `getActiveModerationProvider` — fallback provider'ga o'tganmi
3. Fallback ham ishlamasa — moderation content kechikadi, lekin answer'lar saqlanadi
4. `CAST_FEATURE_MODERATION=off` — moderation wall'ni o'chirib, session'ni davom ettiring

## Tekshirish
- Moderation provider qaytganmi
- `moderationAgeMs` normal holatga qaytdimi

## Eskalatsiya
- Moderation o'chirilgani 1 soatdan oshsa → provider incident + fix
