/**
 * Edikit — Migration 006: Item Bank (Public/Private Versioning)
 *
 * Adds versioned question/item bank support:
 *   - item_banks: logical collections (e.g., "Algebra - 9-sinf")
 *   - items: individual questions with public/private separation
 *   - item_versions: DRAFT→APPROVED→PUBLISHED→RETIRED lifecycle
 *   - item_tags: searchable tags/keywords
 *   - item_outcomes: competency/outcome mappings
 *   - item_media: media attachments with alt text and license info
 *
 * Key design:
 *   - PUBLIC content (stem, options) stored in items.public_data
 *   - PRIVATE scoring key stored in items.private_data (DB-restricted)
 *   - Version history tracks all changes
 *   - Outcome/competency mapping links to Prompt 20 competency framework
 *
 * Rollback: All tables droppable via down().
 */

import { sql } from 'kysely';

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function up(db) {
  // ── 1. Item Banks (logical question collections) ──
  await db.schema
    .createTable('item_banks')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('name', 'varchar(255)', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('subject_area', 'varchar(100)')
    .addColumn('education_level', 'varchar(50)')
    .addColumn('language', 'varchar(10)', (col) => col.notNull().defaultTo('uz'))
    .addColumn('is_public', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('owner_id', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_item_banks_tenant')
    .on('item_banks')
    .columns(['tenant_id'])
    .execute();

  // ── 2. Items (questions with public/private split) ──
  await db.schema
    .createTable('items')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('bank_id', 'integer', (col) =>
      col.references('item_banks.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('status', 'varchar(20)', (col) => col.notNull().defaultTo('draft'))
    // draft | approved | published | retired
    .addColumn('question_type', 'varchar(30)', (col) => col.notNull())
    // single_choice | multiple_choice | true_false | short_answer | essay |
    // numeric | matching | ordering | fill_blanks | file_upload
    .addColumn('difficulty', 'varchar(10)', (col) => col.defaultTo('medium'))
    // easy | medium | hard
    .addColumn('cognitive_level', 'varchar(20)')
    // remember | understand | apply | analyze | evaluate | create
    .addColumn('points', 'numeric(6,2)', (col) => col.notNull().defaultTo(1))
    .addColumn('time_seconds', 'integer') // Recommended time to answer
    .addColumn('public_data', 'jsonb', (col) => col.notNull())
    // PUBLIC: { stem: "question text", options: [{key, text}], stimulus, mediaRefs }
    .addColumn('private_data', 'jsonb')
    // PRIVATE (DB-restricted): { correctKey, scoringRubric, explanation, distractorRationale }
    .addColumn('version', 'integer', (col) => col.notNull().defaultTo(1))
    .addColumn('source', 'varchar(30)', (col) => col.defaultTo('manual'))
    // manual | ai_generated | imported | cloned | legacy_migration
    .addColumn('source_item_id', 'integer') // Original item if cloned/migrated
    .addColumn('misconceptions', 'jsonb', (col) => col.defaultTo('[]'))
    // [{ optionKey: "B", misconception: "Common error...", conceptId: 123 }]
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('created_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .addColumn('updated_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_items_bank')
    .on('items')
    .columns(['bank_id', 'status'])
    .execute();

  await db.schema
    .createIndex('idx_items_tenant')
    .on('items')
    .columns(['tenant_id', 'question_type'])
    .execute();

  // ── 3. Item Versions (change history) ──
  await db.schema
    .createTable('item_versions')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('cascade').notNull()
    )
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('version', 'integer', (col) => col.notNull())
    .addColumn('previous_status', 'varchar(20)')
    .addColumn('new_status', 'varchar(20)')
    .addColumn('public_data_snapshot', 'jsonb')
    .addColumn('private_data_snapshot', 'jsonb')
    .addColumn('change_summary', 'text')
    .addColumn('changed_by', 'integer', (col) =>
      col.references('users.id').onDelete('set null')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_item_versions_item')
    .on('item_versions')
    .columns(['item_id', 'version'])
    .execute();

  // ── 4. Item Tags ──
  await db.schema
    .createTable('item_tags')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('cascade').notNull()
    )
    .addColumn('tag', 'varchar(100)', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_item_tags_unique
    ON item_tags (item_id, tag)
  `.execute(db);

  await db.schema
    .createIndex('idx_item_tags_search')
    .on('item_tags')
    .columns(['tag'])
    .execute();

  // ── 5. Item Outcomes (competency mapping) ──
  await db.schema
    .createTable('item_outcomes')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('cascade').notNull()
    )
    .addColumn('competency_id', 'integer', (col) =>
      col.references('competencies.id').onDelete('cascade')
    )
    .addColumn('outcome_code', 'varchar(100)') // Direct code if no competency FK
    .addColumn('weight', 'numeric(3,2)', (col) => col.notNull().defaultTo(1.00))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await sql`
    CREATE UNIQUE INDEX idx_item_outcomes_unique
    ON item_outcomes (item_id, competency_id)
  `.execute(db);

  // ── 6. Item Media ──
  await db.schema
    .createTable('item_media')
    .addColumn('id', 'serial', (col) => col.primaryKey())
    .addColumn('tenant_id', 'integer', (col) =>
      col.references('tenants.id').onDelete('cascade').notNull()
    )
    .addColumn('item_id', 'integer', (col) =>
      col.references('items.id').onDelete('cascade').notNull()
    )
    .addColumn('type', 'varchar(20)', (col) => col.notNull())
    // image | audio | video | document | formula
    .addColumn('url', 'text', (col) => col.notNull())
    .addColumn('alt_text', 'varchar(500)') // Accessibility — required for images
    .addColumn('mime_type', 'varchar(100)')
    .addColumn('file_size', 'integer')
    .addColumn('width', 'integer')
    .addColumn('height', 'integer')
    .addColumn('duration_seconds', 'integer')
    .addColumn('license', 'varchar(50)') // CC-BY, CC-BY-NC, proprietary, fair_use
    .addColumn('attribution', 'text') // Author/source attribution
    .addColumn('metadata', 'jsonb', (col) => col.defaultTo('{}'))
    .addColumn('sort_order', 'integer', (col) => col.defaultTo(0))
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(db.fn.now()))
    .execute();

  await db.schema
    .createIndex('idx_item_media_item')
    .on('item_media')
    .columns(['item_id'])
    .execute();

  // ── Grant permissions ──
  const newTables = [
    'item_banks', 'items', 'item_versions',
    'item_tags', 'item_outcomes', 'item_media',
  ];

  for (const table of newTables) {
    await sql`GRANT SELECT, INSERT, UPDATE ON ${sql.table(table)} TO edikit_runtime`.execute(db);
    await sql`GRANT USAGE ON ${sql.table(table)}_id_seq TO edikit_runtime`.execute(db);
    await sql`GRANT DELETE ON ${sql.table(table)} TO edikit_migration`.execute(db);
    await sql`GRANT SELECT ON ${sql.table(table)} TO edikit_scoring`.execute(db);
  }

  // Restrict private_data access to scoring role
  await sql`
    GRANT SELECT (private_data) ON items TO edikit_scoring
  `.execute(db);

  console.log('Item bank structure created: 6 tables');
}

/**
 * @param {import('kysely').Kysely<any>} db
 */
export async function down(db) {
  await db.schema.dropTable('item_media').ifExists().execute();
  await db.schema.dropTable('item_outcomes').ifExists().execute();
  await db.schema.dropTable('item_tags').ifExists().execute();
  await db.schema.dropTable('item_versions').ifExists().execute();
  await db.schema.dropTable('items').ifExists().execute();
  await db.schema.dropTable('item_banks').ifExists().execute();
}
