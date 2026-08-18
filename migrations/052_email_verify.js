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
  await db.schema
    .alterTable('users')
    .addColumn('email', 'text', (col) => col.unique())
    .addColumn('email_verified', 'boolean', (col) => col.notNull().defaultTo(false))
    .execute();
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
