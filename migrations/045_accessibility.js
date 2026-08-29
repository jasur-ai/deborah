/**
 * Deborah — Migration 045: WCAG 2.2 AA & Artifact Accessibility
 *
 * Prompt 64 — teacher/student/admin/proctor critical journeys va generated
 * artifactlarni (PDF/DOCX/PPTX) accessible qilish (research.md §26.1
 * accessibility evidence, §29 accommodation; §28 artifact accessibility).
 * Precondition: main frontend screens va exports mavjud.
 *
 * Tables:
 *   - a11y_settings: foydalanuvchi/tenant accessibility preferences
 *     (reduced motion, high contrast, font scale, keyboard nav, screen
 *     reader mode) — WCAG 2.2 2.3.3 / 1.4.8 / prefers-reduced-motion.
 *   - a11y_audits: ACR evidence (Accessibility Conformance Report) —
 *     axe-style automated snapshot, wcag target, score, violations,
 *     journey/page scope, run_by. Automated checker o'zi yetarli emas —
 *     needs_review inson tekshiruvi uchun flag (Prompt 64 §15).
 *   - a11y_gaps: known-gap backlog — rule_id, impact, severity,
 *     blocker/priority classification, status FSM
 *     open→in_progress→fixed→verified (verified faqat inson ACR bilan).
 *   - a11y_artifact_checks: PDF/DOCX/PPTX reading order + alt text +
 *     contrast QA natijalari (reading_order_ok, alt_text_issues jsonb,
 *     contrast_issues jsonb).
 *
 * SECURITY / DATA GUARD (Prompt 64 §15-17):
 *   - Automated checker YETARLI emas — har gap status transitionida
 *     inson verification talab qilinadi (strike bo'lmasin).
 *   - Har write path tenant-scoped + fail-closed + idempotent + audited.
 *   - Privileged actionlar (audit run, gap close, artifact approve) audit
 *     event va trace bilan.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  await db.schema
    .createTable('a11y_settings')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_key', 'varchar(120)', (col) => col.notNull())
    // Preferences (WCAG 2.2 2.3.3 animation from interactions, 1.4.8)
    .addColumn('reduced_motion', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('high_contrast', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('font_scale', 'real', (col) => col.notNull().defaultTo(1.0))
    .addColumn('keyboard_nav', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('screen_reader_mode', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('updated_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('a11y_settings_tenant_user_uniq', ['tenant_id', 'user_key']);

  await db.schema
    .createTable('a11y_audits')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('journey', 'varchar(40)', (col) => col.notNull())
    // teacher | student | admin | proctor
    .addColumn('page_url', 'varchar(300)')
    .addColumn('wcag_target', 'varchar(20)', (col) => col.notNull().defaultTo('2.2-AA'))
    .addColumn('score', 'real')
    .addColumn('violations', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('passes', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('incomplete', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('needs_review', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('blocker_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('run_by', 'varchar(120)')
    .addColumn('run_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull());

  await db.schema
    .createTable('a11y_gaps')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('rule_id', 'varchar(60)', (col) => col.notNull())
    .addColumn('description', 'text', (col) => col.notNull())
    .addColumn('journey', 'varchar(40)')
    .addColumn('impact', 'varchar(40)')
    .addColumn('severity', 'varchar(20)', (col) => col.notNull().defaultTo('major'))
    // blocker | critical | major | minor
    .addColumn('is_blocker', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open → in_progress → fixed → verified
    .addColumn('assignee', 'varchar(120)')
    .addColumn('target_date', 'date')
    .addColumn('verified_by', 'varchar(120)')
    .addColumn('verified_at', 'timestamptz')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addColumn('updated_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull());

  await db.schema
    .createTable('a11y_artifact_checks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('artifact_type', 'varchar(10)', (col) => col.notNull())
    // pdf | docx | pptx
    .addColumn('artifact_id', 'integer', (col) => col.notNull())
    .addColumn('reading_order_ok', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('alt_text_issues', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('contrast_issues', 'jsonb', (col) => col.notNull().defaultTo('[]'))
    .addColumn('tagged_pdf', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('checked'))
    .addColumn('checked_by', 'varchar(120)')
    .addColumn('checked_at', 'timestamptz', (col) => col.defaultTo(sql`now()`).notNull())
    .addUniqueConstraint('a11y_artifact_uniq', ['tenant_id', 'artifact_type', 'artifact_id']);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('a11y_artifact_checks');
  await db.schema.dropTable('a11y_gaps');
  await db.schema.dropTable('a11y_audits');
  await db.schema.dropTable('a11y_settings');
}
