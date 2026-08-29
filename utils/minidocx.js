/**
 * Deborah — Mini DOCX builder (S23 AI Studiya)
 * --------------------------------------------
 * Tashqi kutubxonasisiz haqiqiy Word-compatible .docx (OOXML):
 * sarlavhalar, xatboshilar, bullet ro'yxatlar, savol+javob variantlari bloklari.
 * ZIP yadrosi: utils/minizip.js. Word/Google Docs/LibreOffice ochadi.
 *
 * buildDocx({ title, subtitle?, blocks }) → Buffer
 *   block: { type:'h1'|'h2'|'text'|'bullet'|'opt'|'note'|'gap', text, bold?, correct? }
 */
import { makeZip, xmlEsc } from './minizip.js';

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr>
<w:rFonts w:ascii="Liberation Sans" w:hAnsi="Liberation Sans" w:cs="Liberation Sans"/>
<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="uz-Latn"/>
</w:rPr></w:rPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>
<w:rPr><w:b/><w:color w:val="1E3A8A"/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:spacing w:before="200" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr>
<w:rPr><w:b/><w:color w:val="1E3A8A"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:qFormat/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:style>
</w:styles>`;

const NUMBERING = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>
<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="&#8226;"/><w:lvlJc w:val="left"/>
<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr><w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol"/></w:rPr></w:lvl>
</w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
</w:numbering>`;

function coreXml(title) {
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xmlEsc(title)}</dc:title>
<dc:creator>Deborah AI Studiya</dc:creator>
<cp:lastModifiedBy>Deborah AI Studiya</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`;
}

const APP_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>Deborah</Application></Properties>`;

// ── Paragraph qurish ──
function para({ text, style, bullet, bold, color, indent, size, mark }) {
  const pPr = [];
  if (style) pPr.push(`<w:pStyle w:val="${style}"/>`);
  if (bullet) pPr.push(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
  if (indent) pPr.push(`<w:ind w:left="${indent}"/>`);
  const rPr = [];
  if (bold) rPr.push('<w:b/>');
  if (size) rPr.push(`<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>`);
  if (color) rPr.push(`<w:color w:val="${color}"/>`);
  const runs = [];
  // mark: matn oxiriga ✓ (to'g'ri javob) — alohida yashil run
  if (mark) {
    runs.push(`<w:r>${rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`);
    runs.push(`<w:r><w:rPr><w:b/><w:color w:val="059669"/></w:rPr><w:t xml:space="preserve"> \u2713</w:t></w:r>`);
  } else {
    runs.push(`<w:r>${rPr.length ? `<w:rPr>${rPr.join('')}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(text)}</w:t></w:r>`);
  }
  return `<w:p>${pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : ''}${runs.join('')}</w:p>`;
}

function emptyPara() {
  return '<w:p/>';
}

/** blocks → document.xml body */
function bodyXml(title, subtitle, blocks) {
  const out = [];
  out.push(para({ text: title, style: 'Heading1' }));
  if (subtitle) out.push(para({ text: subtitle, color: '64748B', size: '20' }));
  out.push(emptyPara());
  for (const b of blocks || []) {
    switch (b.type) {
      case 'h1': out.push(para({ text: b.text, style: 'Heading1' })); break;
      case 'h2': out.push(para({ text: b.text, style: 'Heading2' })); break;
      case 'text': out.push(para({ text: b.text, bold: !!b.bold })); break;
      case 'bullet': out.push(para({ text: b.text, bullet: true })); break;
      case 'opt': out.push(para({ text: b.text, indent: 720, mark: !!b.correct, color: b.correct ? '059669' : undefined, bold: !!b.correct })); break;
      case 'note': out.push(para({ text: b.text, indent: 360, color: '64748B', size: '19' })); break;
      case 'gap': out.push(emptyPara()); break;
      default: if (b.text) out.push(para({ text: b.text }));
    }
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${out.join('')}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr>
</w:body></w:document>`;
}

/**
 * Haqiqiy .docx Buffer.
 * @param {{title:string, subtitle?:string, blocks:Array}} opts
 */
export function buildDocx(opts) {
  const title = String(opts?.title || 'Hujjat');
  const files = {
    '[Content_Types].xml': CONTENT_TYPES,
    '_rels/.rels': ROOT_RELS,
    'word/document.xml': bodyXml(title, opts?.subtitle, opts?.blocks),
    'word/_rels/document.xml.rels': DOC_RELS,
    'word/styles.xml': STYLES,
    'word/numbering.xml': NUMBERING,
    'docProps/core.xml': coreXml(title),
    'docProps/app.xml': APP_XML,
  };
  return makeZip(files);
}

// ── Qulay konstruktorlar (AI Studiya uchun) ──
export function deckToDocxBlocks(deck) {
  const blocks = [];
  for (const s of deck?.slides || []) {
    blocks.push({ type: 'h2', text: s.title || '' });
    for (const b of s?.bullets || []) blocks.push({ type: 'bullet', text: b });
    blocks.push({ type: 'gap' });
  }
  return blocks;
}

export function questionsToDocxBlocks(questions, { withAnswers = true } = {}) {
  const blocks = [];
  (questions || []).forEach((q, i) => {
    blocks.push({ type: 'text', text: `${i + 1}. ${q.text}`, bold: true });
    (q.options || []).forEach((o, j) => {
      blocks.push({ type: 'opt', text: `${String.fromCharCode(65 + j)}) ${o}`, correct: withAnswers && j === q.correctIndex });
    });
    if (withAnswers && q.explanation) blocks.push({ type: 'note', text: `\u{1F4A1} ${q.explanation}` });
    blocks.push({ type: 'gap' });
  });
  return blocks;
}
