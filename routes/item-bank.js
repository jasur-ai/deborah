/**
 * Edikit — Item Bank API Routes
 *
 * REST API for reusable question bank with public/private versioning:
 *   - Item bank CRUD
 *   - Item CRUD (public/private split)
 *   - Status lifecycle transitions
 *   - Clone and version diff
 *   - Tags, outcomes, and media management
 */

import { Router } from 'express';
import {
  createItemBank, getItemBank, listItemBanks, updateItemBank, deleteItemBank,
  createItem, getItem, listItems, updateItem,
  transitionItemStatus, cloneItem,
  getItemVersions, diffItemVersions,
  searchByTags, getItemTags, getItemOutcomes,
  addItemMedia, listItemMedia, removeItemMedia,
} from '../src/modules/item-bank/index.js';

const router = Router();

// ═══════════════════════════════════════════════════════════════════
// ITEM BANKS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/item-banks', async (req, res) => {
  try {
    const result = await createItemBank({ ...req.body, owner_id: req.session?.user?.id || req.session?.admin?.id });
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/item-banks', async (req, res) => {
  try {
    const banks = await listItemBanks({
      subject_area: req.query.subject_area,
      is_public: req.query.is_public !== undefined ? req.query.is_public === 'true' : undefined,
      limit: parseInt(req.query.limit || '50'), offset: parseInt(req.query.offset || '0'),
    });
    res.json(banks);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/item-banks/:id', async (req, res) => {
  try {
    const bank = await getItemBank(parseInt(req.params.id));
    if (!bank) return res.status(404).json({ error: 'Item bank not found' });
    res.json(bank);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/api/item-banks/:id', async (req, res) => {
  try {
    const result = await updateItemBank(parseInt(req.params.id), { ...req.body, updated_by: req.session?.user?.id });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/api/item-banks/:id', async (req, res) => {
  try {
    const result = await deleteItemBank(parseInt(req.params.id), req.session?.user?.id || req.session?.admin?.id);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// ITEMS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/items', async (req, res) => {
  try {
    const result = await createItem({ ...req.body, created_by: req.session?.user?.id || req.session?.admin?.id });
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/items', async (req, res) => {
  try {
    const items = await listItems({
      bank_id: req.query.bank_id ? parseInt(req.query.bank_id) : undefined,
      status: req.query.status,
      question_type: req.query.question_type,
      difficulty: req.query.difficulty,
      limit: parseInt(req.query.limit || '50'), offset: parseInt(req.query.offset || '0'),
    });
    res.json(items);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// Single item with ALL data (including private) — restricted
router.get('/api/items/:id', async (req, res) => {
  try {
    const item = await getItem(parseInt(req.params.id));
    if (!item) return res.status(404).json({ error: 'Item not found' });
    res.json(item);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/api/items/:id', async (req, res) => {
  try {
    const result = await updateItem(parseInt(req.params.id), {
      ...req.body, updated_by: req.session?.user?.id || req.session?.admin?.id,
    });
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// STATUS TRANSITIONS
// ═══════════════════════════════════════════════════════════════════

router.post('/api/items/:id/transition', async (req, res) => {
  try {
    const result = await transitionItemStatus(
      parseInt(req.params.id), req.body.status,
      req.session?.user?.id || req.session?.admin?.id
    );
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post('/api/items/:id/clone', async (req, res) => {
  try {
    const result = await cloneItem(parseInt(req.params.id), req.session?.user?.id || req.session?.admin?.id);
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// VERSIONS & DIFF
// ═══════════════════════════════════════════════════════════════════

router.get('/api/items/:id/versions', async (req, res) => {
  try {
    const versions = await getItemVersions(parseInt(req.params.id));
    res.json(versions);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/items/:id/diff', async (req, res) => {
  try {
    const versionA = parseInt(req.query.from);
    const versionB = parseInt(req.query.to);
    if (!versionA || !versionB) return res.status(400).json({ error: 'from and to query params required' });
    const diff = await diffItemVersions(parseInt(req.params.id), versionA, versionB);
    res.json(diff);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// TAGS & OUTCOMES
// ═══════════════════════════════════════════════════════════════════

router.get('/api/items/:id/tags', async (req, res) => {
  try {
    const tags = await getItemTags(parseInt(req.params.id));
    res.json(tags);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/items/:id/outcomes', async (req, res) => {
  try {
    const outcomes = await getItemOutcomes(parseInt(req.params.id));
    res.json(outcomes);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/items/search/tags', async (req, res) => {
  try {
    const tags = req.query.tags ? req.query.tags.split(',') : [];
    if (tags.length === 0) return res.status(400).json({ error: 'tags query param required (comma-separated)' });
    const items = await searchByTags(tags, {
      limit: parseInt(req.query.limit || '50'), offset: parseInt(req.query.offset || '0'),
    });
    res.json(items);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════
// MEDIA
// ═══════════════════════════════════════════════════════════════════

router.post('/api/items/media', async (req, res) => {
  try {
    const result = await addItemMedia(req.body);
    res.status(201).json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.get('/api/items/:id/media', async (req, res) => {
  try {
    const media = await listItemMedia(parseInt(req.params.id));
    res.json(media);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/api/items/media/:id', async (req, res) => {
  try {
    const result = await removeItemMedia(parseInt(req.params.id));
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

export default router;
