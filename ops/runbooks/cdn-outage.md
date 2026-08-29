# Runbook: CDN outage (SEV-1)

## Alomatlar
- Static JS/CSS (cast-director, cast-participant) yuklanmayapti
- POE media (rasm/video) ko'rinmayapti
- UI buzilgan, lekin socket/API ishlayapti

## Darhol qadamlar
1. CDN status'ini tekshiring (provider panel)
2. Static fayllar origin'dan serve qilinsin (CDN bypass — origin health)
3. POE media uchun — `CAST_FEATURE_POE=off` (media yuklash to'xtaydi, flow davom etadi)
4. Client cache busting: `?v=` query qo'shish
5. CDN qaytganda cache purging

## Tekshirish
- `/health` — origin'da JS/CSS 200 qaytarayaptimi
- Director/participant sahifalar yuklanayaptimi

## Eskalatsiya
- 30 daqiqada qaytmasa → SEV-1, CDN provider support
