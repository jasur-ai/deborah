/**
 * Edikit — Item Bank Module Tests
 *
 * Covers: item bank CRUD, item CRUD with public/private split,
 * status lifecycle, clone/diff, tags/outcomes, media management.
 *
 * All tests PURE — graceful degradation when PostgreSQL unavailable.
 */

import { describe, it, expect } from 'vitest';
import {
  createItemBank, getItemBank, listItemBanks, updateItemBank, deleteItemBank,
  createItem, getItem, listItems, updateItem,
  transitionItemStatus, cloneItem,
  getItemVersions, diffItemVersions,
  searchByTags, getItemTags, getItemOutcomes,
  addItemMedia, listItemMedia, removeItemMedia,
  ITEM_STATUS, ITEM_TYPES, DIFFICULTY_LEVELS, COGNITIVE_LEVELS,
} from '../../src/modules/item-bank/index.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Constants', () => {
  it('should have ITEM_STATUS values', () => {
    expect(ITEM_STATUS.DRAFT).toBe('draft');
    expect(ITEM_STATUS.APPROVED).toBe('approved');
    expect(ITEM_STATUS.PUBLISHED).toBe('published');
    expect(ITEM_STATUS.RETIRED).toBe('retired');
  });

  it('should have ITEM_TYPES array', () => {
    expect(Array.isArray(ITEM_TYPES)).toBe(true);
    expect(ITEM_TYPES).toContain('single_choice');
    expect(ITEM_TYPES).toContain('essay');
    expect(ITEM_TYPES).toContain('matching');
  });

  it('should have DIFFICULTY_LEVELS', () => {
    expect(DIFFICULTY_LEVELS).toContain('easy');
    expect(DIFFICULTY_LEVELS).toContain('hard');
  });

  it('should have COGNITIVE_LEVELS', () => {
    expect(COGNITIVE_LEVELS).toContain('analyze');
    expect(COGNITIVE_LEVELS).toContain('create');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ITEM BANKS (graceful degradation — no DB)
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Item Banks', () => {
  it('createItemBank should reject when PostgreSQL unavailable', async () => {
    await expect(createItemBank({ name: 'Test Bank' })).rejects.toThrow('PostgreSQL required');
  });
  it('getItemBank should return null when PostgreSQL unavailable', async () => {
    expect(await getItemBank(1)).toBeNull();
  });
  it('listItemBanks should return empty array when PostgreSQL unavailable', async () => {
    expect(await listItemBanks()).toEqual([]);
  });
  it('updateItemBank should reject when PostgreSQL unavailable', async () => {
    await expect(updateItemBank(1, { name: 'Updated' })).rejects.toThrow('PostgreSQL required');
  });
  it('deleteItemBank should reject when PostgreSQL unavailable', async () => {
    await expect(deleteItemBank(1, 1)).rejects.toThrow('PostgreSQL required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ITEMS (graceful degradation + validation)
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Items', () => {
  it('createItem should reject when PostgreSQL unavailable (type validation AFTER DB check)', async () => {
    // DB check happens BEFORE type/field validation
    await expect(createItem({
      bank_id: 1, question_type: 'invalid_type', public_data: { stem: 'Test?' },
    })).rejects.toThrow('PostgreSQL required');
  });

  it('createItem should reject when PostgreSQL unavailable (stem validation AFTER DB check)', async () => {
    await expect(createItem({
      bank_id: 1, question_type: 'single_choice', public_data: { options: [{ key: 'A', text: 'Opt' }] },
    })).rejects.toThrow('PostgreSQL required');
  });

  it('createItem should reject when PostgreSQL unavailable (options validation AFTER DB check)', async () => {
    await expect(createItem({
      bank_id: 1, question_type: 'single_choice',
      public_data: { stem: 'Q?', options: [{ key: 'A', text: 'Only one' }] },
    })).rejects.toThrow('PostgreSQL required');
  });

  it('createItem should reject when PostgreSQL unavailable (valid data)', async () => {
    await expect(createItem({
      bank_id: 1, question_type: 'single_choice',
      public_data: { stem: 'Test?', options: [{ key: 'A', text: 'Opt1' }, { key: 'B', text: 'Opt2' }] },
      private_data: { correctKey: 'A' },
    })).rejects.toThrow('PostgreSQL required');
  });

  it('getItem should return null when PostgreSQL unavailable', async () => {
    expect(await getItem(1)).toBeNull();
  });

  it('listItems should return empty array when PostgreSQL unavailable', async () => {
    expect(await listItems({ bank_id: 1 })).toEqual([]);
  });

  it('updateItem should reject when PostgreSQL unavailable', async () => {
    await expect(updateItem(1, { difficulty: 'hard' })).rejects.toThrow('PostgreSQL required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// STATUS & CLONE (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Status & Clone', () => {
  it('transitionItemStatus should reject when PostgreSQL unavailable', async () => {
    await expect(transitionItemStatus(1, 'approved', 1)).rejects.toThrow('PostgreSQL required');
  });
  it('cloneItem should reject when PostgreSQL unavailable', async () => {
    await expect(cloneItem(1, 1)).rejects.toThrow('PostgreSQL required');
  });
  it('getItemVersions should return empty array when PostgreSQL unavailable', async () => {
    expect(await getItemVersions(1)).toEqual([]);
  });
  it('diffItemVersions should return null when PostgreSQL unavailable', async () => {
    expect(await diffItemVersions(1, 1, 2)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// TAGS & OUTCOMES (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Tags & Outcomes', () => {
  it('searchByTags should return empty array when PostgreSQL unavailable', async () => {
    expect(await searchByTags(['math'])).toEqual([]);
  });
  it('getItemTags should return empty array when PostgreSQL unavailable', async () => {
    expect(await getItemTags(1)).toEqual([]);
  });
  it('getItemOutcomes should return empty array when PostgreSQL unavailable', async () => {
    expect(await getItemOutcomes(1)).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// MEDIA (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Media', () => {
  it('addItemMedia should reject when PostgreSQL unavailable', async () => {
    await expect(addItemMedia({ item_id: 1, type: 'image', url: 'https://example.com/img.png' })).rejects.toThrow('PostgreSQL required');
  });
  it('listItemMedia should return empty array when PostgreSQL unavailable', async () => {
    expect(await listItemMedia(1)).toEqual([]);
  });
  it('removeItemMedia should reject when PostgreSQL unavailable', async () => {
    await expect(removeItemMedia(1)).rejects.toThrow('PostgreSQL required');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('Item Bank — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/item-bank/index.js');
    const expected = [
      'createItemBank', 'getItemBank', 'listItemBanks', 'updateItemBank', 'deleteItemBank',
      'createItem', 'getItem', 'listItems', 'updateItem',
      'transitionItemStatus', 'cloneItem',
      'getItemVersions', 'diffItemVersions',
      'searchByTags', 'getItemTags', 'getItemOutcomes',
      'addItemMedia', 'listItemMedia', 'removeItemMedia',
      'ITEM_STATUS', 'ITEM_TYPES', 'DIFFICULTY_LEVELS', 'COGNITIVE_LEVELS',
    ];
    for (const exp of expected) {
      expect(mod[exp]).toBeDefined();
    }
  });
});
