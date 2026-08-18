/**
 * Edikit — Migration 051: Telegram link (AUTH A-16, P3)
 *
 * users.telegram_id — UNIQUE (bitta Telegram akkaunt bitta Edikit
 * akkauntiga). Telegram OTP auth / 2-step uchun mapping.
 *
 * Security:
 *   - UNIQUE — Telegram hijack/IDOR'ni oldini oladi (bitta telegram_id ikki
 *     akkauntga bog'lanmaydi).
 *   - Step-up qoidasi (A-16 §11): telegram_id o'zi identity EMAS — high-stakes
 *     resurslar (summative/admin) uchun phone/JSHSHIR qo'shimcha tekshiruv
 *     talab qilinadi (bu migration faqat mapping saqlaydi).
 *   - local-db fallback'da unique `users_telegram_index/{telegramId} →
 *     userKey` mapping'i routes/telegram-auth.js orqali boshqariladi.
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .alterTable('users')
    .addColumn('telegram_id', 'text', (col) => col.unique())
    .addColumn('telegram_linked_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('users_telegram_id_idx')
    .on('users')
    .columns(['telegram_id'])
    .execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropIndex('users_telegram_id_idx').execute();
  await db.schema
    .alterTable('users')
    .dropColumn('telegram_linked_at')
    .dropColumn('telegram_id')
    .execute();
}
