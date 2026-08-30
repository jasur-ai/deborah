/**
 * Deborah — Migration 020: Privacy-first Camera Evidence Pilot
 *
 * Prompt 37 — local inference, LIMITED evidence, human review (research.md
 * §27 — evidence portfolio, surveillance emas; §15 — biometric storage
 * boundary). Camera monitoring S2 profile (Prompt 36) uchun:
 *
 *   - camera_pilot_policy: bitta row per tenant — pilot flag, 2–5 FPS
 *     pipeline konfigi, consecutive-window threshold, per-attempt snapshot
 *     limiti va retention kunlari. Pilot OFF bo'lsa hech narsa yozilmaydi
 *     (alternative path — §25 done condition).
 *   - camera_consent: per (tenant, user, assignment) — oldindan informed
 *     consent (§27.5). consent_version policy'ga bog'lanadi; revoke mumkin.
 *   - camera_evidence: append-only evidence log. FAKAT FLAGS saqlanadi
 *     (face_present, face_count, phone_detected, freeze_detected) — raw
 *     frame/clip YO'Q, faqat policy ruxsat berganda cheklangan snapshot
 *     storage_key + content_hash (tamper-evident, §31.5 naqshi).
 *     UNIQUE (tenant, attempt, client_seq) → client retry idempotent.
 *     disposition: pending → cleared | reviewed | discarded (human review).
 *   - camera_evidence_review: disposition tarixi (kim, qachon, qanday qaror,
 *     izoh) — audit trail.
 *
 * DATA GUARD (Prompt 37 §15): emotion, gaze, honesty score, automatic
 * misconduct — ushbu jadvalda SAQLANMAYDI. Schema qat'iy whitelist flag'lar.
 *
 * Rollback: down() orqali o'chiriladi.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Camera pilot policy (one row per tenant) ──
  await db.schema
    .createTable('camera_pilot_policy')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('pilot_enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('fps_min', 'integer', (col) => col.notNull().defaultTo(2))
    .addColumn('fps_max', 'integer', (col) => col.notNull().defaultTo(5))
    .addColumn('window_ms', 'integer', (col) => col.notNull().defaultTo(3000))
    .addColumn('snapshot_limit', 'integer', (col) => col.notNull().defaultTo(10))
    .addColumn('retention_days', 'integer', (col) => col.notNull().defaultTo(30))
    .addColumn('consent_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('updated_by', 'integer')
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('uq_camera_pilot_policy_tenant')
    .on('camera_pilot_policy')
    .columns(['tenant_id'])
    .unique()
    .execute();

  // ── 2. Camera consent (informed, revocable) ──
  await db.schema
    .createTable('camera_consent')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('assignment_id', 'integer', (col) => col.notNull())
    .addColumn('consent_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('granted_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('uq_camera_consent_user_assignment')
    .on('camera_consent')
    .columns(['tenant_id', 'user_id', 'assignment_id'])
    .unique()
    .execute();

  // ── 3. Camera evidence (flags only, append-only, idempotent) ──
  await db.schema
    .createTable('camera_evidence')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('attempt_id', 'integer', (col) => col.notNull())
    .addColumn('user_id', 'integer', (col) => col.notNull())
    .addColumn('client_seq', 'integer', (col) => col.notNull())
    .addColumn('event_type', 'varchar(20)', (col) => col.notNull().defaultTo('flag'))
    .addColumn('flags', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    .addColumn('captured_at', 'timestamptz', (col) => col.notNull())
    .addColumn('storage_key', 'varchar(255)')
    .addColumn('content_hash', 'varchar(64)')
    .addColumn('retention_until', 'timestamptz')
    .addColumn('disposition', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    .execute();

  await db.schema
    .createIndex('uq_camera_evidence_attempt_seq')
    .on('camera_evidence')
    .columns(['tenant_id', 'attempt_id', 'client_seq'])
    .unique()
    .execute();

  await db.schema
    .createIndex('idx_camera_evidence_attempt')
    .on('camera_evidence')
    .columns(['attempt_id'])
    .execute();

  // ── 4. Evidence review disposition history (human review trail) ──
  await db.schema
    .createTable('camera_evidence_review')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) => col.notNull())
    .addColumn('evidence_id', 'integer', (col) => col.notNull())
    .addColumn('disposition', 'varchar(20)', (col) => col.notNull())
    .addColumn('note', 'text')
    .addColumn('reviewed_by', 'integer', (col) => col.notNull())
    .addColumn('reviewed_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex('idx_camera_review_evidence')
    .on('camera_evidence_review')
    .columns(['evidence_id'])
    .execute();

  // ── Grants ──
  await sql`GRANT SELECT, INSERT, UPDATE ON camera_pilot_policy TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON camera_pilot_policy_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON camera_consent TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON camera_consent_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT, UPDATE, DELETE ON camera_evidence TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON camera_evidence_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, INSERT ON camera_evidence_review TO deborah_runtime`.execute(db);
  await sql`GRANT USAGE ON camera_evidence_review_id_seq TO deborah_runtime`.execute(db);
  await sql`GRANT SELECT, DELETE ON camera_pilot_policy, camera_consent, camera_evidence, camera_evidence_review TO deborah_migration`.execute(db);

  console.log('Camera evidence pilot structure created: policy / consent / evidence / review (flags-only, raw frames never stored)');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('camera_evidence_review').ifExists().execute();
  await db.schema.dropTable('camera_evidence').ifExists().execute();
  await db.schema.dropTable('camera_consent').ifExists().execute();
  await db.schema.dropTable('camera_pilot_policy').ifExists().execute();
}
