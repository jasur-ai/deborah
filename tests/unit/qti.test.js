/**
 * Deborah — QTI Module Tests
 *
 * Covers: security validation, parser/mapping, staging service, export, barrel export.
 * All tests PURE — graceful degradation when PostgreSQL unavailable.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import {
  // Security
  validateQtiExtension,
  validateQtiMimeType,
  validateQtiMagicBytes,
  validateQtiFileSize,
  validateQtiZipRatio,
  validateNoPathTraversal,
  validateXmlForXxe,
  validateManifestIntegrity,
  computeQtiFileHash,
  validateQtiPackage,
  QTI_CONFIG,
  QtiValidationResult,
} from '../../src/modules/qti/qti-security.js';

import {
  // Parser
  safeParseXml,
  detectInteractionType,
  detectMultipleInteractions,
  mapInteractionToCanonical,
  generateUnsupportedReport,
  extractPrompt,
  extractCorrectAnswers,
  stripXmlTags,
  QTI_INTERACTIONS,
} from '../../src/modules/qti/qti-parser.js';

import {
  // Staging
  createQtiPackage,
  updateQtiPackage,
  getQtiPackage,
  listQtiPackages,
  deleteQtiPackage,
  createStagingItems,
  getStagingItems,
  getStagingItem,
  updateStagingItemReview,
  batchUpdateStagingReviews,
  commitQtiStaging,
  generateStagingReport,
  findExistingPackageByHash,
  STAGING_STATUS,
  PACKAGE_STATUS,
} from '../../src/modules/qti/qti-staging.js';

import {
  // Export
  exportItemToQti,
  exportAssessmentToQti,
  generateManifest,
} from '../../src/modules/qti/qti-export.js';

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

describe('QTI — Constants', () => {
  it('should have extension allowlist', () => {
    expect(QTI_CONFIG.allowedExtensions).toContain('.zip');
    expect(QTI_CONFIG.allowedExtensions).toContain('.qti');
  });

  it('should have QTI_INTERACTIONS definitions', () => {
    expect(QTI_INTERACTIONS.choiceInteraction).toBeDefined();
    expect(QTI_INTERACTIONS.choiceInteraction.canonicalType).toContain('single_choice');
    expect(QTI_INTERACTIONS.drawingInteraction.unsupported).toBe(true);
    expect(QTI_INTERACTIONS.uploadInteraction.canonicalType).toBe('file_upload');
  });

  it('should have STAGING_STATUS values', () => {
    expect(STAGING_STATUS.PENDING).toBe('pending');
    expect(STAGING_STATUS.APPROVED).toBe('approved');
    expect(STAGING_STATUS.REJECTED).toBe('rejected');
  });

  it('should have PACKAGE_STATUS values', () => {
    expect(PACKAGE_STATUS.UPLOADED).toBe('uploaded');
    expect(PACKAGE_STATUS.COMMITTED).toBe('committed');
    expect(PACKAGE_STATUS.FAILED).toBe('failed');
  });
});

// ═══════════════════════════════════════════════════════════════════
// SECURITY VALIDATION
// ═══════════════════════════════════════════════════════════════════

describe('QTI — Security Validation', () => {
  it('validateQtiExtension should accept .zip', () => {
    const r = validateQtiExtension('package.zip');
    expect(r.ok).toBe(true);
    expect(r.details.extension).toBe('.zip');
  });

  it('validateQtiExtension should accept .qti', () => {
    const r = validateQtiExtension('test.qti');
    expect(r.ok).toBe(true);
    expect(r.details.extension).toBe('.qti');
  });

  it('validateQtiExtension should reject invalid extensions', () => {
    const r = validateQtiExtension('bad.exe');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('Invalid extension');
  });

  it('validateQtiExtension should reject empty filename', () => {
    const r = validateQtiExtension('');
    expect(r.ok).toBe(false);
  });

  it('validateQtiMimeType should accept application/zip', () => {
    const r = validateQtiMimeType('application/zip');
    expect(r.ok).toBe(true);
  });

  it('validateQtiMimeType should reject invalid MIME', () => {
    const r = validateQtiMimeType('application/xml');
    expect(r.ok).toBe(false);
  });

  it('validateXmlForXxe should detect DOCTYPE with SYSTEM', () => {
    const r = validateXmlForXxe('<!DOCTYPE foo SYSTEM "http://evil.com">');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('XXE');
  });

  it('validateXmlForXxe should warn on DOCTYPE without SYSTEM', () => {
    const r = validateXmlForXxe('<!DOCTYPE foo [<!ELEMENT foo (#PCDATA)>]>');
    expect(r.ok).toBe(true);
    expect(r.details.xxeWarnings.length).toBeGreaterThan(0);
  });

  it('validateXmlForXxe should pass on clean XML', () => {
    const r = validateXmlForXxe('<assessmentItem><responseDeclaration/></assessmentItem>');
    expect(r.ok).toBe(true);
  });

  it('validateXmlForXxe should handle null input', () => {
    const r = validateXmlForXxe(null);
    expect(r.ok).toBe(true);
  });

  it('validateManifestIntegrity should require imsmanifest namespace', () => {
    const r = validateManifestIntegrity(['item1.xml'], '<random>content</random>');
    expect(r.ok).toBe(true);
    expect(r.details.itemReferences).toBe(0);
  });

  it('validateManifestIntegrity should detect QTI manifest', () => {
    const r = validateManifestIntegrity(
      ['item1.xml'],
      '<manifest xmlns:imsqti="http://www.imsglobal.org/xsd/imsqti_v2p2"><resources>...</resources></manifest>'
    );
    expect(r.ok).toBe(true);
  });

  it('computeQtiFileHash should return SHA-256 hash', () => {
    // Write a temp file
    const tmpFile = path.join(os.tmpdir(), 'qti-test-hash-' + Date.now() + '.zip');
    fs.writeFileSync(tmpFile, 'test content');
    const hash = computeQtiFileHash(tmpFile);
    expect(hash).toBeTruthy();
    expect(hash.length).toBe(64); // SHA-256 hex
    fs.unlinkSync(tmpFile);
  });

  it('validateQtiPackage full pipeline should fail on missing file', async () => {
    const r = await validateQtiPackage('/nonexistent/file.zip', 'test.zip', 'application/zip');
    expect(r.ok).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PARSER & MAPPING
// ═══════════════════════════════════════════════════════════════════

describe('QTI — Parser & Mapping', () => {
  it('stripXmlTags should remove tags', () => {
    expect(stripXmlTags('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('stripXmlTags should decode XML entities', () => {
    expect(stripXmlTags('a &amp; b &lt; c')).toBe('a & b < c');
  });

  it('stripXmlTags should handle empty input', () => {
    expect(stripXmlTags('')).toBe('');
    expect(stripXmlTags(null)).toBe('');
  });

  it('detectInteractionType should find choiceInteraction', () => {
    const xml = '<choiceInteraction responseIdentifier="RESPONSE" maxChoices="1"><simpleChoice identifier="A">Yes</simpleChoice></choiceInteraction>';
    expect(detectInteractionType(xml)).toBe('choiceInteraction');
  });

  it('detectInteractionType should find textEntryInteraction', () => {
    const xml = '<textEntryInteraction responseIdentifier="RESPONSE"/>';
    expect(detectInteractionType(xml)).toBe('textEntryInteraction');
  });

  it('detectInteractionType should return null on no match', () => {
    expect(detectInteractionType('<br/>')).toBeNull();
  });

  it('detectInteractionType should handle empty input', () => {
    expect(detectInteractionType(null)).toBeNull();
    expect(detectInteractionType('')).toBeNull();
  });

  it('extractPrompt should find <prompt> element', () => {
    const xml = '<itemBody><prompt>What is 2+2?</prompt><choiceInteraction/></itemBody>';
    const p = extractPrompt(xml);
    expect(p).toBeTruthy();
    expect(p.text).toContain('What is 2+2?');
  });

  it('extractPrompt should return null on no prompt', () => {
    expect(extractPrompt('<br/>')).toBeNull();
  });

  it('extractCorrectAnswers should find correctResponse values', () => {
    const xml = '<correctResponse><value>A</value><value>C</value></correctResponse>';
    const keys = extractCorrectAnswers(xml);
    expect(keys).toContain('A');
    expect(keys).toContain('C');
    expect(keys.length).toBe(2);
  });

  it('extractCorrectAnswers should return empty on no keys', () => {
    const keys = extractCorrectAnswers('<itemBody>No answer</itemBody>');
    expect(keys).toEqual([]);
  });

  it('mapInteractionToCanonical should map choiceInteraction to single_choice', () => {
    const xml = `<choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <simpleChoice identifier="A">Option A</simpleChoice>
      <simpleChoice identifier="B">Option B</simpleChoice>
    </choiceInteraction>`;
    const m = mapInteractionToCanonical('choiceInteraction', xml);
    expect(m.supported).toBe(true);
    expect(m.canonicalType).toBe('single_choice');
    expect(m.publicData.options.length).toBe(2);
  });

  it('mapInteractionToCanonical should detect multiple_choice with maxChoices>1', () => {
    const xml = `<choiceInteraction responseIdentifier="RESPONSE" maxChoices="2">
      <simpleChoice identifier="A">A</simpleChoice>
      <simpleChoice identifier="B">B</simpleChoice>
    </choiceInteraction>`;
    const m = mapInteractionToCanonical('choiceInteraction', xml);
    expect(m.canonicalType).toBe('multiple_choice');
  });

  it('mapInteractionToCanonical should map textEntryInteraction', () => {
    const m = mapInteractionToCanonical('textEntryInteraction', '<textEntryInteraction/>');
    expect(m.supported).toBe(true);
    expect(m.canonicalType).toBe('short_answer');
  });

  it('mapInteractionToCanonical should map extendedTextInteraction', () => {
    const m = mapInteractionToCanonical('extendedTextInteraction', '<extendedTextInteraction expectedLength="500"/>');
    expect(m.supported).toBe(true);
    expect(m.canonicalType).toBe('essay');
  });

  it('mapInteractionToCanonical should map uploadInteraction', () => {
    const m = mapInteractionToCanonical('uploadInteraction', '<uploadInteraction/>');
    expect(m.supported).toBe(true);
    expect(m.canonicalType).toBe('file_upload');
  });

  it('mapInteractionToCanonical should return unsupported on drawingInteraction', () => {
    const m = mapInteractionToCanonical('drawingInteraction', '<drawingInteraction/>');
    expect(m.supported).toBe(false);
    expect(m.unsupportedReason).toBeTruthy();
  });

  it('mapInteractionToCanonical should return unsupported on unknown type', () => {
    const m = mapInteractionToCanonical('unknownType', '');
    expect(m.supported).toBe(false);
  });

  it('generateUnsupportedReport should calculate support rate', () => {
    const items = [
      { identifier: 'i1', interactionType: 'choiceInteraction', mapping: { supported: true, canonicalType: 'single_choice' } },
      { identifier: 'i2', interactionType: 'drawingInteraction', mapping: { supported: false, unsupportedReason: 'Not supported' } },
      { identifier: 'i3', interactionType: 'textEntryInteraction', mapping: { supported: true, canonicalType: 'short_answer' } },
    ];
    const report = generateUnsupportedReport(items);
    expect(report.totalItems).toBe(3);
    expect(report.supportedCount).toBe(2);
    expect(report.unsupportedCount).toBe(1);
    expect(report.supportRate).toBe('66.7%');
  });

  it('generateUnsupportedReport should handle empty array', () => {
    const report = generateUnsupportedReport([]);
    expect(report.totalItems).toBe(0);
    expect(report.supportRate).toBe('0%');
  });
});

// ═══════════════════════════════════════════════════════════════════
// STAGING SERVICE (graceful degradation)
// ═══════════════════════════════════════════════════════════════════

describe('QTI — Staging Service', () => {
  it('createQtiPackage should reject when PostgreSQL unavailable', async () => {
    await expect(createQtiPackage({ original_filename: 'test.zip' })).rejects.toThrow('PostgreSQL required');
  });

  it('updateQtiPackage should reject when PostgreSQL unavailable', async () => {
    await expect(updateQtiPackage(1, { status: 'parsed' })).rejects.toThrow('PostgreSQL required');
  });

  it('getQtiPackage should return null when PostgreSQL unavailable', async () => {
    expect(await getQtiPackage(1)).toBeNull();
  });

  it('listQtiPackages should return empty array when PostgreSQL unavailable', async () => {
    expect(await listQtiPackages()).toEqual([]);
  });

  it('deleteQtiPackage should reject when PostgreSQL unavailable', async () => {
    await expect(deleteQtiPackage(1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('createStagingItems should reject when PostgreSQL unavailable', async () => {
    await expect(createStagingItems(1, [])).rejects.toThrow('PostgreSQL required');
  });

  it('getStagingItems should return empty array when PostgreSQL unavailable', async () => {
    expect(await getStagingItems(1)).toEqual([]);
  });

  it('getStagingItem should return null when PostgreSQL unavailable', async () => {
    expect(await getStagingItem(1)).toBeNull();
  });

  it('updateStagingItemReview should reject when PostgreSQL unavailable', async () => {
    await expect(updateStagingItemReview(1, { reviewStatus: 'approved' })).rejects.toThrow('PostgreSQL required');
  });

  it('commitQtiStaging should reject when PostgreSQL unavailable', async () => {
    await expect(commitQtiStaging(1, 1, 1)).rejects.toThrow('PostgreSQL required');
  });

  it('generateStagingReport should return null when PostgreSQL unavailable', async () => {
    expect(await generateStagingReport(1)).toBeNull();
  });

  it('findExistingPackageByHash should return null when PostgreSQL unavailable', async () => {
    expect(await findExistingPackageByHash('abc123')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('QTI — Export', () => {
  it('exportItemToQti should generate valid XML for single_choice', () => {
    const item = {
      id: 1,
      question_type: 'single_choice',
      difficulty: 'medium',
      public_data: {
        stem: { text: 'What is 2+2?' },
        options: [{ key: 'A', text: '3' }, { key: 'B', text: '4' }, { key: 'C', text: '5' }],
      },
      private_data: { correctKeys: ['B'] },
    };
    const xml = exportItemToQti(item, { includePrivateKey: true });
    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('assessmentItem');
    expect(xml).toContain('choiceInteraction');
    expect(xml).toContain('simpleChoice identifier="A"');
    expect(xml).toContain('What is 2+2?');
    expect(xml).toContain('correctResponse');
  });

  it('exportItemToQti should handle true_false', () => {
    const item = {
      id: 2,
      question_type: 'true_false',
      difficulty: 'easy',
      public_data: { stem: { text: 'Earth is flat.' } },
      private_data: { correctKeys: ['false'] },
    };
    const xml = exportItemToQti(item);
    expect(xml).toContain('True');
    expect(xml).toContain('False');
  });

  it('exportItemToQti should handle essay type', () => {
    const item = {
      id: 3,
      question_type: 'essay',
      public_data: { stem: { text: 'Describe photosynthesis.' }, minWords: 50 },
    };
    const xml = exportItemToQti(item);
    expect(xml).toContain('extendedTextInteraction');
    expect(xml).toContain('Describe photosynthesis.');
  });

  it('exportItemToQti should handle matching', () => {
    const item = {
      id: 4,
      question_type: 'matching',
      public_data: {
        stem: { text: 'Match the terms' },
        premiseSet: [{ identifier: 'p1', text: 'H2O' }],
        targetSet: [{ identifier: 't1', text: 'Water' }],
      },
    };
    const xml = exportItemToQti(item);
    expect(xml).toContain('matchInteraction');
    expect(xml).toContain('simpleAssociableChoice');
  });

  it('exportItemToQti should handle ordering', () => {
    const item = {
      id: 5,
      question_type: 'ordering',
      public_data: {
        stem: { text: 'Order the steps' },
        items: [{ key: 'a', text: 'First' }, { key: 'b', text: 'Second' }],
      },
    };
    const xml = exportItemToQti(item);
    expect(xml).toContain('orderInteraction');
  });

  it('exportItemToQti should handle numeric type', () => {
    const item = {
      id: 6,
      question_type: 'numeric',
      public_data: { stem: { text: 'What is pi?' }, sliderRange: { min: 0, max: 10 } },
      private_data: { correctNumericValue: 3.14, tolerance: '0.01' },
    };
    const xml = exportItemToQti(item, { includePrivateKey: true });
    expect(xml).toContain('sliderInteraction');
    expect(xml).toContain('equal tolerance="0.01"');
  });

  it('exportItemToQti should handle fill_blanks', () => {
    const item = {
      id: 7,
      question_type: 'fill_blanks',
      public_data: {
        stem: { text: 'Fill the blank' },
        blankOptions: [{ identifier: 'b1', text: 'hello' }],
      },
    };
    const xml = exportItemToQti(item);
    expect(xml).toContain('inlineChoiceInteraction');
  });

  it('exportItemToQti should NOT include correctResponse without includePrivateKey', () => {
    const item = {
      id: 8,
      question_type: 'single_choice',
      public_data: { stem: { text: 'Q?' }, options: [{ key: 'A', text: 'A' }, { key: 'B', text: 'B' }] },
      private_data: { correctKeys: ['A'] },
    };
    const xml = exportItemToQti(item, { includePrivateKey: false });
    expect(xml).not.toContain('correctResponse');
    expect(xml).toContain('choiceInteraction');
  });

  it('exportAssessmentToQti should generate assessmentTest XML', () => {
    const assessment = {
      id: 1,
      title: 'Math Test',
      sections: [
        { title: 'Algebra', items: [{ id: 1, fileName: 'items/item_1.xml' }] },
        { title: 'Geometry', items: [{ id: 2, fileName: 'items/item_2.xml' }] },
      ],
    };
    const xml = exportAssessmentToQti(assessment);
    expect(xml).toContain('assessmentTest');
    expect(xml).toContain('Algebra');
    expect(xml).toContain('Geometry');
    expect(xml).toContain('assessmentItemRef');
  });

  it('exportAssessmentToQti should handle empty assessment', () => {
    expect(exportAssessmentToQti(null)).toBe('');
  });

  it('generateManifest should produce QTI manifest XML', () => {
    const manifest = {
      identifier: 'test_export',
      title: 'Exported Test',
      items: [{ id: 1, fileName: 'items/item_1.xml' }],
    };
    const xml = generateManifest(manifest);
    expect(xml).toContain('manifest');
    expect(xml).toContain('IMS QTI');
    expect(xml).toContain('resources');
    expect(xml).toContain('items/item_1.xml');
  });

  it('generateManifest should handle null input', () => {
    expect(generateManifest(null)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════════
// BARREL EXPORT
// ═══════════════════════════════════════════════════════════════════

describe('QTI — Barrel Export', () => {
  it('should export all expected functions and constants', async () => {
    const mod = await import('../../src/modules/qti/index.js');
    const expected = [
      // Security
      'validateQtiPackage', 'validateQtiExtension', 'validateQtiMimeType',
      'validateQtiMagicBytes', 'validateQtiFileSize', 'validateQtiZipRatio',
      'validateNoPathTraversal', 'validateXmlForXxe', 'validateManifestIntegrity',
      'computeQtiFileHash', 'QTI_CONFIG', 'QtiValidationResult',

      // Parser
      'parseQtiPackage', 'safeParseXml', 'detectInteractionType',
      'mapInteractionToCanonical', 'generateUnsupportedReport',
      'extractPrompt', 'extractCorrectAnswers', 'stripXmlTags',
      'QTI_INTERACTIONS', 'QTI_RESPONSE_PROCESSING',

      // Staging
      'createQtiPackage', 'updateQtiPackage', 'getQtiPackage',
      'listQtiPackages', 'deleteQtiPackage', 'createStagingItems',
      'getStagingItems', 'getStagingItem', 'updateStagingItemReview',
      'batchUpdateStagingReviews', 'commitQtiStaging', 'generateStagingReport',
      'findExistingPackageByHash', 'STAGING_STATUS', 'PACKAGE_STATUS',

      // Export
      'exportItemToQti', 'exportAssessmentToQti', 'generateManifest',
      'QTI_NAMESPACE', 'QTI_VERSION',
    ];

    for (const exp of expected) {
      expect(mod[exp], `Missing export: ${exp}`).toBeDefined();
    }
  });
});
