/**
 * AUTH A-18 — Register: email majburiy + verify.
 *
 * PostgreSQL:
 *   - users.email TEXT UNIQUE NULL (majburiy emas — legacy user'lar email'siz)
 *   - users.email_verified BOOLEAN DEFAULT false
 *   - users_email_index (email → userKey) — local-db fallback'da unique guard
 *
 * Local-DB fallback: `users_email_index/{safeKey(email)} → userKey` (email-verify.js).
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // S30 fix: email/email_verified 049_users_final_schema'da allaqachon qo'shilgan
  // (email TEXT, email_verified BOOLEAN default false). Bu migratsiya no-op —
  // run tarixida saqlanadi (konsistentlik).
  console.log('  052: users email maydonlari 049 da mavjud — no-op');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema
    .alterTable('users')
    .dropColumn('email_verified')
    .dropColumn('email')
    .execute();
}
