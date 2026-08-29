/**
 * Deborah — QTI Parser & Interaction→Canonical Mapping Engine
 *
 * Parses QTI 2.1/2.2 packages into Deborah's canonical item format.
 * Supports major interaction types with explicit unsupported feature reporting.
 *
 * QTI interaction types supported:
 *   - choiceInteraction → single_choice / multiple_choice
 *   - textEntryInteraction → short_answer
 *   - extendedTextInteraction → essay
 *   - inlineChoiceInteraction → fill_blanks
 *   - matchInteraction → matching
 *   - orderInteraction → ordering
 *   - gapMatchInteraction → fill_blanks (advanced)
 *   - sliderInteraction → numeric
 *   - uploadInteraction → file_upload
 *   - hotTextInteraction → single_choice (text-based)
 *   - associateInteraction → matching
 *
 * Security: ALL XML parsed with strict XXE protection.
 * No formulas or macros executed.
 */

import fs from 'fs';
import path from 'path';

// ── XML parser with XXE protection ──
let _xml2js = null;
try {
  const mod = await import('xml2js');
  _xml2js = mod;
} catch (_) {
  // Fallback: simple regex-based parser (limited, but XXE-safe)
}

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const QTI_INTERACTIONS = {
  // Supported → Full mapping
  choiceInteraction: { canonicalType: ['single_choice', 'multiple_choice'], maxScore: 1 },
  textEntryInteraction: { canonicalType: 'short_answer', maxScore: 1 },
  extendedTextInteraction: { canonicalType: 'essay', maxScore: 10 },
  inlineChoiceInteraction: { canonicalType: 'fill_blanks', maxScore: 1 },
  matchInteraction: { canonicalType: 'matching', maxScore: 5 },
  orderInteraction: { canonicalType: 'ordering', maxScore: 5 },
  gapMatchInteraction: { canonicalType: 'fill_blanks', maxScore: 3 },
  sliderInteraction: { canonicalType: 'numeric', maxScore: 1 },
  uploadInteraction: { canonicalType: 'file_upload', maxScore: 0 },
  hotTextInteraction: { canonicalType: 'single_choice', maxScore: 1 },
  associateInteraction: { canonicalType: 'matching', maxScore: 5 },
  drawingInteraction: { canonicalType: null, unsupported: true, reason: 'Drawing interaction not supported' },
  graphicInteraction: { canonicalType: null, unsupported: true, reason: 'Graphic interaction not supported' },
  hotSpotInteraction: { canonicalType: null, unsupported: true, reason: 'Hot spot interaction requires image coordinates' },
  mediaInteraction: { canonicalType: null, unsupported: true, reason: 'Media interaction requires player component' },
  positionObjectInteraction: { canonicalType: null, unsupported: true, reason: 'Position object interaction requires canvas' },
  selectPointInteraction: { canonicalType: null, unsupported: true, reason: 'Select point interaction requires image coordinates' },
};

export const QTI_RESPONSE_PROCESSING = {
  matchCorrect: 'match_correct',
  matchAnyCorrect: 'match_any_correct',
  sumCorrect: 'sum_correct',
  custom: 'custom',
};

// ═══════════════════════════════════════════════════════════════════
// SIMPLE XML PARSER (XXE-safe, regex-based)
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse XML string into a simple object structure.
 * Strips DOCTYPE/ENTITY declarations to prevent XXE.
 * Uses regex-based parsing as a fallback when xml2js is unavailable.
 */
export function safeParseXml(xmlContent) {
  if (!xmlContent || typeof xmlContent !== 'string') return null;

  // Strip DOCTYPE and ENTITY declarations (XXE prevention)
  let cleanXml = xmlContent
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!ENTITY[^>]*>/gi, '')
    .replace(/<!ELEMENT[^>]*>/gi, '')
    .replace(/<!ATTLIST[^>]*>/gi, '')
    .replace(/<\?xml-stylesheet[^?]*\?>/gi, '')
    .replace(/<\?xml[^?]*\?>/i, '');

  // If xml2js is available, use it (configured for XXE safety)
  if (_xml2js) {
    return new Promise((resolve) => {
      _xml2js.parseString(cleanXml, {
        explicitArray: false,
        ignoreAttrs: false,
        mergeAttrs: true,
        // XXE protection is achieved by pre-stripping DOCTYPE
        // xml2js with these settings doesn't resolve external entities by default
      }, (err, result) => {
        if (err) resolve(null);
        else resolve(result);
      });
    });
  }

  // Fallback: extract key elements with regex
  return extractElements(cleanXml);
}

/**
 * Simple element extraction (fallback when xml2js unavailable).
 */
function extractElements(xml) {
  const result = {};

  // Extract root element
  const rootMatch = xml.match(/<(\w+)([^>]*)>([\s\S]*)<\/\1>/);
  if (!rootMatch) return null;

  const rootName = rootMatch[1];
  result[rootName] = { $: parseAttributes(rootMatch[2]), _content: [] };

  // Extract child elements recursively
  const innerXml = rootMatch[3];
  const childRegex = /<(\w+)([^>]*)>([\s\S]*?)<\/\1>/g;
  let match;

  while ((match = childRegex.exec(innerXml)) !== null) {
    const [, name, attrs, content] = match;
    const el = {
      $: parseAttributes(attrs),
      _: content.replace(/<[^>]*>/g, '').trim(),
    };

    if (!result[rootName]._content) result[rootName]._content = [];
    // Check for nested elements
    const nestedMatch = content.match(/<(\w+)/);
    if (nestedMatch && nestedMatch[1] !== 'br' && nestedMatch[1] !== 'img') {
      el._elements = extractElements(`<${nestedMatch[1]}>${content}</${nestedMatch[1]}>`);
    }

    result[rootName]._content.push({ name, ...el });
  }

  return result;
}

function parseAttributes(attrStr) {
  const attrs = {};
  const regex = /(\w+)\s*=\s*"([^"]*)"/g;
  let match;
  while ((match = regex.exec(attrStr)) !== null) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

// ═══════════════════════════════════════════════════════════════════
// INTERACTION DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detect QTI interaction type from item XML content.
 */
export function detectInteractionType(xmlContent) {
  if (!xmlContent) return null;

  const lowerXml = xmlContent.toLowerCase();

  const interactionPatterns = [
    { type: 'choiceInteraction', pattern: /<choiceInteraction[^>]*>/i },
    { type: 'textEntryInteraction', pattern: /<textEntryInteraction[^>]*>/i },
    { type: 'extendedTextInteraction', pattern: /<extendedTextInteraction[^>]*>/i },
    { type: 'inlineChoiceInteraction', pattern: /<inlineChoiceInteraction[^>]*>/i },
    { type: 'matchInteraction', pattern: /<matchInteraction[^>]*>/i },
    { type: 'orderInteraction', pattern: /<orderInteraction[^>]*>/i },
    { type: 'gapMatchInteraction', pattern: /<gapMatchInteraction[^>]*>/i },
    { type: 'sliderInteraction', pattern: /<sliderInteraction[^>]*>/i },
    { type: 'uploadInteraction', pattern: /<uploadInteraction[^>]*>/i },
    { type: 'hotTextInteraction', pattern: /<hotTextInteraction[^>]*>/i },
    { type: 'associateInteraction', pattern: /<associateInteraction[^>]*>/i },
    { type: 'drawingInteraction', pattern: /<drawingInteraction[^>]*>/i },
    { type: 'graphicInteraction', pattern: /<graphicInteraction[^>]*>/i },
    { type: 'hotSpotInteraction', pattern: /<hotSpotInteraction[^>]*>/i },
    { type: 'mediaInteraction', pattern: /<mediaInteraction[^>]*>/i },
    { type: 'positionObjectInteraction', pattern: /<positionObjectInteraction[^>]*>/i },
    { type: 'selectPointInteraction', pattern: /<selectPointInteraction[^>]*>/i },
  ];

  for (const { type, pattern } of interactionPatterns) {
    if (pattern.test(lowerXml)) return type;
  }

  return null;
}

/**
 * Check if multiple interaction types exist in a single item.
 */
export function detectMultipleInteractions(xmlContent) {
  if (!xmlContent) return [];
  const found = [];
  for (const type of Object.keys(QTI_INTERACTIONS)) {
    const regex = new RegExp(`<${type}[^>]*>`, 'i');
    if (regex.test(xmlContent)) found.push(type);
  }
  return found;
}

// ═══════════════════════════════════════════════════════════════════
// INTERACTION→CANONICAL MAPPING ENGINE
// ═══════════════════════════════════════════════════════════════════

/**
 * Map a QTI interaction to the canonical Deborah item format.
 * Returns both the mapped data and any unsupported features.
 */
export function mapInteractionToCanonical(interactionType, xmlContent) {
  const interactionDef = QTI_INTERACTIONS[interactionType];
  if (!interactionDef) {
    return {
      supported: false,
      canonicalType: null,
      publicData: null,
      privateData: null,
      unsupportedReason: `Unknown interaction type: ${interactionType}`,
    };
  }

  if (interactionDef.unsupported) {
    return {
      supported: false,
      canonicalType: null,
      publicData: null,
      privateData: null,
      unsupportedReason: interactionDef.reason || `Unsupported interaction: ${interactionType}`,
    };
  }

  const canonicalType = Array.isArray(interactionDef.canonicalType)
    ? interactionDef.canonicalType[0] // Default to first
    : interactionDef.canonicalType;

  // Route to type-specific parser
  switch (interactionType) {
    case 'choiceInteraction':
      return parseChoiceInteraction(xmlContent, canonicalType);
    case 'textEntryInteraction':
      return parseTextEntryInteraction(xmlContent);
    case 'extendedTextInteraction':
      return parseExtendedTextInteraction(xmlContent);
    case 'inlineChoiceInteraction':
    case 'gapMatchInteraction':
      return parseInlineChoiceInteraction(xmlContent, interactionType);
    case 'matchInteraction':
    case 'associateInteraction':
      return parseMatchInteraction(xmlContent);
    case 'orderInteraction':
      return parseOrderInteraction(xmlContent);
    case 'sliderInteraction':
      return parseSliderInteraction(xmlContent);
    case 'uploadInteraction':
      return parseUploadInteraction(xmlContent);
    case 'hotTextInteraction':
      return parseHotTextInteraction(xmlContent);
    default:
      return {
        supported: false,
        canonicalType: null,
        unsupportedReason: `Parser not implemented for: ${interactionType}`,
      };
  }
}

// ═══════════════════════════════════════════════════════════════════
// TYPE-SPECIFIC PARSERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse choiceInteraction → single_choice / multiple_choice.
 */
function parseChoiceInteraction(xmlContent, canonicalType) {
  const isMultiple = xmlContent.includes('maxChoices="') &&
    parseInt(xmlContent.match(/maxChoices="(\d+)"/)?.[1] || '1') > 1;
  const resolvedType = isMultiple ? 'multiple_choice' : 'single_choice';

  // Extract stem (prompt/question text)
  const stem = extractPrompt(xmlContent) || { text: 'QTI imported item' };

  // Extract options
  const options = [];
  const simpleChoiceRegex = /<simpleChoice[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/simpleChoice>/gi;
  let choiceMatch;

  while ((choiceMatch = simpleChoiceRegex.exec(xmlContent)) !== null) {
    const key = choiceMatch[1];
    const text = stripXmlTags(choiceMatch[2]).trim();
    options.push({ key, text: text || key });
  }

  // If no simpleChoice found, try fixed choice pattern
  if (options.length === 0) {
    const fixedRegex = /<fixedChoice[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/fixedChoice>/gi;
    while ((choiceMatch = fixedRegex.exec(xmlContent)) !== null) {
      options.push({ key: choiceMatch[1], text: stripXmlTags(choiceMatch[2]).trim() });
    }
  }

  // Extract correct answer(s) from response processing
  const correctKeys = extractCorrectAnswers(xmlContent);

  return {
    supported: true,
    canonicalType: resolvedType,
    publicData: {
      stem,
      options: options.map(o => ({ key: o.key, text: o.text })),
      maxChoices: isMultiple ? parseInt(xmlContent.match(/maxChoices="(\d+)"/)?.[1] || '0') : 1,
    },
    privateData: {
      correctKeys,
      scoringType: isMultiple ? 'all_or_nothing' : 'exact_match',
      source: 'qti_import',
    },
  };
}

/**
 * Parse textEntryInteraction → short_answer.
 */
function parseTextEntryInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI text entry item' };

  // Extract expected answer(s) from responseDeclaration
  const expectedAnswers = [];
  const valueRegex = /<value>([\s\S]*?)<\/value>/gi;
  let valMatch;
  while ((valMatch = valueRegex.exec(xmlContent)) !== null) {
    const val = stripXmlTags(valMatch[1]).trim();
    if (val) expectedAnswers.push(val);
  }

  // Check for pattern matching (regex-based scoring)
  const hasPattern = xmlContent.includes('patternMatch') || xmlContent.includes('pattern');

  return {
    supported: true,
    canonicalType: 'short_answer',
    publicData: { stem, expectedLength: xmlContent.includes('expectedLength') ? 'short' : 'short' },
    privateData: {
      correctAnswers: expectedAnswers,
      matchType: hasPattern ? 'pattern' : 'exact',
      caseSensitive: !xmlContent.includes('caseSensitive="false"'),
      source: 'qti_import',
    },
  };
}

/**
 * Parse extendedTextInteraction → essay.
 */
function parseExtendedTextInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI essay item' };

  // Extract expected length
  const expectedLength = xmlContent.match(/expectedLength="(\d+)"/)?.[1] || null;
  const minStrings = parseInt(xmlContent.match(/minStrings="(\d+)"/)?.[1] || '0');

  return {
    supported: true,
    canonicalType: 'essay',
    publicData: {
      stem,
      minWords: minStrings,
      expectedLength: expectedLength ? parseInt(expectedLength) : null,
    },
    privateData: {
      scoringType: 'manual',
      keyConcepts: [],
      source: 'qti_import',
    },
  };
}

/**
 * Parse inlineChoiceInteraction / gapMatchInteraction → fill_blanks.
 */
function parseInlineChoiceInteraction(xmlContent, interactionType) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI fill-in-blanks item' };
  const blankOptions = [];
  const inlineRegex = /<inlineChoice[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/inlineChoice>/gi;
  let match;

  if (interactionType === 'gapMatchInteraction') {
    // Gap match has gaps and gap choices
    const gaps = [];
    const gapRegex = /<gap[^>]*identifier="([^"]*)"[^>]*>/gi;
    while ((match = gapRegex.exec(xmlContent)) !== null) {
      gaps.push(match[1]);
    }
    const gapChoices = [];
    const gcRegex = /<gapChoice[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/gapChoice>/gi;
    while ((match = gcRegex.exec(xmlContent)) !== null) {
      gapChoices.push({ identifier: match[1], text: stripXmlTags(match[2]).trim() });
    }

    return {
      supported: true,
      canonicalType: 'fill_blanks',
      publicData: { stem, blanks: gaps.map(g => ({ identifier: g, options: gapChoices })) },
      privateData: { correctMapping: null, scoringType: 'gap_match', source: 'qti_import' },
    };
  }

  while ((match = inlineRegex.exec(xmlContent)) !== null) {
    blankOptions.push({ identifier: match[1], text: stripXmlTags(match[2]).trim() });
  }

  return {
    supported: true,
    canonicalType: 'fill_blanks',
    publicData: { stem, blankOptions },
    privateData: { correctBlankValues: null, scoringType: 'inline_choice', source: 'qti_import' },
  };
}

/**
 * Parse matchInteraction / associateInteraction → matching.
 */
function parseMatchInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI matching item' };

  const premiseSet = [];
  const targetSet = [];

  // Extract simpleMatchSet entries
  const simpleMatchRegex = /<simpleMatchSet>([\s\S]*?)<\/simpleMatchSet>/gi;
  let setIndex = 0;
  let setMatch;

  while ((setMatch = simpleMatchRegex.exec(xmlContent)) !== null) {
    const setContent = setMatch[1];
    const simpleAssocRegex = /<simpleAssociableChoice[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/simpleAssociableChoice>/gi;
    let assocMatch;

    while ((assocMatch = simpleAssocRegex.exec(setContent)) !== null) {
      const item = { identifier: assocMatch[1], text: stripXmlTags(assocMatch[2]).trim() };
      if (setIndex === 0) premiseSet.push(item);
      else targetSet.push(item);
    }
    setIndex++;
  }

  // If no simpleMatchSet, try matchTable (for associate interaction)
  const matchTableRegex = /<matchTable>([\s\S]*?)<\/matchTable>/i;
  const mtMatch = matchTableRegex.exec(xmlContent);

  return {
    supported: true,
    canonicalType: 'matching',
    publicData: { stem, premiseSet, targetSet },
    privateData: { correctPairings: null, scoringType: 'matching', source: 'qti_import' },
  };
}

/**
 * Parse orderInteraction → ordering.
 */
function parseOrderInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI ordering item' };
  const items = [];

  const simpleChoiceRegex = /<simpleChoice[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/simpleChoice>/gi;
  let match;
  while ((match = simpleChoiceRegex.exec(xmlContent)) !== null) {
    items.push({ identifier: match[1], text: stripXmlTags(match[2]).trim() });
  }

  return {
    supported: true,
    canonicalType: 'ordering',
    publicData: { stem, items },
    privateData: { correctOrder: items.map(i => i.identifier), scoringType: 'ordering', source: 'qti_import' },
  };
}

/**
 * Parse sliderInteraction → numeric.
 */
function parseSliderInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI slider/numeric item' };

  const lowerBound = xmlContent.match(/lowerBound="([^"]*)"/)?.[1] || null;
  const upperBound = xmlContent.match(/upperBound="([^"]*)"/)?.[1] || null;
  const step = xmlContent.match(/step="([^"]*)"/)?.[1] || null;
  const correctVal = xmlContent.match(/<value>([^<]*)<\/value>/)?.[1] || null;

  return {
    supported: true,
    canonicalType: 'numeric',
    publicData: { stem, sliderRange: { min: lowerBound ? parseFloat(lowerBound) : 0, max: upperBound ? parseFloat(upperBound) : 100, step: step ? parseFloat(step) : 1 } },
    privateData: { correctNumericValue: correctVal ? parseFloat(correctVal) : null, tolerance: xmlContent.match(/tolerance="([^"]*)"/)?.[1] || null, source: 'qti_import' },
  };
}

/**
 * Parse uploadInteraction → file_upload.
 */
function parseUploadInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI file upload item' };
  return {
    supported: true,
    canonicalType: 'file_upload',
    publicData: { stem, allowedMimeTypes: [] },
    privateData: { scoringType: 'manual', source: 'qti_import' },
  };
}

/**
 * Parse hotTextInteraction → single_choice (text-based).
 */
function parseHotTextInteraction(xmlContent) {
  const stem = extractPrompt(xmlContent) || { text: 'QTI hot text item' };
  const options = [];

  const hottextRegex = /<hottext[^>]*identifier="([^"]*)"[^>]*>([\s\S]*?)<\/hottext>/gi;
  let match;
  while ((match = hottextRegex.exec(xmlContent)) !== null) {
    options.push({ key: match[1], text: stripXmlTags(match[2]).trim() });
  }

  return {
    supported: true,
    canonicalType: 'single_choice',
    publicData: { stem, options },
    privateData: { correctKeys: extractCorrectAnswers(xmlContent), scoringType: 'exact_match', source: 'qti_import' },
  };
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

/**
 * Extract the question prompt from QTI XML.
 */
export function extractPrompt(xmlContent) {
  if (!xmlContent) return null;

  // Try <prompt> element (QTI 2.x standard)
  const promptMatch = xmlContent.match(/<prompt[^>]*>([\s\S]*?)<\/prompt>/i);
  if (promptMatch) {
    return { text: stripXmlTags(promptMatch[1]).trim(), format: 'plain' };
  }

  // Try <rubricBlock> (assessment-level)
  const rubricMatch = xmlContent.match(/<rubricBlock[^>]*>([\s\S]*?)<\/rubricBlock>/i);
  if (rubricMatch) {
    return { text: stripXmlTags(rubricMatch[1]).trim(), format: 'plain' };
  }

  // Try itemBody content before the interaction
  const bodyMatch = xmlContent.match(/<itemBody[^>]*>([\s\S]*?)<\/itemBody>/i);
  if (bodyMatch) {
    const bodyContent = bodyMatch[1];
    // Remove interaction elements
    const cleanBody = bodyContent
      .replace(/<(choiceInteraction|textEntryInteraction|extendedTextInteraction|matchInteraction|orderInteraction)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(inlineChoiceInteraction|gapMatchInteraction|sliderInteraction|uploadInteraction|hotTextInteraction|associateInteraction)[\s\S]*?<\/\1>/gi, '')
      .replace(/<(img|object|embed)[^>]*\/?>/gi, '')
      .trim();

    if (cleanBody) {
      return { text: stripXmlTags(cleanBody).trim(), format: 'plain' };
    }
  }

  return null;
}

/**
 * Extract correct answer keys from QTI response processing.
 */
export function extractCorrectAnswers(xmlContent) {
  if (!xmlContent) return [];

  const keys = [];

  // Try <correctResponse> with <value> elements
  const correctRegex = /<correctResponse>([\s\S]*?)<\/correctResponse>/i;
  const correctMatch = correctRegex.exec(xmlContent);

  if (correctMatch) {
    const valueRegex = /<value>([\s\S]*?)<\/value>/gi;
    let valMatch;
    while ((valMatch = valueRegex.exec(correctMatch[1])) !== null) {
      keys.push(stripXmlTags(valMatch[1]).trim());
    }
  }

  // Try <mapping> with defaultValue
  if (keys.length === 0) {
    const mappingRegex = /<mapEntry[^>]*mapKey="([^"]*)"[^>]*>/gi;
    let mapMatch;
    while ((mapMatch = mappingRegex.exec(xmlContent)) !== null) {
      keys.push(mapMatch[1]);
    }
  }

  // Try <outcomeDeclaration> with matchCorrect
  if (keys.length === 0) {
    const matchCorrectRegex = /<matchCorrect>([\s\S]*?)<\/matchCorrect>/i;
    const mcMatch = matchCorrectRegex.exec(xmlContent);
    if (mcMatch) {
      const valRegex = /<value>([\s\S]*?)<\/value>/gi;
      let val;
      while ((val = valRegex.exec(mcMatch[1])) !== null) {
        keys.push(stripXmlTags(val[1]).trim());
      }
    }
  }

  return keys;
}

/**
 * Strip XML/HTML tags from a string.
 */
export function stripXmlTags(str) {
  if (!str) return '';
  return str
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════
// UNSUPPORTED FEATURE REPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate a detailed unsupported feature report from parsed items.
 */
export function generateUnsupportedReport(items) {
  if (!Array.isArray(items)) items = [];

  const supported = items.filter(i => i.mapping?.supported);
  const unsupported = items.filter(i => !i.mapping?.supported);
  const warnings = [];

  // Collect all warnings from items
  for (const item of items) {
    if (item.mapping?.publicData?.warnings) {
      warnings.push(...item.mapping.publicData.warnings.map(w =>
        `[${item.identifier || 'unknown'}] ${w}`
      ));
    }
  }

  // Count by interaction type
  const interactionCounts = {};
  for (const item of items) {
    const type = item.interactionType || 'unknown';
    interactionCounts[type] = (interactionCounts[type] || 0) + 1;
  }

  // Count unsupported by reason
  const unsupportedReasons = {};
  for (const item of unsupported) {
    const reason = item.mapping?.unsupportedReason || 'Unknown reason';
    unsupportedReasons[reason] = (unsupportedReasons[reason] || 0) + 1;
  }

  return {
    totalItems: items.length,
    supportedCount: supported.length,
    unsupportedCount: unsupported.length,
    supportRate: items.length > 0 ? (supported.length / items.length * 100).toFixed(1) + '%' : '0%',
    interactionCounts,
    unsupportedReasons,
    warnings,
    supportedItems: supported.map(i => ({
      identifier: i.identifier,
      interactionType: i.interactionType,
      canonicalType: i.mapping?.canonicalType,
    })),
    unsupportedItems: unsupported.map(i => ({
      identifier: i.identifier,
      interactionType: i.interactionType,
      reason: i.mapping?.unsupportedReason,
    })),
  };
}

// ═══════════════════════════════════════════════════════════════════
// FULL PACKAGE PARSER
// ═══════════════════════════════════════════════════════════════════

/**
 * Parse a QTI package: extract manifest, find assessment items,
 * map each item's interaction to canonical format.
 *
 * @param {string} packageDir - Path to extracted QTI package
 * @param {string} manifestXml - Content of imsmanifest.xml
 * @param {Array} zipEntries - List of all files in the ZIP
 * @returns {Object} { items, manifest, unsupported, warnings }
 */
export async function parseQtiPackage(packageDir, manifestXml, zipEntries) {
  const items = [];
  const manifestWarnings = [];
  let manifest = null;

  // 1. Parse XML content with XXE protection
  const parsedManifest = await safeParseXml(manifestXml);
  if (!parsedManifest) {
    manifestWarnings.push('Could not parse imsmanifest.xml. Attempting item discovery by scanning ZIP entries.');
  }

  // 2. Extract resources from manifest
  let resources = [];
  if (parsedManifest?.manifest?.resources?.resource) {
    resources = Array.isArray(parsedManifest.manifest.resources.resource)
      ? parsedManifest.manifest.resources.resource
      : [parsedManifest.manifest.resources.resource];
    manifest = parsedManifest.manifest;
  }

  // 3. If manifest parsing failed, discover items by scanning .xml files
  if (resources.length === 0 && zipEntries) {
    const xmlFiles = zipEntries.filter(e =>
      e.endsWith('.xml') && !e.endsWith('imsmanifest.xml')
    );
    for (const xmlFile of xmlFiles) {
      resources.push({
        $: { identifier: path.basename(xmlFile, '.xml'), type: 'imsqti_item_xmlv2p2' },
        file: [xmlFile],
      });
    }
    if (resources.length > 0) {
      manifestWarnings.push(`${resources.length} item(s) discovered by scanning ZIP entries (no manifest resources).`);
    }
  }

  // 4. Process each resource
  for (const resource of resources) {
    const attrs = resource.$ || {};
    const identifier = attrs.identifier || `qti_${Math.random().toString(36).slice(2, 8)}`;
    const resourceType = attrs.type || attrs.additionalType || '';

    // Get the file path
    let itemFile = '';
    if (typeof resource.file === 'string') {
      itemFile = resource.file;
    } else if (Array.isArray(resource.file) && resource.file.length > 0) {
      itemFile = resource.file[0]?.$?.href || resource.file[0]?.href || resource.file[0]?.text || '';
    } else if (resource.file?.$?.href) {
      itemFile = resource.file.$.href;
    } else if (resource.href) {
      itemFile = resource.href;
    }

    if (!itemFile) {
      items.push({
        identifier,
        resourceType,
        error: 'No file path found for resource',
      });
      continue;
    }

    // 5. Read item XML file
    const itemPath = path.join(packageDir, itemFile);
    let itemXml = null;
    try {
      itemXml = fs.readFileSync(itemPath, 'utf-8');
    } catch (err) {
      items.push({
        identifier,
        resourceType,
        file: itemFile,
        error: `Cannot read item file: ${err.message}`,
      });
      continue;
    }

    // 6. Detect interaction type
    const interactionType = detectInteractionType(itemXml);

    if (!interactionType) {
      items.push({
        identifier,
        resourceType,
        file: itemFile,
        interactionType: null,
        error: 'No supported interaction type detected in item XML',
      });
      continue;
    }

    // 7. Map to canonical format
    const mapping = mapInteractionToCanonical(interactionType, itemXml);

    items.push({
      identifier,
      resourceType,
      file: itemFile,
      interactionType,
      mapping,
    });
  }

  // 8. Generate unsupported report
  const report = generateUnsupportedReport(items);

  return {
    items,
    manifest,
    report,
    warnings: manifestWarnings,
  };
}
