# Semantic Differential (S39.05)

> Variantni 5 soniya ko'rganingizdan so'ng — quyidagi qarama-qarshi sifatlar
> orasida o'z hissingizni belgilang (1–7). 1 = chapdagi, 7 = o'ngdagi sifat.
>
> CSV: `results/raw/semantic-differential.csv`
> Columns: `participant_id,variant,pair,value` (pair: `childish_mature` va h.k.)

| # | Pair (1 ← 7) | Label |
|---|--------------|-------|
| 1 | childish — mature | `childish_mature` |
| 2 | unofficial — official | `unofficial_official` |
| 3 | generic — distinctive | `generic_distinctive` |
| 4 | chaotic — clear | `chaotic_clear` |
| 5 | cold — warm | `cold_warm` |
| 6 | weak — competent | `weak_competent` |
| 7 | untrustworthy — trustworthy | `untrustworthy_trustworthy` |

## Targets
- mature ≥5.8, official ≥5.8, distinctive ≥5.2, clear ≥6.0, competent ≥6.0, trustworthy ≥5.8

## Tahlil
- Har pair: mean + 95% CI (n≥12)
- Variant A vs C/D: Welch t-test (α=0.05), effect size (Cohen's d)
