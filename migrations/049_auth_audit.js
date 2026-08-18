/**
 * Edikit — Migration 049: auth_audit (AUTH A-03)
 *
 * Auth hodisalarining PII-minimal jurnali:
 *   - ts, actor_id, action, outcome, method, ip_hash, ua, detail JSONB
 *   - PII minimal: to'liq IP emas — ip_hash (sha256); parol/token/OTP hech
 *     qachon detail'da saqlanmaydi (logAuthEvent redactDetails).
 *   - Retention: 30 kun — scheduled purge (`purgeAuthAudit` + DB cron job
 *     DELETE FROM auth_audit WHERE ts < now() - interval '30 days').
 *   - Indekslar: (ts, action), (actor_id) — guide §30.
 *
 * Precondition: A-02 cookie/limit yashil.
 */
import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('auth_audit')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('ts', 'timestamptz', (col) => col.notNull())
    .addColumn('actor_id', 'varchar(120)')
    .addColumn('action', 'varchar(80)', (col) => col.notNull())
    // auth.login | auth.login.failed | auth.lockout | auth.reset.request | ...
    .addColumn('outcome', 'varchar(20)', (col) => col.notNull())
    // success | failed | locked | blocked
    .addColumn('method', 'varchar(20)')
    // password | google | passkey | telegram | reset
    .addColumn('ip_hash', 'varchar(64)')
    // sha256(IP) — to'liq IP saqlanmaydi (PII minimal)
    .addColumn('ua', 'varchar(500)')
    .addColumn('detail', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .execute();

  // Guide §30: audit indekslari — (ts, action) va (actor_id)
  await db.schema
    .createIndex('auth_audit_ts_action_idx')
    .on('auth_audit')
    .columns(['ts', 'action'])
    .execute();

  await db.schema
    .createIndex('auth_audit_actor_idx')
    .on('auth_audit')
    .columns(['actor_id'])
    .execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('auth_audit').execute();
}
