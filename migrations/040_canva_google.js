/**
 * Deborah — Migration 040: Canva, Google Slides, Export va Quiz-from-Deck
 *
 * Prompt 59 — Canva modal/OAuth va Google Slides minimum-scope
 * integratsiyasini canonical deck bilan yopish (research.md §9.8 Canva
 * Button/Connect, §9.9 Google Slides drive.file scope, §10 quiz-from-deck
 * flow, §22.8 Google token boshqa provider'ga uzatilmaydi, §22.10 Canva
 * editorini ruxsatsiz iframe qilish yo'q, §22.18 AI savol teacher
 * approval'siz bankka publish qilinmaydi). Precondition: Prompt 56
 * canonical deck + Prompt 12 account framework tayyor.
 *
 *   - canva_connections: Canva Connect OAuth (PKCE) token vault —
 *     refresh_token va access_token ENCRYPTED (AES-256-GCM, key env'da);
 *     design_id, scope (faqat design:create:edit, design:content:read,
 *     design:export — full account scope YO'Q), callback mapping.
 *   - google_connections: Google Slides OAuth token vault — scope faqat
 *     'drive.file' (minimum scope; full Drive restricted scope default
 *     olinmaydi — research §9.9), presentation_id, drive_file_id,
 *     refresh/access token encrypted.
 *   - deck_exports: final PPTX/PDF/handout export — canonical version
 *     snapshot, storage_key (object storage), attribution, accessibility
 *     checks (alt text, contrast), status queued|done|failed.
 *   - deck_quiz_jobs: "Create quiz from this deck" — quizConcepts/source
 *     pack asosida 50/30/20 blueprint, har savolda source citation,
 *     teacher approval (reviewed), needs_review flag (claim o'zgarsa).
 *
 * SECURITY / DATA GUARD (Prompt 59 §15-17):
 *   - Google login token boshqa provider'ga (Canva/Gamma/Manus) berilmaydi.
 *   - Canva/Google tokenlar DB'da ENCRYPTED saqlanadi (vault).
 *   - Har bir write path tenant-scoped + idempotent.
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. canva_connections — Canva Connect PKCE token vault ──
  await db.schema
    .createTable('canva_connections')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('design_id', 'varchar(120)')
    // Canva design ID (Button publish callback / Connect create)
    .addColumn('access_token_enc', 'text')
    .addColumn('refresh_token_enc', 'text')
    .addColumn('token_expires_at', 'timestamp')
    .addColumn('scope', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // faqat design:create:edit, design:content:read, design:export
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    .addColumn('last_callback', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { onDesignOpen, onDesignPublish, designUrl, editUrl }
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('canva_connections_tenant_user', ['tenant_id', 'user_id']);

  // ── 2. google_connections — Google Slides drive.file token vault ──
  await db.schema
    .createTable('google_connections')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('user_id', 'integer', (col) => col.references('users.id').onDelete('cascade').notNull())
    .addColumn('google_email', 'varchar(200)')
    .addColumn('access_token_enc', 'text')
    .addColumn('refresh_token_enc', 'text')
    .addColumn('token_expires_at', 'timestamp')
    .addColumn('scope', 'varchar(300)', (col) => col.notNull().defaultTo('https://www.googleapis.com/auth/drive.file'))
    // Minimum scope — faqat drive.file (research §9.9)
    .addColumn('drive_file_id', 'varchar(120)')
    .addColumn('presentation_id', 'varchar(120)')
    // Google Slides presentation ID
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('active'))
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('google_connections_tenant_user', ['tenant_id', 'user_id']);

  // ── 3. deck_exports — final PPTX/PDF/handout with attribution ──
  await db.schema
    .createTable('deck_exports')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('presentation_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('request_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('format', 'varchar(20)', (col) => col.notNull())
    // pptx | pdf | handout
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('queued'))
    .addColumn('storage_key', 'varchar(300)')
    .addColumn('attribution', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { provider, aiAssisted, disclosure, sourceLicenses, humanReviewedAt }
    .addColumn('accessibility', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { altTextCount, missingAlt, contrastFailures, handoutNotes }
    .addColumn('error', 'text')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('deck_exports_tenant_hash', ['tenant_id', 'request_hash']);

  // ── 4. deck_quiz_jobs — "Create quiz from this deck" (50/30/20) ──
  await db.schema
    .createTable('deck_quiz_jobs')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('presentation_id', 'integer', (col) =>
      col.references('presentations.id').onDelete('cascade').notNull()
    )
    .addColumn('version_id', 'integer', (col) =>
      col.references('presentation_versions.id').onDelete('cascade').notNull()
    )
    .addColumn('request_hash', 'varchar(64)', (col) => col.notNull())
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | needs_review | approved | published
    .addColumn('blueprint', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    // { easy, medium, hard, total, distribution }
    .addColumn('questions', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // [{ stem, options, correctIndex, difficulty, sourcePackId, slideId, outcome }]
    .addColumn('item_ids', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // Published item bank item IDs (teacher approval'dan keyin)
    .addColumn('needs_review', 'jsonb', (col) => col.defaultTo(sql`'[]'::jsonb`))
    // Slide claims o'zgarsa related question id'lari
    .addColumn('teacher_reviewed_at', 'timestamp')
    .addColumn('teacher_reviewed_by', 'varchar(120)')
    .addColumn('created_by', 'varchar(120)')
    .addColumn('created_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('updated_at', 'timestamp', (col) => col.notNull().defaultTo(sql`now()`))
    .addUniqueConstraint('deck_quiz_tenant_hash', ['tenant_id', 'request_hash']);
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('deck_quiz_jobs');
  await db.schema.dropTable('deck_exports');
  await db.schema.dropTable('google_connections');
  await db.schema.dropTable('canva_connections');
}
