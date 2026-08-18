# Environment Study (S39.10)

> Bright classroom, dim room, projector, mobile outdoors sharoitlarida theme
> readability va preference tekshiriladi. Simulyatsiya: monitor yorqinligi +
> atrof-muhit yorug'ligi + viewport.
>
> CSV: `results/raw/environment.csv`
> Columns: `participant_id,variant,environment,theme,readable,preferred`
> (environment: `bright`|`dim`|`projector`|`mobile_outdoor`, theme: `light`|`dark`|`high_contrast`)

## Environments
| Environment | Simulyatsiya |
|-------------|-------------|
| bright | Yorqin xona (800 lux), light theme odatiy |
| dim | Qorong'i xona (50 lux) |
| projector | 1024×768, 3m masofa, dark theme |
| mobile_outdoor | 320px viewport, quyosh nurlari (1500 lux) |

## O'lchovlar (har environment×theme uchun)
- Readable (1–7): matn qanchalik o'qiladigan
- Preferred (binary): qaysi theme afzal

## Target (S39.10)
- Har environmentda afzal theme ≥ 70% ishtirokchi tomonidan tanlangan
- Readable ≥ 5.0/7 afzal theme uchun

## Tahlil
- Preference: frequency → % per environment
- Readable: mean per environment×theme
- Xulosa: theme default'larining environment bo'yicha mosligi
