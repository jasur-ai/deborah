# First-Click Tasks (S39.04)

> 4 task — variant ichida **sahifa yuklanadi**, ishtirokchi vazifani boshlash
> uchun **birinchi bosishini** amalga oshiradi. Moderator: success, time,
> misclick qayd qiladi. Instrumental recording: Playwright `research/tools/`.
>
> CSV: `results/raw/first-click.csv`
> Columns: `participant_id,variant,task,success,time_ms,misclick`

## Tasks
| # | Task | Success mezon |
|---|------|---------------|
| 1 | **Create test** — “Yangi test yarating” | Birinchi bosish test yaratish tugmasi/yo'liga |
| 2 | **Cast existing test** — “Mavjud testni jonli o'tkazing” | Cast/join/session boshlash elementi |
| 3 | **Find result** — “So'nggi test natijalarini toping” | Natijalar/hisobot bo'limi |
| 4 | **Join code** — “Test kodi bilan qo'shiling” | Kod kiritish maydoni/join yo'li |

## Target (S39.04)
- **Primary CTA first-click ≥ 80%** (task 1 uchun)
- Barcha tasklar uchun success ≥ 75%
- Misclick ≤ 10%

## Tahlil
- success %, median time, misclick % — har task bo'yicha
- Variant comparison: task success (Fisher), time (Mann-Whitney U)
