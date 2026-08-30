/**
 * Deborah — Migration 050: HEMIS account link (AUTH A-15)
 *
 * REST-first HEMIS linking: talaba o'z HEMIS akkauntini bog'laydi.
 * users.hemis_id — UNIQUE (bitta hemis_id bitta Deborah akkauntiga).
 * hemis_profile — JSON (fullName, university, group, source, linkedAt);
 * HEMIS paroli HECH QACHON saqlanmaydi.
 *
 * Security:
 *   - UNIQUE constraint — IDOR/account takeover'ni oldini oladi (bitta
 *     hemis_id ikki akkauntga bog'lanmaydi).
 *   - local-db fallback'da unique `users_hemis_index/{hemisId} → userKey`
 *     mapping'i routes/hemis.js orqali boshqariladi.
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .alterTable('users')
    // S30 fix: hemis_id 049_users_final_schema'da qo'silgan (varchar(64));
    // bu yerda faqat UNIQUE index kifoya (pastda).
    .addColumn('hemis_linked_at', 'timestamptz')
    .addColumn('hemis_profile', 'jsonb')
    .execute();

  await db.schema
    .createIndex('users_hemis_id_idx')
    .on('users')
    .columns(['hemis_id'])
    .execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropIndex('users_hemis_id_idx').execute();
  await db.schema
    .alterTable('users')
    .dropColumn('hemis_profile')
    .dropColumn('hemis_linked_at')
    .dropColumn('hemis_id')
    .execute();
}
