/**
 * Edikit — Migration 023: Exam Command Center, Incident & Notifications (Prompt 41)
 *
 * Prompt 41 — exam-day health, attendance va incidentlarni bitta auditable
 * command centerda boshqarish (research.md §53.4–53.7, §38.5 incident
 * runbooks, §15 relational schema):
 *
 *   - incidents: incident registry — type/severity/status state machine,
 *     owner_user_id, affected_candidate_ids (scope), action_required,
 *     summary, detected_at/resolved_at/closed_at. Idempotency via
 *     (tenant_id, external_key) UNIQUE.
 *   - incident_actions: pause/extension/evacuation hooks + any remedial
 *     action — action_type, detail (jsonb), actor, evidence note. Attached
 *     to an incident; every incident must have ≥1 action before close.
 *   - incident_state_history: append-only state machine journal —
 *     from_status → to_status + actor + reason (close reason required).
 *   - notification_outbox: mass notification queue — channel
 *     (email|sms|telegram), recipient_scope, template_key, payload (jsonb,
 *     SANITIZED preview — NEVER raw sensitive health/integrity detail),
 *     status lifecycle (pending → sent|failed → delivered), idempotency via
 *     (tenant_id, idempotency_key) UNIQUE, delivery_status + attempts.
 *     Invalidated old-schedule notifications flagged via superseded_by.
 *   - postmortems: incident post-exam review — summary/root_cause/status
 *     (draft → reviewed → closed), owner.
 *   - postmortem_action_items: action-item workflow — owner, status
 *     (open → in_progress → done|blocked), due_at, done_at.
 *
 * SECURITY / DATA GUARD (Prompt 41 §15):
 *   - notification_outbox.payload faqat SANITIZED preview — sensitive
 *     health/integrity/answer-key detail hech qachon saqlanmaydi.
 *   - affected_candidate_ids faqat user id'lari (scope); raw incident
 *     rationale incident_actions.detail'da emas, faqat kodlar + summary.
 *   - Har bir write path tenant-scoped + idempotency key (external_key /
 *     idempotency_key) bilan.
 *
 * Rollback: down() orqali o'chiriladi.
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  const { sql } = await import('kysely');
  // ── 1. Incidents (exam-day incident registry) ──
  await db.schema
    .createTable('incidents')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('exam_schedule_runs.id').onDelete('set null')
    )
    .addColumn('room_id', 'integer', (col) =>
      col.references('exam_rooms.id').onDelete('set null')
    )
    .addColumn('period_id', 'integer', (col) =>
      col.references('exam_periods.id').onDelete('set null')
    )
    .addColumn('type', 'varchar(40)', (col) => col.notNull())
    // identity_mismatch | medical | accessibility | network_power |
    // wrong_paper | packet_mismatch | rule_violation | evacuation |
    // time_correction | proctor_replacement | other
    .addColumn('severity', 'varchar(20)', (col) => col.notNull().defaultTo('medium'))
    // critical | high | medium | low
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open → investigating → mitigated → resolved → closed (state machine)
    .addColumn('summary', 'varchar(500)', (col) => col.notNull())
    .addColumn('owner_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('affected_candidate_ids', 'jsonb', (col) => col.defaultTo('[]'))
    // user id'lari (scope) — raw rationale emas
    .addColumn('action_required', 'varchar(255)')
    .addColumn('external_key', 'varchar(120)')
    // idempotency — tashqi tizimdan takroriy yaratishni bloklaydi
    .addColumn('detected_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('resolved_at', 'timestamptz')
    .addColumn('closed_at', 'timestamptz')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_incidents_tenant_status')
    .on('incidents')
    .columns(['tenant_id', 'status', 'detected_at'])
    .execute();

  await db.schema
    .createIndex('idx_incidents_room')
    .on('incidents')
    .columns(['tenant_id', 'room_id', 'detected_at'])
    .execute();

  await db.schema
    .createIndex('uq_incidents_external_key', { unique: true })
    .on('incidents')
    .columns(['tenant_id', 'external_key'])
    .execute();

  // ── 2. Incident actions (pause/extension/evacuation hooks + remedy) ──
  await db.schema
    .createTable('incident_actions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('incident_id', 'integer', (col) =>
      col.references('incidents.id').onDelete('cascade').notNull()
    )
    .addColumn('action_type', 'varchar(30)', (col) => col.notNull())
    // pause | extension | evacuation | notify | remedy | other
    .addColumn('client_key', 'varchar(120)')
    // idempotency — takroriy action yuborishni bloklaydi (Prompt 41 §16)
    .addColumn('detail', 'jsonb', (col) => col.defaultTo('{}'))
    // { minutes, scope, channel, template_key, ... } — sanitized, no raw health text
    .addColumn('actor_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('evidence_note', 'varchar(500)')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_incident_actions_incident')
    .on('incident_actions')
    .columns(['incident_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('uq_incident_actions_client_key', { unique: true })
    .on('incident_actions')
    .columns(['tenant_id', 'incident_id', 'client_key'])
    .execute();

  // ── 3. Incident state history (append-only audit journal) ──
  await db.schema
    .createTable('incident_state_history')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('incident_id', 'integer', (col) =>
      col.references('incidents.id').onDelete('cascade').notNull()
    )
    .addColumn('from_status', 'varchar(20)', (col) => col.notNull())
    .addColumn('to_status', 'varchar(20)', (col) => col.notNull())
    .addColumn('actor_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('reason', 'varchar(500)')
    // close uchun MAJBURIY (done condition: owner + action + reason)
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_incident_history_incident')
    .on('incident_state_history')
    .columns(['incident_id', 'created_at'])
    .execute();

  // ── 4. Notification outbox (email/SMS/Telegram deep-link boundary) ──
  await db.schema
    .createTable('notification_outbox')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('incident_id', 'integer', (col) =>
      col.references('incidents.id').onDelete('set null')
    )
    .addColumn('channel', 'varchar(20)', (col) => col.notNull())
    // email | sms | telegram
    .addColumn('recipient_scope', 'varchar(30)', (col) => col.notNull().defaultTo('staff'))
    // staff | room | candidates | all
    .addColumn('template_key', 'varchar(60)', (col) => col.notNull())
    // incident_opened | incident_updated | evacuation | schedule_change | ...
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    // SANITIZED preview — sensitive health/integrity detail YO'Q (§15)
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending → sent → delivered | failed
    .addColumn('delivery_status', 'jsonb', (col) => col.defaultTo('{}'))
    // { attempts, last_error_code, delivered_at } — no raw error text
    .addColumn('idempotency_key', 'varchar(200)', (col) => col.notNull())
    .addColumn('superseded_by', 'integer')
    // old-schedule invalidation: yangi notification eski'sini supersede qiladi
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_notif_outbox_tenant_status')
    .on('notification_outbox')
    .columns(['tenant_id', 'status', 'created_at'])
    .execute();

  await db.schema
    .createIndex('uq_notif_outbox_key', { unique: true })
    .on('notification_outbox')
    .columns(['tenant_id', 'idempotency_key'])
    .execute();

  // ── 5. Postmortems (post-exam review) ──
  await db.schema
    .createTable('postmortems')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('incident_id', 'integer', (col) =>
      col.references('incidents.id').onDelete('cascade').notNull()
    )
    .addColumn('summary', 'varchar(500)')
    .addColumn('root_cause', 'varchar(500)')
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft → reviewed → closed
    .addColumn('owner_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_postmortems_incident')
    .on('postmortems')
    .columns(['tenant_id', 'incident_id'])
    .execute();

  // ── 6. Postmortem action items (workflow) ──
  await db.schema
    .createTable('postmortem_action_items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('postmortem_id', 'integer', (col) =>
      col.references('postmortems.id').onDelete('cascade').notNull()
    )
    .addColumn('description', 'varchar(500)', (col) => col.notNull())
    .addColumn('owner_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('open'))
    // open → in_progress → done | blocked
    .addColumn('due_at', 'timestamptz')
    .addColumn('done_at', 'timestamptz')
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_pm_action_items_postmortem')
    .on('postmortem_action_items')
    .columns(['tenant_id', 'postmortem_id', 'status'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'incidents',
    'incident_actions',
    'incident_state_history',
    'notification_outbox',
    'postmortems',
    'postmortem_action_items',
  ];
  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO edikit_migration`.execute(db);
  }
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  const tables = [
    'postmortem_action_items',
    'postmortems',
    'notification_outbox',
    'incident_state_history',
    'incident_actions',
    'incidents',
  ];
  for (const table of tables) {
    await db.schema.dropTable(table).ifExists().execute();
  }
}
