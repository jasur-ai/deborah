# System Usability Scale — SUS (Brooke, 1996) (S39.06)

> Har bir gapga qo'shilish darajangizni belgilang:
> 1 = Strongly disagree, 5 = Strongly agree.
>
> CSV: `results/raw/sus.csv` — Columns: `participant_id,variant,q1..q10`

| # | Item | Odd/Even |
|---|------|----------|
| 1 | Men bu tizimdan tez-tez foydalanishni xohlayman | Odd |
| 2 | Tizim keraksiz murakkab edi | Even |
| 3 | Tizimdan foydalanish oson edi | Odd |
| 4 | Buni ishlatish uchun texnik yordam kerak bo'ladi | Even |
| 5 | Tizimdagi turli funksiyalar yaxshi birlashtirilgan | Odd |
| 6 | Tizimda juda ko'p nomutanosiblik bor edi | Even |
| 7 | Ko'pchilik bu tizimni tez o'rganadi deb o'ylayman | Odd |
| 8 | Tizimdan foydalanish juda og'ir edi | Even |
| 9 | Bu tizimdan foydalanishda o'zimni ishonchli his qildim | Odd |
| 10 | Tizimdan foydalanishdan oldin ko'p narsani o'rganishim kerak edi | Even |

## Scoring
- Odd itemlar: `score = value - 1`
- Even itemlar: `score = 5 - value`
- SUS = Σ(score) × 2.5 → 0–100

## Reference
- Grade: ≥80.3 A, 68–80.3 B, 68 C, <68 past
- Target: SUS ≥ 70 (B/C chegarasidan yuqori)
