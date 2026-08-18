/**
 * Deborah — Item Bank Module Barrel Export
 *
 * Provides reusable, versioned question items with public/private separation:
 *   - Item Banks (logical collections)
 *   - Items (public stem/options + private scoring key)
 *   - Version lifecycle (DRAFT→APPROVED→PUBLISHED→RETIRED)
 *   - Tags and Outcome mapping
 *   - Media attachments with alt text and license
 *   - Clone, version diff, and search by tags
 *
 * Usage:
 *   import * as itemBank from '../modules/item-bank/index.js';
 *   // Or:
 *   import { createItem, listItems } from '../modules/item-bank/index.js';
 */

export {
  // Item Banks
  createItemBank, getItemBank, listItemBanks, updateItemBank, deleteItemBank,

  // Items
  createItem, getItem, listItems, updateItem,
  transitionItemStatus, cloneItem,

  // Versions
  getItemVersions, diffItemVersions,

  // Tags & Outcomes
  searchByTags, getItemTags, getItemOutcomes,

  // Media
  addItemMedia, listItemMedia, removeItemMedia,

  // Constants
  ITEM_STATUS, ITEM_TYPES, DIFFICULTY_LEVELS, COGNITIVE_LEVELS,
} from './item-bank.service.js';
