# NASA-TLX (Light) — Cognitive Load (S39.07)

> Hart & Staveland (1988) — teacher Director va Builder roli bo'yicha,
> har rol vazifasidan keyin alohida to'ldiriladi.
>
> CSV: `results/raw/nasa-tlx.csv`
> Columns: `participant_id,variant,role,dimension,value`
> (role: `director` | `builder`)

| Dimension | Savol | Shkala |
|-----------|-------|--------|
| Mental demand | Vazifa aqliy jihatdan qanchalik talabchan edi? | 0–20 (low–high) |
| Physical demand | Jismoniy jihatdan qanchalik talabchan edi? | 0–20 |
| Temporal demand | Vazifa uchun vaqt bosimi qanchalik edi? | 0–20 |
| Performance | Vazifani bajarishda qanchalik muvaffaqiyatli bo'ldingiz? | 0–20 (poor–good) |
| Effort | Qanchalik harakat talab qildi? | 0–20 |
| Frustration | Qanchalik asabiylashdingiz? | 0–20 |

## Lightweight protokol
- Og'irliklarsiz (unweighted mean) — light version, barcha ishtirokchi uchun bir xil
- **Load index = 5 dims mean (0–20):** Mental + Physical + Temporal + Effort + Frustration
  (Performance — outcome o'lchovi, load'ga kirmaydi)

## Target
- Load index ≤ 11/20 (55/100 ekvivalent) — teacher uchun
