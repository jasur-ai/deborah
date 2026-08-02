/**
 * Edikit — QTI Export Service (Canonical → QTI)
 *
 * Converts Edikit canonical items back to QTI 2.x XML format.
 * Supports round-trip parity for all mapped interaction types.
 *
 * Generates:
 *   - Individual assessment item XML files
 *   - Full imsmanifest.xml for package export
 *   - Basic outcome processing for scoring
 */

// ═══════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════

export const QTI_NAMESPACE = 'http://www.imsglobal.org/xsd/imsqti_v2p2';
export const QTI_SCHEMA_LOCATION = 'http://www.imsglobal.org/xsd/imsqti_v2p2 http://www.imsglobal.org/xsd/qti/qtiv2p2/imsqti_v2p2.xsd';
export const QTI_VERSION = '2.2.0';

// ═══════════════════════════════════════════════════════════════════
// SINGLE ITEM EXPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Export a single canonical item to QTI 2.2 XML.
 *
 * @param {Object} item - Canonical item from item bank
 * @param {Object} [options]
 * @param {boolean} [options.includePrivateKey=false] - Include answer key in export
 * @returns {string} QTI 2.2 XML string
 */
export function exportItemToQti(item, options = {}) {
  const { includePrivateKey = false } = options;
  const publicData = item.public_data || {};
  const privateData = item.private_data || {};
  const questionType = item.question_type || 'single_choice';
  const identifier = `item_${item.id || 'new'}`;

  // Build interaction XML based on question type
  const interactionXml = buildInteractionXml(questionType, publicData, privateData, includePrivateKey);
  const responseDeclaration = buildResponseDeclaration(questionType, privateData, includePrivateKey);
  const outcomeDeclaration = buildOutcomeDeclaration();

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem
  xmlns="${QTI_NAMESPACE}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${QTI_SCHEMA_LOCATION}"
  identifier="${identifier}"
  title="${escapeXml(publicData?.stem?.text || 'Imported Item')}"
  adaptive="false"
  timeDependent="false"
  label="${escapeXml(item.difficulty || 'medium')}">
  ${responseDeclaration}
  ${outcomeDeclaration}
  <itemBody>
    ${buildPromptXml(publicData?.stem)}
    ${interactionXml}
  </itemBody>
  ${includePrivateKey ? buildResponseProcessing(questionType, privateData) : ''}
</assessmentItem>`;

  return xml;
}

// ═══════════════════════════════════════════════════════════════════
// INTERACTION XML BUILDERS
// ═══════════════════════════════════════════════════════════════════

function buildInteractionXml(questionType, publicData, privateData, includeKey) {
  switch (questionType) {
    case 'single_choice':
      return buildChoiceInteraction(publicData, false);
    case 'multiple_choice':
      return buildChoiceInteraction(publicData, true);
    case 'true_false':
      return buildTrueFalseInteraction(publicData);
    case 'short_answer':
      return buildTextEntryInteraction(publicData);
    case 'essay':
      return buildExtendedTextInteraction(publicData);
    case 'numeric':
      return buildSliderInteraction(publicData);
    case 'matching':
      return buildMatchInteraction(publicData);
    case 'ordering':
      return buildOrderInteraction(publicData);
    case 'fill_blanks':
      return buildInlineChoiceInteraction(publicData);
    case 'file_upload':
      return buildUploadInteraction(publicData);
    default:
      return `<!-- Unsupported type: ${questionType} -->`;
  }
}

function buildPromptXml(stem) {
  if (!stem || !stem.text) return '';
  return `<prompt>${escapeXml(stem.text)}</prompt>`;
}

function buildChoiceInteraction(publicData, isMultiple) {
  const maxChoices = isMultiple ? (publicData.maxChoices || 0) : 1;
  const options = publicData.options || [];
  const items = options.map((opt, i) => {
    const identifier = opt.key || `choice_${i + 1}`;
    return `    <simpleChoice identifier="${escapeXml(identifier)}" fixed="false">${escapeXml(opt.text || '')}</simpleChoice>`;
  }).join('\n');

  return `    <choiceInteraction responseIdentifier="RESPONSE" shuffle="${isMultiple ? 'true' : 'false'}" maxChoices="${maxChoices}">
${items}
    </choiceInteraction>`;
}

function buildTrueFalseInteraction(publicData) {
  return `    <choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1">
      <simpleChoice identifier="true" fixed="true">True</simpleChoice>
      <simpleChoice identifier="false" fixed="true">False</simpleChoice>
    </choiceInteraction>`;
}

function buildTextEntryInteraction(publicData) {
  return `    <textEntryInteraction responseIdentifier="RESPONSE" expectedLength="${publicData.expectedLength === 'long' ? '500' : '100'}"/>`;
}

function buildExtendedTextInteraction(publicData) {
  const expectedLen = publicData.expectedLength || 500;
  return `    <extendedTextInteraction responseIdentifier="RESPONSE" expectedLength="${expectedLen}" expectedLines="${publicData.minWords > 3 ? '5' : '3'}"/>`;
}

function buildSliderInteraction(publicData) {
  const range = publicData.sliderRange || {};
  return `    <sliderInteraction responseIdentifier="RESPONSE" lowerBound="${range.min || 0}" upperBound="${range.max || 100}" step="${range.step || 1}"/>`;
}

function buildMatchInteraction(publicData) {
  const premises = (publicData.premiseSet || []).map(p =>
    `      <simpleAssociableChoice identifier="${escapeXml(p.identifier)}" matchMax="1">${escapeXml(p.text)}</simpleAssociableChoice>`
  ).join('\n');
  const targets = (publicData.targetSet || []).map(t =>
    `      <simpleAssociableChoice identifier="${escapeXml(t.identifier)}" matchMax="0">${escapeXml(t.text)}</simpleAssociableChoice>`
  ).join('\n');

  return `    <matchInteraction responseIdentifier="RESPONSE" shuffle="true" maxAssociations="0">
      <simpleMatchSet>
${premises}
      </simpleMatchSet>
      <simpleMatchSet>
${targets}
      </simpleMatchSet>
    </matchInteraction>`;
}

function buildOrderInteraction(publicData) {
  const items = (publicData.items || publicData.options || []).map((item, i) => {
    const identifier = item.identifier || item.key || `item_${i + 1}`;
    return `      <simpleChoice identifier="${escapeXml(identifier)}" fixed="false">${escapeXml(item.text || '')}</simpleChoice>`;
  }).join('\n');

  return `    <orderInteraction responseIdentifier="RESPONSE" shuffle="false">
${items}
    </orderInteraction>`;
}

function buildInlineChoiceInteraction(publicData) {
  const blanks = publicData.blankOptions || [];
  const items = blanks.map(b =>
    `      <inlineChoice identifier="${escapeXml(b.identifier)}">${escapeXml(b.text)}</inlineChoice>`
  ).join('\n');

  return `    <inlineChoiceInteraction responseIdentifier="RESPONSE" shuffle="false">
${items}
    </inlineChoiceInteraction>`;
}

function buildUploadInteraction() {
  return `    <uploadInteraction responseIdentifier="RESPONSE" type="file"/>`;
}

// ═══════════════════════════════════════════════════════════════════
// RESPONSE DECLARATION
// ═══════════════════════════════════════════════════════════════════

function buildResponseDeclaration(questionType, privateData, includeKey) {
  const baseTypeMap = {
    single_choice: 'identifier',
    multiple_choice: 'identifier',
    true_false: 'identifier',
    short_answer: 'string',
    essay: 'string',
    numeric: 'float',
    matching: 'identifier',
    ordering: 'identifier',
    fill_blanks: 'identifier',
    file_upload: 'file',
  };

  const cardinalityMap = {
    single_choice: 'single',
    multiple_choice: 'multiple',
    true_false: 'single',
    short_answer: 'single',
    essay: 'single',
    numeric: 'single',
    matching: 'multiple',
    ordering: 'ordered',      fill_blanks: 'multiple',
    file_upload: 'single',
  };

  const baseType = baseTypeMap[questionType] || 'identifier';
  const cardinality = cardinalityMap[questionType] || 'single';

  let correctResponse = '';
  if (includeKey && privateData) {
    const keys = privateData.correctKeys || privateData.correctAnswers || [];
    if (privateData.correctNumericValue !== null && privateData.correctNumericValue !== undefined) {
      correctResponse = `    <correctResponse>
      <value>${privateData.correctNumericValue}</value>
    </correctResponse>`;
    } else if (keys.length > 0) {
      const values = keys.map(k => `      <value>${escapeXml(k)}</value>`).join('\n');
      correctResponse = `    <correctResponse>
${values}
    </correctResponse>`;
    } else if (privateData.correctOrder?.length > 0) {
      const values = privateData.correctOrder.map(k => `      <value>${escapeXml(k)}</value>`).join('\n');
      correctResponse = `    <correctResponse>
${values}
    </correctResponse>`;
    }
  }

  return `  <responseDeclaration identifier="RESPONSE" cardinality="${cardinality}" baseType="${baseType}">
${correctResponse}  </responseDeclaration>`;
}

function buildOutcomeDeclaration() {
  return `  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float">
    <defaultValue>
      <value>0</value>
    </defaultValue>
  </outcomeDeclaration>`;
}

// ═══════════════════════════════════════════════════════════════════
// RESPONSE PROCESSING
// ═══════════════════════════════════════════════════════════════════

function buildResponseProcessing(questionType, privateData) {
  if (!privateData) return '';

  const keys = privateData.correctKeys || privateData.correctAnswers || [];

  if (keys.length === 0 && privateData.correctNumericValue === null && privateData.correctNumericValue === undefined) {
    return '';
  }

  if (questionType === 'short_answer') {
    const matchType = privateData.matchType === 'pattern' ? 'patternMatch' : 'matchCorrect';
    const caseSensitive = privateData.caseSensitive !== false;
    return `  <responseProcessing>
    <responseCondition>
      <responseIf>
        <${matchType}>
          <variable identifier="RESPONSE"/>
          ${keys.map(k => `<correct identifier="RESPONSE">${escapeXml(k)}</correct>`).join('\n        ')}
        </${matchType}>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">1</baseValue>
        </setOutcomeValue>
      </responseIf>
      <responseElse>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">0</baseValue>
        </setOutcomeValue>
      </responseElse>
    </responseCondition>
  </responseProcessing>`;
  }

  if (questionType === 'numeric' && privateData.correctNumericValue !== null) {
    const tolerance = privateData.tolerance || 0;
    return `  <responseProcessing>
    <responseCondition>
      <responseIf>
        <equal tolerance="${tolerance}">
          <variable identifier="RESPONSE"/>
          <baseValue baseType="float">${privateData.correctNumericValue}</baseValue>
        </equal>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">1</baseValue>
        </setOutcomeValue>
      </responseIf>
      <responseElse>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">0</baseValue>
        </setOutcomeValue>
      </responseElse>
    </responseCondition>
  </responseProcessing>`;
  }

  // Default: match correct
  if (keys.length > 0) {
    const values = keys.map(k =>
      `      <value>${escapeXml(k)}</value>`
    ).join('\n');
    return `  <responseProcessing>
    <responseCondition>
      <responseIf>
        <match>
          <variable identifier="RESPONSE"/>
          <correct identifier="RESPONSE"/>
        </match>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">1</baseValue>
        </setOutcomeValue>
      </responseIf>
      <responseElse>
        <setOutcomeValue identifier="SCORE">
          <baseValue baseType="float">0</baseValue>
        </setOutcomeValue>
      </responseElse>
    </responseCondition>
  </responseProcessing>`;
  }

  return '';
}

// ═══════════════════════════════════════════════════════════════════
// ASSESSMENT (TEST) EXPORT
// ═══════════════════════════════════════════════════════════════════

/**
 * Export a full assessment (test) to QTI XML with section structure.
 *
 * @param {Object} assessment - { title, description, sections: [{ title, items: [item, ...] }] }
 * @returns {string} QTI 2.2 assessmentTest XML
 */
export function exportAssessmentToQti(assessment) {
  if (!assessment) return '';

  const sections = (assessment.sections || []).map((section, si) => {
    const items = (section.items || []).map(item => {
      return `      <assessmentItemRef identifier="item_${item.id || 'unknown'}" href="${item.fileName || `items/item_${item.id || 'unknown'}.xml`}"/>`;
    }).join('\n');

    return `    <section identifier="section_${si + 1}" title="${escapeXml(section.title || `Section ${si + 1}`)}" visible="true">
${items}
    </section>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentTest
  xmlns="${QTI_NAMESPACE}"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="${QTI_SCHEMA_LOCATION}"
  identifier="test_${assessment.id || 'new'}"
  title="${escapeXml(assessment.title || 'Exported Assessment')}">
  <testPart identifier="testPart_1" navigationMode="linear" submissionMode="individual">
${sections}
  </testPart>
  <outcomeProcessing>
    <outcomeVariable identifier="SCORE" cardinality="single" baseType="float"/>
  </outcomeProcessing>
</assessmentTest>`;
}

// ═══════════════════════════════════════════════════════════════════
// MANIFEST GENERATION
// ═══════════════════════════════════════════════════════════════════

/**
 * Generate imsmanifest.xml for a QTI package.
 *
 * @param {Object} manifest - { identifier, title, items: [{ id, fileName }] }
 * @returns {string} imsmanifest.xml content
 */
export function generateManifest(manifest) {
  if (!manifest) return '';

  const resources = (manifest.items || []).map(item => {
    return `    <resource identifier="item_${item.id || 'unknown'}" type="imsqti_item_xmlv2p2" href="${item.fileName || `items/item_${item.id || 'unknown'}.xml`}">
      <file href="${item.fileName || `items/item_${item.id || 'unknown'}.xml`}"/>
    </resource>`;
  }).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${manifest.identifier || 'edikit_export'}" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"
  xmlns:imsmd="http://www.imsglobal.org/xsd/imsmd_v1p2"
  xmlns:imsqti="http://www.imsglobal.org/xsd/imsqti_v2p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsglobal.org/xsd/imscp_v1p1 http://www.imsglobal.org/xsd/imscp_v1p1.xsd">
  <metadata>
    <schema>IMS QTI</schema>
    <schemaversion>${QTI_VERSION}</schemaversion>
  </metadata>
  <organizations>
    <organization identifier="org_1" structure="hierarchical">
      <item identifier="item_set_1" identifierref="resource_set_1" title="${escapeXml(manifest.title || 'Edikit Export')}"/>
    </organization>
  </organizations>
  <resources>
${resources}
  </resources>
</manifest>`;
}

// ═══════════════════════════════════════════════════════════════════
// XML ESCAPING
// ═══════════════════════════════════════════════════════════════════

function escapeXml(str) {
  if (typeof str !== 'string') return String(str || '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
