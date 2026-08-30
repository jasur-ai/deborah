/**
 * Deborah — Migration 036: Intervention Loop, Adaptive Practice & Support
 *
 * Prompt 55 — assessment evidence'dan teacher-approved action, reassessment
 * va formative mastery oqimi (research.md §47 #1 Assessment-to-Intervention
 * Loop, #6 Adaptive Mastery Practice, #10 Ethical Student Success Engine).
 * Precondition: Prompt 20 competency, Prompt 53 items, grade evidence
 * (attempts 014, ai_grading_runs 032).
 *
 *   - misconception_mappings: competency → misconception (label, evidence
 *     pattern, cluster_key) — AI suggestion, teacher approval shart.
 *   - misconception_clusters: cluster review — teacher cluster'ni ko'rib
 *     approve/reject qiladi (AI mapping teacher tasdig'isiz approved
 *     bo'lmaydi).
 *   - intervention_library / intervention_versions: versioned intervention
 *     content (video | exercise | reading | group_activity | reteach).
 *   - next_action_cards: teacher-visible next-action cards — evidence'dan
 *     recommendation, teacher approve/edit/dismiss/assign.
 *   - reassessments: DIFFERENT-item reassessment (source itemlar takror
 *     emas — non-duplication §item exposure).
 *   - mastery_estimates: rule + BKT (Bayesian Knowledge Tracing) mastery
 *     estimate (0..1), method, threshold, prior_p/learn_rate/slip/guess.
 *   - practice_sessions: spaced-repetition scheduler (formative only).
 *   - intervention_metrics: before / after / retention score.
 *   - support_cases + student_contest_requests: support signal/case va
 *     student contest (appeal) flow.
 *
 * SECURITY / DATA GUARD (Prompt 55 §15-17):
 *   - Permanent low-ability label YO'Q; auto penalty YO'Q; private chat
 *     sentiment ishlatilmaydi (privacy-first, §47 #10 — prediction emas,
 *     action).
 *   - Teacher approval'siz intervention assign qilinmaydi (AI hech qachon
 *     o'zi assign qilmaydi — faqat recommendation).
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. misconception_mappings — competency → misconception ──
  await db.schema
    .createTable('misconception_mappings')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('label', 'varchar(120)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('evidence_pattern', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('cluster_key', 'varchar(64)')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | reviewed | approved | rejected
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('misconception_mappings_tenant_label', ['tenant_id', 'competency_id', 'label']).execute()

  // ── 2. misconception_clusters — cluster review ──
  await db.schema
    .createTable('misconception_clusters')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('cluster_key', 'varchar(64)', (col) => col.notNull())
    .addColumn('title', 'varchar(160)', (col) => col.notNull())
    .addColumn('severity', 'varchar(20)', (col) => col.notNull().defaultTo('medium'))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | reviewed | approved | rejected
    .addColumn('review_note', 'text')
    .addColumn('reviewed_by', 'varchar(120)')
    .addColumn('reviewed_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('misconception_clusters_tenant_key', ['tenant_id', 'cluster_key']).execute()

  // ── 3. intervention_library — versioned intervention content ──
  await db.schema
    .createTable('intervention_library')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('kind', 'varchar(20)', (col) => col.notNull().defaultTo('exercise'))
    // video | exercise | reading | group_activity | reteach
    .addColumn('title', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('source_pack_id', 'integer', (col) =>
      col.references('source_packs.id').onDelete('set null')
    )
    .addColumn('target_cluster_id', 'integer', (col) =>
      col.references('misconception_clusters.id').onDelete('set null')
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | published | retired
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('intervention_library_tenant_title', ['tenant_id', 'title']).execute()

  // ── 4. intervention_versions — version history ──
  await db.schema
    .createTable('intervention_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('intervention_id', 'integer', (col) =>
      col.references('intervention_library.id').onDelete('cascade').notNull()
    )
    .addColumn('version_no', 'integer', (col) => col.notNull())
    .addColumn('title', 'varchar(160)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('published_at', 'timestamp')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('intervention_versions_iv_no', ['intervention_id', 'version_no']).execute()

  // ── 5. next_action_cards — teacher-approved action flow ──
  await db.schema
    .createTable('next_action_cards')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('cluster_id', 'integer', (col) =>
      col.references('misconception_clusters.id').onDelete('set null')
    )
    .addColumn('intervention_id', 'integer', (col) =>
      col.references('intervention_library.id').onDelete('set null')
    )
    .addColumn('source_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('rationale', 'text')
    .addColumn('priority', 'varchar(10)', (col) => col.notNull().defaultTo('medium'))
    // low | medium | high — evidence-based recommendation priority
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | approved | edited | dismissed | assigned | completed
    .addColumn('decided_by', 'varchar(120)')
    .addColumn('decided_at', 'timestamp')
    .addColumn('due_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('next_action_cards_tenant_student_comp', [
      'tenant_id',
      'student_id',
      'competency_id',
      'status',
    ]).execute()

  // ── 6. reassessments — DIFFERENT-item reassessment ──
  await db.schema
    .createTable('reassessments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('card_id', 'integer', (col) =>
      col.references('next_action_cards.id').onDelete('set null')
    )
    .addColumn('source_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('reassessment_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('item_ids', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // different-item non-duplication: source itemlar takrorlanmaydi
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('assigned'))
    // assigned | in_progress | completed
    .addColumn('assigned_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('reassessments_tenant_student_comp', [
      'tenant_id',
      'student_id',
      'competency_id',
    ]).execute()

  // ── 7. mastery_estimates — rule + BKT ──
  await db.schema
    .createTable('mastery_estimates')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('method', 'varchar(10)', (col) => col.notNull().defaultTo('rule'))
    // rule | bkt
    .addColumn('mastery_est', sql`numeric(6,4)`, (col) => col.notNull().defaultTo(0))
    .addColumn('threshold', sql`numeric(6,4)`, (col) => col.notNull().defaultTo(0.8))
    .addColumn('level', 'varchar(20)', (col) => col.notNull().defaultTo('below'))
    // below | approaching | at | above
    .addColumn('prior_p', sql`numeric(6,4)`)
    .addColumn('learn_rate', sql`numeric(6,4)`)
    .addColumn('slip', sql`numeric(6,4)`)
    .addColumn('guess', sql`numeric(6,4)`)
    .addColumn('evidence_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('last_evidence_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('mastery_estimates_tenant_student_comp_method', [
      'tenant_id',
      'student_id',
      'competency_id',
      'method',
    ]).execute()

  // ── 8. practice_sessions — spaced-repetition scheduler ──
  await db.schema
    .createTable('practice_sessions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade').notNull()
    )
    .addColumn('session_type', 'varchar(20)', (col) => col.notNull().defaultTo('practice'))
    .addColumn('scheduled_at', 'timestamp', (col) => col.notNull())
    .addColumn('due_at', 'timestamp', (col) => col.notNull())
    .addColumn('interval_days', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('scheduled'))
    // scheduled | active | completed | skipped
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('practice_sessions_tenant_student_comp_due', [
      'tenant_id',
      'student_id',
      'competency_id',
      'due_at',
    ]).execute()

  // ── 9. intervention_metrics — before / after / retention ──
  await db.schema
    .createTable('intervention_metrics')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('intervention_id', 'integer', (col) =>
      col.references('intervention_library.id').onDelete('cascade').notNull()
    )
    .addColumn('pre_score', sql`numeric(6,4)`)
    .addColumn('post_score', sql`numeric(6,4)`)
    .addColumn('retention_score', sql`numeric(6,4)`)
    .addColumn('pre_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('post_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('retention_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('intervention_metrics_tenant_student_iv', [
      'tenant_id',
      'student_id',
      'intervention_id',
    ]).execute()

  // ── 10. support_cases — Ethical Student Success (no prediction labels) ──
  await db.schema
    .createTable('support_cases')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('signal_type', 'varchar(30)', (col) => col.notNull().defaultTo('weak_concept'))
    // at_risk | weak_concept | mastery_gap | attendance | engagement
    .addColumn('evidence', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('case_status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open | triaged | closed
    .addColumn('owner', 'varchar(120)')
    .addColumn('notes', 'text')
    .addColumn('is_temporary', 'boolean', (col) => col.notNull().defaultTo(true))
    // §15: hech qanday permanent label yo'q
    .addColumn('auto_penalty', 'boolean', (col) => col.notNull().defaultTo(false))
    // §15: auto penalty yo'q — faqat teacher action
    .addColumn('closed_at', 'timestamp')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('support_cases_tenant_student_signal_open', [
      'tenant_id',
      'student_id',
      'signal_type',
      'case_status',
    ]).execute()

  // ── 11. student_contest_requests — student contest/appeal flow ──
  await db.schema
    .createTable('student_contest_requests')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('case_id', 'integer', (col) =>
      col.references('support_cases.id').onDelete('cascade')
    )
    .addColumn('request_type', 'varchar(20)', (col) => col.notNull().defaultTo('appeal'))
    // appeal | contest | review
    .addColumn('reason', 'text')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open | approved | rejected | closed
    .addColumn('outcome', 'text')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('student_contest_requests_tenant_student_case', [
      'tenant_id',
      'student_id',
      'case_id',
    ]).execute()
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('student_contest_requests');
  await db.schema.dropTable('support_cases');
  await db.schema.dropTable('intervention_metrics');
  await db.schema.dropTable('practice_sessions');
  await db.schema.dropTable('mastery_estimates');
  await db.schema.dropTable('reassessments');
  await db.schema.dropTable('next_action_cards');
  await db.schema.dropTable('intervention_versions');
  await db.schema.dropTable('intervention_library');
  await db.schema.dropTable('misconception_clusters');
  await db.schema.dropTable('misconception_mappings');
}
