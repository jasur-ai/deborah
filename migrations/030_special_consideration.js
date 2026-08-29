/**
 * Deborah — Migration 030: Special Consideration, Deferral, Resit, Appeal &
 * Scoring Incident (Prompt 48)
 *
 * Prompt 48 — sensitive case, attempt lineage, remedy va wrong-key rescore
 * workflowini yopish (research.md §72 Special Consideration/Extension/
 * Deferral/Resit/Regrade/Appeal, §71.7 wrong answer key, §72.3 case
 * workflow, §72.2 sensitive evidence separation):
 *
 *   - special_consideration_cases: unified case record with type
 *     (extension | special_consideration | deferral | resit | recheck |
 *     regrade | appeal | technical_incident) and the §72.3 lifecycle:
 *     DRAFT → SUBMITTED → EVIDENCE_CHECK → ELIGIBILITY_REVIEW →
 *     DECISION_PENDING → APPROVED|PARTIAL|REJECTED → REMEDY_SCHEDULED →
 *     REMEDY_COMPLETED → CLOSED|APPEALED. SLA deadline + owner.
 *   - case_evidence: RESTRICTED ENCRYPTED evidence store — sensitive
 *     evidence (health/care/bereavement) AES-256-GCM encrypted, marker/
 *     proctor KO'RMAYDI (§72.2); access audited, short retention.
 *   - case_decisions: append-only decision history (decision, reason,
 *     decided_by, decided_at) — audit trail.
 *   - case_remedies: attempt lineage + remedy — extension, deferral,
 *     resit, recheck, regrade, equivalent_assessment, technical_resume.
 *     Records counts_as_attempt, cap_rule (policy pin), supersedes
 *     (old attempt → new attempt), equivalent assessment assignment,
 *     board_decision reference (§72.4 attempt lineage).
 *   - scoring_incidents: wrong-key / scoring defect — freeze, impact,
 *     remedy (accept_multiple | remove_item | rescore | no_action),
 *     no-detriment policy, authorized approval (§71.7).
 *   - scoring_incident_impacts: per-student before/after impact snapshot.
 *   - rescore_runs: IDEMPOTENT rescore (UNIQUE incident+attempt) — a
 *     rescore run that already succeeded is never re-executed; grade
 *     changes flow through the board amendment ledger (Prompt 47).
 *
 * SECURITY / DATA GUARD (Prompt 48 §15-17):
 *   - AI case hukmi chiqarmaydi — decisions require a human decider.
 *   - Marker/proctor sensitive evidence ko'rmaydi — ACL is enforced in
 *     service (hasSensitiveAccess) + evidence stored encrypted.
 *   - Rescore idempotent; final grade change only via Grade Change Ledger
 *     (board.grade_amendments).
 *   - Har bir write path tenant-scoped + idempotent (UNIQUE indexlar).
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. special_consideration_cases — unified case lifecycle ──
  await db.schema
    .createTable('special_consideration_cases')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('case_type', 'varchar(24)', (col) => col.notNull())
    // extension | special_consideration | deferral | resit | recheck |
    // regrade | appeal | technical_incident
    .addColumn('case_reference', 'varchar(40)', (col) => col.notNull())
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade')
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('grade_calculation_runs.id').onDelete('cascade')
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft → submitted → evidence_check → eligibility_review →
    // decision_pending → approved|partial|rejected → remedy_scheduled →
    // remedy_completed → closed|appealed
    .addColumn('grounds', 'varchar(2000)')
    .addColumn('summary', 'varchar(1000)')
    // What the MARKER may see: e.g. "approved adjustment: +3 working days"
    // (never the sensitive reason/evidence).
    .addColumn('owner_user_id', 'integer')
    .addColumn('sla_deadline', 'timestamptz')
    .addColumn('submitted_at', 'timestamptz')
    .addColumn('decided_at', 'timestamptz')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_consideration_case_ref
    ON special_consideration_cases (tenant_id, case_reference)
  `.execute(db);
  await db.schema
    .createIndex('idx_consideration_status')
    .on('special_consideration_cases')
    .columns(['tenant_id', 'status', 'sla_deadline'])
    .execute();

  // ── 2. case_evidence — RESTRICTED ENCRYPTED evidence store ──
  await db.schema
    .createTable('case_evidence')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('case_id', 'integer', (col) =>
      col.references('special_consideration_cases.id').onDelete('cascade').notNull()
    )
    .addColumn('evidence_type', 'varchar(24)')
    // medical | certificate | statement | other
    .addColumn('file_name', 'varchar(255)')
    .addColumn('data_encrypted', 'jsonb', (col) => col.notNull())
    // { ciphertext, iv, tag } — AES-256-GCM; marker/proctor cannot read
    .addColumn('access_role', 'varchar(24)', (col) => col.notNull().defaultTo('institution_admin'))
    .addColumn('retention_until', 'timestamptz')
    .addColumn('last_accessed_at', 'timestamptz')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_case_evidence_case')
    .on('case_evidence')
    .columns(['tenant_id', 'case_id'])
    .execute();

  // ── 3. case_decisions — append-only decision history ──
  await db.schema
    .createTable('case_decisions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('case_id', 'integer', (col) =>
      col.references('special_consideration_cases.id').onDelete('cascade').notNull()
    )
    .addColumn('decision', 'varchar(12)', (col) => col.notNull())
    // approved | partial | rejected
    .addColumn('reason', 'varchar(1000)', (col) => col.notNull())
    // Human decider identifier (admin username or user id string) — AI
    // case hukmi chiqarmaydi (§15): the service refuses 'ai'/'system' etc.
    .addColumn('decided_by', 'varchar(64)')
    .addColumn('decided_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_case_decisions_case')
    .on('case_decisions')
    .columns(['tenant_id', 'case_id'])
    .execute();

  // ── 4. case_remedies — attempt lineage + remedy ──
  await db.schema
    .createTable('case_remedies')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('case_id', 'integer', (col) =>
      col.references('special_consideration_cases.id').onDelete('cascade').notNull()
    )
    .addColumn('remedy_type', 'varchar(24)', (col) => col.notNull())
    // extension | deferral | resit | recheck | regrade |
    // equivalent_assessment | technical_resume
    .addColumn('adjustment', 'varchar(200)')
    // e.g. "+3 working days", "new window", "capped 60%"
    .addColumn('counts_as_attempt', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('cap_rule', 'varchar(16)', (col) => col.defaultTo(null))
    // none | capped | best_of | max_attempts (policy pin)
    .addColumn('cap_policy_version', 'varchar(32)')
    .addColumn('supersedes_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('new_attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('set null')
    )
    .addColumn('equivalent_assignment_id', 'integer', (col) =>
      col.references('assessment_assignments.id').onDelete('set null')
    )
    .addColumn('board_decision_id', 'integer', (col) =>
      col.references('board_decisions.id').onDelete('set null')
    )
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('scheduled'))
    // scheduled → completed | voided
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_case_remedies_case')
    .on('case_remedies')
    .columns(['tenant_id', 'case_id'])
    .execute();

  // ── 5. scoring_incidents — wrong-key / scoring defect ──
  await db.schema
    .createTable('scoring_incidents')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('assessment_id', 'integer', (col) =>
      col.references('assessments.id').onDelete('cascade')
    )
    .addColumn('title', 'varchar(255)', (col) => col.notNull())
    .addColumn('status', 'varchar(16)', (col) => col.notNull().defaultTo('open'))
    // open → frozen → resolved
    .addColumn('severity', 'varchar(12)', (col) => col.notNull().defaultTo('high'))
    // low | medium | high | critical
    .addColumn('kind', 'varchar(20)', (col) => col.notNull().defaultTo('wrong_key'))
    // wrong_key | scoring_defect | policy_change | other
    .addColumn('description', 'varchar(2000)')
    .addColumn('corrected_key_version', 'varchar(40)')
    .addColumn('remedy', 'varchar(24)')
    // accept_multiple | remove_item | rescore | no_action
    .addColumn('no_detriment', 'boolean', (col) => col.notNull().defaultTo(true))
    .addColumn('approved_by', 'integer')
    .addColumn('approved_at', 'timestamptz')
    .addColumn('frozen_at', 'timestamptz')
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_scoring_incidents_status')
    .on('scoring_incidents')
    .columns(['tenant_id', 'status'])
    .execute();

  // ── 6. scoring_incident_impacts — per-student before/after ──
  await db.schema
    .createTable('scoring_incident_impacts')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('incident_id', 'integer', (col) =>
      col.references('scoring_incidents.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade')
    )
    .addColumn('score_before', 'decimal(8,2)')
    .addColumn('score_after', 'decimal(8,2)')
    .addColumn('delta', 'decimal(8,2)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_incident_impact_user
    ON scoring_incident_impacts (tenant_id, incident_id, user_id)
  `.execute(db);

  // ── 7. rescore_runs — IDEMPOTENT rescore ──
  await db.schema
    .createTable('rescore_runs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('incident_id', 'integer', (col) =>
      col.references('scoring_incidents.id').onDelete('cascade').notNull()
    )
    .addColumn('attempt_id', 'integer', (col) =>
      col.references('attempts.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('grade_calculation_runs.id').onDelete('cascade')
    )
    .addColumn('status', 'varchar(12)', (col) => col.notNull().defaultTo('queued'))
    // queued → running → completed | failed
    .addColumn('score_before', 'decimal(8,2)')
    .addColumn('score_after', 'decimal(8,2)')
    .addColumn('amendment_id', 'integer')
    // grade_amendments.id — grade change via Ledger (§71.6)
    .addColumn('result_json', 'jsonb')
    .addColumn('error', 'varchar(1000)')
    .addColumn('completed_at', 'timestamptz')
    .addColumn('created_by', 'integer')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX uq_rescore_attempt
    ON rescore_runs (tenant_id, incident_id, attempt_id)
  `.execute(db);

  // ── Grants (sql-template pattern) ──
  const newTables = [
    'special_consideration_cases',
    'case_evidence',
    'case_decisions',
    'case_remedies',
    'scoring_incidents',
    'scoring_incident_impacts',
    'rescore_runs',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO deborah_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO deborah_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO deborah_migration`.execute(db);
  }
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  const tables = [
    'rescore_runs',
    'scoring_incident_impacts',
    'scoring_incidents',
    'case_remedies',
    'case_decisions',
    'case_evidence',
    'special_consideration_cases',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
