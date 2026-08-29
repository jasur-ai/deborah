# Runbook: Wrong reveal (SEV-3)

## Alomatlar
- Javob ochilganda noto'g'ri option ko'rsatildi (config/preset xatosi)
- Participant'lar noto'g'ri key'ni ko'rdi

## Darhol qadamlar
1. Qaysi question'da bo'lganini aniqlang (sessionId + revision)
2. Config fingerprint'ni tekshiring: support bundle → `config.fingerprint`
3. Xato preset/import bo'lsa → session'ni qayta ochmang, next question'ga o'ting
4. Noto'g'ri reveal bo'lgan question uchun `markDeletedQuestions` (replay-service) ishlatilishi mumkin
5. Root cause: test-loader/import bug bo'lsa → fix + unit test

## Tekshirish
- Reveal event revision'da payload to'g'rimi
- Boshqa question'lar ta'sirlanmaganmi

## Eskalatsiya
- Answer key noto'g'ri ko'rinib qolsa (config'da key ochiq bo'lsa) → SEV-0
