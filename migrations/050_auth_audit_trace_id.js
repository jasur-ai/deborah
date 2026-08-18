/**
 * Edikit — Migration 050: auth_audit.trace_id (AUTH D-05 §13)
 *
 * Incident korrelyatsiyasi: auth_audit yozuvlari trace_id bilan bog'lanadi —
 * support ticket / incident'da trace'ni topish (C-09 audit bilan).
 * - trace_id: varchar(64) — W3C 32-hex trace id; null bo'lishi mumkin
 *   (span context faol bo'lmagan yozuvlar — legacy).
 * - Indeks: (trace_id) — incident'da tez qidiruv.
 *
 * Precondition: 049 auth_audit mavjud.
 */
import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .alterTable('auth_audit')
    .addColumn('trace_id', 'varchar(64)');
  await db.schema
    .createIndex('auth_audit_trace_id_idx')
    .on('auth_audit')
    .column('trace_id');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.alterTable('auth_audit').dropIndex('auth_audit_trace_id_idx');
  await db.schema.alterTable('auth_audit').dropColumn('trace_id');
}

export default { up, down };
