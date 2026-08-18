#!/usr/bin/env node
/**
 * Edikit — Cast Retention CLI Worker (C4-07)
 * -------------------------------------------
 * Retention job'ni ishga tushiradi.
 *
 * Usage:
 *   node scripts/cast-retention.js              — bir marta run (default policy)
 *   node scripts/cast-retention.js --policyId=institution_default_v1
 *   node scripts/cast-retention.js --retentionClass=extended
 *   node scripts/cast-retention.js --hourly     — hourly mode (cron uchun)
 *
 * Scheduled (production):
 *   daily:  0 2 * * *  node scripts/cast-retention.js
 *   hourly: 0 * * * *  node scripts/cast-retention.js --hourly
 *
 * Tugallanish sharti: retention faqat documentation emas — scheduled
 * tested job sifatida ishlaydi.
 */

import { fb } from '../firebase/admin.js';
import { runRetentionJob } from '../services/cast/retention-job.js';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : def;
};

async function main() {
  const policyId = opt('policyId', 'institution_default_v1');
  const retentionClass = opt('retentionClass', 'standard');
  const hourly = args.includes('--hourly');

  console.log('═══ Cast Retention Worker ═══');
  console.log(`  Policy: ${policyId} | class: ${retentionClass} | mode: ${hourly ? 'hourly' : 'daily'}`);

  const result = await runRetentionJob(
    { dbGet: fb.get, dbSet: fb.set, dbRemove: fb.remove },
    { policyId, retentionClass }
  );

  console.log('┌─ Natija ─────────────────────────────');
  console.log(`│ jobId:       ${result.jobId}`);
  console.log(`│ processed:   ${result.processed}`);
  console.log(`│ deleted:     ${result.deleted}`);
  console.log(`│ anonymized:  ${result.anonymized}`);
  console.log(`│ revokedTokens: ${result.revokedTokens}`);
  console.log(`│ failed:      ${result.failed}`);
  if (result.failedIds.length > 0) {
    console.log(`│ failedIds:   ${result.failedIds.join(', ')}`);
  }
  console.log('└───────────────────────────────────────');

  if (result.failed > 0) {
    console.error(`Retention job ${result.jobId} — ${result.failed} sessiya muvaffaqiyatsiz`);
    process.exit(1);
  }
  console.log(`Retention job ${result.jobId} — OK`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Retention worker xatosi:', err.message);
  process.exit(1);
});
