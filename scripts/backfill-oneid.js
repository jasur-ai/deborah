#!/usr/bin/env node
/**
 * Deborah — E-01b: OneID backfill migration tooling
 * ---------------------------------------------------------------------------
 * `oneid_sub` bo'lmagan barcha user'larga canonical OneID beradi.
 * Idempotent: mavjud OneID'li user'lar SKIP qilinadi — takroriy yugurish xavfsiz.
 *
 * ISHLATISH:
 *   node scripts/backfill-oneid.js          # qo'llaydi (real FB yozadi)
 *   node scripts/backfill-oneid.js --dry    # faqat hisobot — hech narsa yozmaydi
 *
 * Dry-run'da ham audit qilinmaydi (faqat hisob): { processed, wouldCreate, wouldSkip }.
 */
import { backfillOneIds } from '../src/modules/auth/identity.js';
import { fb } from '../firebase/admin.js';

const DRY = process.argv.includes('--dry');

async function main() {
  console.log(`[E-01b] OneID backfill ${DRY ? '(DRY-RUN — yozilmaydi)' : ''}`);

  const get = DRY ? (p) => fb.get(p) : (p) => fb.get(p);
  const set = DRY ? async () => {} : (p, v) => fb.set(p, v);

  const r = await backfillOneIds({ fbGet: get, fbSet: set });

  if (!r.ok) {
    console.error(`[E-01b] XATO: ${r.error}`);
    process.exit(1);
  }

  console.log(`[E-01b] Tugadi: processed=${r.processed}, ${DRY ? 'wouldCreate' : 'created'}=${r.created}, ${DRY ? 'wouldSkip' : 'skipped'}=${r.skipped}`);
  process.exit(0);
}

main().catch((e) => {
  console.error('[E-01b] Fatal:', e.message);
  process.exit(1);
});
