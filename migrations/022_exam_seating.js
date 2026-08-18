/**
 * Deborah — Migration 022: Seat, Proctor, Hall Ticket & Check-in (Prompt 40)
 *
 * Prompt 40 — published schedule asosida seat/proctor assignment va
 * offline-tolerant check-in (research.md §15 relational schema, §53.3 Seating):
 *
 *   - room_seat_maps: room seat-map — row/seat grid, per-seat features
 *     (power, wheelchair_access), accessible reserved seats. Versioned.
 *   - exam_seat_assignments: student → room + row/seat + variant, per
 *     schedule-run assignment. UNIQUE (tenant, run_id, event_id,
 *     student_user_id) → idempotent re-allocate. hall_ticket_token =
 *     signed QR payload hash; checked_in_at/by + client_seq → offline-
 *     tolerant check-in. reseat_of → reseat/replacement audit chain.
 *   - proctor_duty_assignments: proctor → period + room duty. UNIQUE
 *     (tenant, run_id, period_id, room_id, proctor_user_id) + UNIQUE
 *     (tenant, run_id, period_id, proctor_user_id) → no same-period clash.
 *   - checkin_journal: offline-tolerant append-only journal — device_id +
 *     client_seq idempotency, acked_seq high-water mark, status lifecycle.
 *   - hall_ticket_acks: student acknowledgement of hall ticket (version).
 *   - reseat_audit: reseat/replacement audit trail — from_seat/to_seat,
 *     reason (sensitive details never stored raw), actor, at.
 *
 * SECURITY / DATA GUARD (Prompt 40 §15):
 *   - Seat QR/hall-ticket payload never contains answer keys or raw
 *     sensitive accommodation reasons — only flags (accommodation_flags)
 *     and a signed token hash.
 *   - Har bir write path tenant-scoped + client_seq/external_key idempotency.
 *
 * Rollback: down() orqali o'chiriladi.
 */

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Room seat maps (room layout) ──
  await db.schema
    .createTable('room_seat_maps')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('room_id', 'integer', (col) =>
      col.references('exam_rooms.id').onDelete('cascade').notNull()
    )
    .addColumn('layout', 'jsonb', (col) => col.notNull().defaultTo('{}'))
    // { rows: [{ label, seats: [{ label, features: [], accessible }] }] }
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    // seat-map version — hall ticket checks current version (§53.3)
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    // active | inactive
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_seat_maps_room')
    .on('room_seat_maps')
    .columns(['tenant_id', 'room_id', 'version'])
    .execute();

  // ── 2. Exam seat assignments (student → room + seat + variant) ──
  await db.schema
    .createTable('exam_seat_assignments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('exam_schedule_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('event_id', 'integer', (col) =>
      col.references('program_events.id').onDelete('cascade').notNull()
    )
    .addColumn('period_id', 'integer', (col) =>
      col.references('exam_periods.id').onDelete('set null')
    )
    .addColumn('room_id', 'integer', (col) =>
      col.references('exam_rooms.id').onDelete('set null')
    )
    .addColumn('student_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('row_label', 'varchar(20)')
    .addColumn('seat_label', 'varchar(20)')
    .addColumn('variant', 'varchar(20)')
    // test variant: A | B | C | null
    .addColumn('accommodation_flags', 'jsonb', (col) => col.defaultTo('[]'))
    // e.g. ['extra_time', 'accessible_seat'] — NEVER raw sensitive reason
    .addColumn('hall_ticket_token', 'varchar(128)')
    // signed QR payload hash — answer keys / raw reasons YO'Q
    .addColumn('checked_in_at', 'timestamptz')
    .addColumn('checked_in_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('client_seq', 'integer')
    // offline check-in journal seq — idempotent replay
    .addColumn('reseat_of', 'integer')
    // prior seat assignment id — reseat/replacement audit chain
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_seat_assignments_run_event')
    .on('exam_seat_assignments')
    .columns(['tenant_id', 'run_id', 'event_id'])
    .execute();

  await db.schema
    .createIndex('idx_seat_assignments_student')
    .on('exam_seat_assignments')
    .columns(['tenant_id', 'student_user_id', 'run_id'])
    .execute();

  await db.schema
    .createIndex('uq_seat_assignment_student', { unique: true })
    .on('exam_seat_assignments')
    .columns(['tenant_id', 'run_id', 'event_id', 'student_user_id'])
    .execute();

  // ── 3. Proctor duty assignments ──
  await db.schema
    .createTable('proctor_duty_assignments')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('exam_schedule_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('period_id', 'integer', (col) =>
      col.references('exam_periods.id').onDelete('set null')
    )
    .addColumn('room_id', 'integer', (col) =>
      col.references('exam_rooms.id').onDelete('set null')
    )
    .addColumn('proctor_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('assigned'))
    // assigned | acknowledged | replaced
    .addColumn('acknowledged_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_proctor_duty_run')
    .on('proctor_duty_assignments')
    .columns(['tenant_id', 'run_id', 'period_id'])
    .execute();

  // No same proctor in the same period (hard clash guard)
  await db.schema
    .createIndex('uq_proctor_duty_period', { unique: true })
    .on('proctor_duty_assignments')
    .columns(['tenant_id', 'run_id', 'period_id', 'proctor_user_id'])
    .execute();

  // One duty row per room per period (room double-book guard)
  await db.schema
    .createIndex('uq_proctor_duty_room', { unique: true })
    .on('proctor_duty_assignments')
    .columns(['tenant_id', 'run_id', 'period_id', 'room_id'])
    .execute();

  // ── 4. Offline check-in journal ──
  await db.schema
    .createTable('checkin_journal')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('device_id', 'varchar(120)', (col) => col.notNull())
    .addColumn('client_seq', 'integer', (col) => col.notNull())
    .addColumn('event_type', 'varchar(40)', (col) => col.notNull())
    // checkin | ack_ticket | reseat
    .addColumn('payload', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('acked_seq', 'integer', (col) => col.notNull().defaultTo(0))
    // high-water mark of contiguous applied seqs
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('pending'))
    // pending | applied | rejected
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  // UNIQUE (tenant, device, client_seq) — offline replay idempotency:
  // duplicate client_seq inserts must FAIL so applyCheckinJournal can skip
  // them instead of re-applying events (Prompt 40 §13/§16 idempotency).
  await db.schema
    .createIndex('uq_checkin_journal_device_seq', { unique: true })
    .on('checkin_journal')
    .columns(['tenant_id', 'device_id', 'client_seq'])
    .execute();

  // ── 5. Hall ticket acknowledgements ──
  await db.schema
    .createTable('hall_ticket_acks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('student_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('seat_assignment_id', 'integer', (col) =>
      col.references('exam_seat_assignments.id').onDelete('cascade').notNull()
    )
    .addColumn('seat_map_version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('acked_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_hall_ticket_acks_student')
    .on('hall_ticket_acks')
    .columns(['tenant_id', 'student_user_id', 'seat_assignment_id'])
    .execute();

  // ── 6. Reseat / replacement audit ──
  await db.schema
    .createTable('reseat_audit')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('run_id', 'integer', (col) =>
      col.references('exam_schedule_runs.id').onDelete('cascade').notNull()
    )
    .addColumn('student_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('cascade').notNull()
    )
    .addColumn('from_seat_assignment_id', 'integer')
    .addColumn('to_seat_assignment_id', 'integer')
    .addColumn('reason', 'varchar(200)')
    // non-sensitive: 'no_show', 'accessibility', 'disruption', 'replacement'
    .addColumn('actor_user_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_reseat_audit_run')
    .on('reseat_audit')
    .columns(['tenant_id', 'run_id', 'student_user_id'])
    .execute();
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('reseat_audit').execute();
  await db.schema.dropTable('hall_ticket_acks').execute();
  await db.schema.dropTable('checkin_journal').execute();
  await db.schema.dropTable('proctor_duty_assignments').execute();
  await db.schema.dropTable('exam_seat_assignments').execute();
  await db.schema.dropTable('room_seat_maps').execute();
}
