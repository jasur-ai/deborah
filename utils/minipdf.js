/**
 * Deborah — Mini PDF builder (S23 AI Studiya)
 * -------------------------------------------
 * Tashqi PDF kutubxonasisiz HAQIQIY .pdf: TrueType shrift embed (CIDFontType2,
 * Identity-H + ToUnicode → Latin/Kirill/uzbek lotin chiqadi), matn wrap,
 * ko'p sahifa, footer raqamlash, ranglar.
 *
 * Shrift: pdfjs-dist standard_fonts LiberationSans (Regular+Bold) — npm ci
 * bilan qaytadi (pdf-parse 2.x dependency). Fallback: tizim liberation.
 *
 * buildPdf({ title, subtitle?, blocks, footerName? }) → Buffer
 *   block: { type:'h1'|'h2'|'text'|'bullet'|'opt'|'note'|'gap'|'pagebreak',
 *            text, bold?, correct? }
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';

// ═══════════════ 1) TTF parser (cmap/head/hhea/hmtx/maxp) ═══════════════
class TtfFont {
  constructor(buf) {
    this.buf = buf;
    const d = buf;
    const numTables = d.readUInt16BE(4);
    this.tables = {};
    for (let i = 0; i < numTables; i++) {
      const off = 12 + i * 16;
      const tag = d.toString('latin1', off, off + 4);
      this.tables[tag] = [d.readUInt32BE(off + 8), d.readUInt32BE(off + 12)];
    }
    const [headOff] = this.tables.head;
    this.unitsPerEm = d.readUInt16BE(headOff + 18) || 1000;
    this.bbox = [
      d.readInt16BE(headOff + 36), d.readInt16BE(headOff + 38),
      d.readInt16BE(headOff + 40), d.readInt16BE(headOff + 42),
    ];
    const [hheaOff] = this.tables.hhea;
    this.ascent = d.readInt16BE(hheaOff + 4);
    this.descent = d.readInt16BE(hheaOff + 6);
    this.numHMetrics = d.readUInt16BE(hheaOff + 34);
    this.numGlyphs = this.tables.maxp ? d.readUInt16BE(this.tables.maxp[0] + 4) : 0;
    this._parseCmap();
    this._advCache = new Map();
  }

  _parseCmap() {
    const d = this.buf;
    const [cmapOff] = this.tables.cmap;
    const n = d.readUInt16BE(cmapOff + 2);
    let subOff = 0;
    let bestScore = -1;
    for (let i = 0; i < n; i++) {
      const rec = cmapOff + 4 + i * 8;
      const pid = d.readUInt16BE(rec);
      const eid = d.readUInt16BE(rec + 2);
      const off = d.readUInt32BE(rec + 4);
      const score = (pid === 3 && eid === 10) || (pid === 0 && eid === 4) ? 4
        : (pid === 3 && eid === 1) || (pid === 0 && eid === 3) ? 3
        : (pid === 0 && eid === 1) || (pid === 3 && eid === 0) ? 2 : -1;
      if (score > bestScore) { bestScore = score; subOff = cmapOff + off; }
    }
    if (subOff <= 0) throw new Error('cmap topilmadi');
    const format = d.readUInt16BE(subOff);
    this._map = new Map(); // cp -> gid
    if (format === 4) {
      const segCountX2 = d.readUInt16BE(subOff + 6);
      const segCount = segCountX2 / 2;
      const endBase = subOff + 14;
      const startBase = endBase + segCountX2 + 2;
      const deltaBase = startBase + segCountX2;
      const rangeBase = deltaBase + segCountX2;
      for (let i = 0; i < segCount; i++) {
        const end = d.readUInt16BE(endBase + i * 2);
        const start = d.readUInt16BE(startBase + i * 2);
        const delta = d.readInt16BE(deltaBase + i * 2);
        const rangeOff = d.readUInt16BE(rangeBase + i * 2);
        if (start === 0xffff) continue;
        for (let c = start; c <= end; c++) {
          let gid;
          if (rangeOff === 0) {
            gid = (c + delta) & 0xffff;
          } else {
            const idx = rangeBase + i * 2 + rangeOff + (c - start) * 2;
            const g = d.readUInt16BE(idx);
            gid = g === 0 ? 0 : (g + delta) & 0xffff;
          }
          if (gid !== 0 && gid < this.numGlyphs && !this._map.has(c)) this._map.set(c, gid);
        }
      }
    } else if (format === 12) {
      const nGroups = d.readUInt32BE(subOff + 12);
      for (let i = 0; i < nGroups; i++) {
        const gOff = subOff + 16 + i * 12;
        const start = d.readUInt32BE(gOff);
        const end = d.readUInt32BE(gOff + 4);
        const startGid = d.readUInt32BE(gOff + 8);
        for (let c = start; c <= end && c <= 0xffff; c++) {
          const gid = startGid + (c - start);
          if (gid !== 0 && gid < this.numGlyphs && !this._map.has(c)) this._map.set(c, gid);
        }
      }
    } else {
      throw new Error('cmap format ' + format + ' qo\u2018llanmaydi');
    }
    if (!this._map.has(32)) this._map.set(32, 3);
    // cp -> gid teskari xarita (gid -> birinchi cp) ToUnicode uchun
    this._cpByGid = new Map();
    for (const [cp, g] of this._map) if (!this._cpByGid.has(g)) this._cpByGid.set(g, cp);
  }

  gid(ch) {
    const cp = ch.codePointAt(0);
    if (cp > 0xffff) return this._map.get(63) || this._map.get(32);
    if (cp === 9 || cp === 10 || cp === 13) return this._map.get(32);
    return this._map.get(cp) || this._map.get(32);
  }

  advance(gid) {
    let a = this._advCache.get(gid);
    if (a !== undefined) return a;
    const [off] = this.tables.hmtx;
    a = gid < this.numHMetrics
      ? this.buf.readUInt16BE(off + gid * 4)
      : this.buf.readUInt16BE(off + (this.numHMetrics - 1) * 4);
    this._advCache.set(gid, a);
    return a;
  }
}

// ═══════════════ 2) Shrift topish (lazy) ═══════════════
let _fontsCache = null;
function getFonts() {
  if (_fontsCache) return _fontsCache;
  // 1) Repo'ga commit qilingan Noto Sans — o'zbek kiril (қ ғ ҳ) va ✓ qamrovi;
  //    sandbox/production mustaqil (assets/pdf-fonts).
  // 2) Fallback: pdfjs-dist LiberationSans (rus kiril + lotin).
  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    [path.resolve(here, '..', 'assets/pdf-fonts/NotoSans-Regular.ttf'), path.resolve(here, '..', 'assets/pdf-fonts/NotoSans-Bold.ttf')],
  ];
  try {
    const req = createRequire(import.meta.url);
    candidates.push([req.resolve('pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'), null]);
  } catch (_) { /* require ishlamadi */ }
  candidates.push([path.resolve(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'), null]);
  for (const [p, pb] of candidates) {
    try {
      const boldPath = pb || p.replace('Regular', 'Bold');
      if (fs.existsSync(p) && fs.existsSync(boldPath)) {
        _fontsCache = [new TtfFont(fs.readFileSync(p)), new TtfFont(fs.readFileSync(boldPath))];
        return _fontsCache;
      }
    } catch (_) { /* keyingi */ }
  }
  throw new Error('PDF shrift topilmadi (NotoSans/LiberationSans R+B)');
}

// ═══════════════ 3) Layout ═══════════════
const PAGE = { w: 595.28, h: 841.89, margin: 56 };
const COLORS = { navy: [0.12, 0.23, 0.54], gray: [0.42, 0.47, 0.55], green: [0.02, 0.59, 0.41], dark: [0.06, 0.09, 0.16] };

function wrapText(text, font, fontSize, maxWidth) {
  const upem = font.unitsPerEm;
  const scale = fontSize / upem;
  const widthOf = (gids) => gids.reduce((a, g) => a + font.advance(g) * scale, 0);
  const gidsOf = (s) => { const out = []; for (const ch of s) out.push(font.gid(ch)); return out; };
  const words = String(text).split(/\s+/).filter((w) => w.length);
  if (!words.length) return [{ segs: [{ text: ' ', gids: [font.gid(' ')] }], width: widthOf([font.gid(' ')]) }];
  const lines = [];
  let cur = null;
  for (const w of words) {
    const seg = { text: w, gids: gidsOf(w) };
    seg.width = widthOf(seg.gids);
    const spW = font.advance(font.gid(' ')) * scale;
    if (!cur) cur = { segs: [seg], width: seg.width };
    else if (cur.width + spW + seg.width <= maxWidth) { cur.segs.push(seg); cur.width += spW + seg.width; }
    else { lines.push(cur); cur = { segs: [seg], width: seg.width }; }
    // Juda uzun bitta so'z — gid bo'yicha kesish
    while (cur.width > maxWidth && cur.segs.length === 1 && cur.segs[0].gids.length > 1) {
      let acc = 0, cut = 0;
      const g = cur.segs[0].gids;
      for (let i = 0; i < g.length; i++) { acc += font.advance(g[i]) * scale; if (acc > maxWidth) { cut = i; break; } }
      if (cut <= 0) break;
      const head = { text: '', gids: g.slice(0, cut) }; head.width = widthOf(head.gids);
      lines.push({ segs: [head], width: head.width });
      const rest = { text: '', gids: g.slice(cut) }; rest.width = widthOf(rest.gids);
      cur = { segs: [rest], width: rest.width };
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** blocks → pages[] (har page: [{segs, font, size, color, indent, y, dyAfter}]) */
function layoutBlocks(blocks, fonts) {
  const [R, B] = fonts;
  const maxW = PAGE.w - PAGE.margin * 2;
  const items = [];
  const pushWrapped = (text, font, size, color, indent, dyAfter) => {
    for (const ln of wrapText(text, font, size, maxW - indent)) {
      items.push({ segs: ln.segs, font, size, color, indent, dyAfter });
    }
  };
  for (const b of blocks || []) {
    switch (b.type) {
      case 'h1': pushWrapped(b.text || '', B, 19, COLORS.navy, 0, 10); break;
      case 'h2': pushWrapped(b.text || '', B, 13.5, COLORS.navy, 0, 6); break;
      case 'text': pushWrapped(b.text || '', b.bold ? B : R, 10.5, COLORS.dark, 0, 4); break;
      case 'bullet': pushWrapped('\u2022  ' + (b.text || ''), R, 10.5, COLORS.dark, 14, 3); break;
      case 'opt': pushWrapped((b.correct ? '\u00bb ' : '\u00a0\u00a0 ') + (b.text || ''), b.correct ? B : R, 10, b.correct ? COLORS.green : COLORS.dark, 26, 2); break;
      case 'note': pushWrapped(b.text || '', R, 9, COLORS.gray, 16, 4); break;
      case 'gap': items.push({ gap: 12 }); break;
      case 'pagebreak': items.push({ pagebreak: true }); break;
      default: if (b.text) pushWrapped(b.text, R, 10.5, COLORS.dark, 0, 4);
    }
  }
  const pages = [];
  let cur = [];
  let y = PAGE.h - PAGE.margin - 20;
  const bottom = PAGE.margin + 30;
  for (const it of items) {
    if (it.pagebreak) { pages.push(cur); cur = []; y = PAGE.h - PAGE.margin - 20; continue; }
    if (it.gap) { y -= it.gap; continue; }
    const lh = it.size * 1.45;
    if (y - lh < bottom) { pages.push(cur); cur = []; y = PAGE.h - PAGE.margin - 20; }
    cur.push({ ...it, y });
    y -= lh + (it.dyAfter || 0);
  }
  if (cur.length) pages.push(cur);
  return pages;
}

// ═══════════════ 4) PDF yozish ═══════════════
function hexGids(gids) {
  let s = '';
  for (const g of gids) s += g.toString(16).padStart(4, '0');
  return s;
}

function toUnicodeCmap(pairs) {
  const sorted = [...pairs].sort((a, b) => a.gid - b.gid);
  const chunks = [];
  for (let i = 0; i < sorted.length; i += 90) chunks.push(sorted.slice(i, i + 90));
  const body = chunks.map((ch) => `${ch.length} beginbfrange\n` +
    ch.map((p) => `<${p.gid.toString(16).padStart(4, '0')}> <${p.gid.toString(16).padStart(4, '0')}> <${p.cp.toString(16).padStart(4, '0')}>`).join('\n') +
    '\nendbfrange').join('\n');
  return `/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <ffff>\nendcodespacerange\n${body}\nendcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}

function buildPdfInternal({ title, subtitle, blocks, footerName }, fonts) {
  const [R, B] = fonts;
  const pages = layoutBlocks([{ type: 'h1', text: title || '' }, ...(subtitle ? [{ type: 'note', text: subtitle }] : []), { type: 'gap' }, ...(blocks || [])], fonts);
  if (!pages.length) pages.push([]);

  // Har shrift uchun ishlatilgan gidlar (gid fazosi shriftga xos!)
  const usedR = new Set();
  const usedB = new Set();
  const footText = `Deborah \u2014 ${String(footerName || title || '').slice(0, 60)}   \u00b7   `;
  for (const pg of pages) {
    for (const it of pg) {
      if (!it.segs) continue;
      for (const seg of it.segs) for (const g of seg.gids) (it.font === B ? usedB : usedR).add(g);
    }
  }
  for (const ch of footText + '11 / 11') usedR.add(R.gid(ch));

  const objs = [];
  const addObj = (data) => { objs.push(data); return objs.length; };
  objs.push(null); // 1 = catalog
  objs.push(null); // 2 = pages

  function embedFont(F, name, usedSet) {
    const ttf = zlib.deflateRawSync(F.buf);
    const fileBody = { dict: `<< /Length ${ttf.length} /Length1 ${F.buf.length} /Filter /FlateDecode >>`, data: ttf };
    const fontFileId = addObj(fileBody);
    const descId = addObj(`<< /Type /FontDescriptor /FontName /${name} /Flags 4 /FontBBox [${F.bbox.map((v) => Math.round(v * 1000 / F.unitsPerEm)).join(' ')}] /ItalicAngle 0 /Ascent ${Math.round(F.ascent * 1000 / F.unitsPerEm)} /Descent ${Math.round(F.descent * 1000 / F.unitsPerEm)} /CapHeight 700 /StemV 80 /FontFile2 ${fontFileId} 0 R >>`);
    const wArr = [...usedSet].map((g) => `${g} [${Math.round(F.advance(g) * 1000 / F.unitsPerEm)}]`).join(' ');
    const cidId = addObj(`<< /Subtype /CIDFontType2 /BaseFont /${name} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${descId} 0 R /DW 1000 /W [${wArr}] /CIDToGIDMap /Identity >>`);
    const pairs = [...usedSet].map((g) => ({ gid: g, cp: F._cpByGid.get(g) || 32 }));
    const cmapStr = toUnicodeCmap(pairs);
    const touId = addObj({ dict: `<< /Length ${Buffer.byteLength(cmapStr)} >>`, data: Buffer.from(cmapStr, 'utf8') });
    const type0Id = addObj(`<< /Type /Font /Subtype /Type0 /BaseFont /${name} /Encoding /Identity-H /DescendantFonts [${cidId} 0 R] /ToUnicode ${touId} 0 R >>`);
    return { type0Id, name };
  }

  const fReg = embedFont(R, 'DebSans', usedR);
  const fBold = embedFont(B, 'DebSans-Bold', usedB);

  const total = pages.length;
  const contentIds = [];
  for (let p = 0; p < total; p++) {
    const ops = [`0.78 0.84 0.91 RG 0.7 w ${PAGE.margin} ${(PAGE.h - PAGE.margin + 8).toFixed(2)} m ${(PAGE.w - PAGE.margin).toFixed(2)} ${(PAGE.h - PAGE.margin + 8).toFixed(2)} l S`];
    for (const it of pages[p]) {
      if (!it.segs) continue;
      const f = it.font === B ? fBold : fReg;
      const [r, g, bb] = it.color;
      const x = PAGE.margin + (it.indent || 0);
      const gids = [];
      for (let i = 0; i < it.segs.length; i++) {
        if (i > 0) gids.push(it.font.gid(' '));
        gids.push(...it.segs[i].gids);
      }
      ops.push(`BT /${f.name} ${it.size} Tf ${r} ${g} ${bb} rg 1 0 0 1 ${x.toFixed(2)} ${it.y.toFixed(2)} Tm <${hexGids(gids)}> Tj ET`);
    }
    // Footer
    const foot = `${footText}${p + 1} / ${total}`;
    const fSize = 8;
    let realW = 0;
    const fGids = [];
    for (const ch of foot) { const g = R.gid(ch); fGids.push(g); realW += R.advance(g) * fSize / R.unitsPerEm; }
    ops.push(`BT /${fReg.name} ${fSize} Tf 0.55 0.6 0.66 rg 1 0 0 1 ${((PAGE.w - realW) / 2).toFixed(2)} ${(PAGE.margin - 20).toFixed(2)} Tm <${hexGids(fGids)}> Tj ET`);
    const content = ops.join('\n');
    contentIds.push(addObj({ dict: `<< /Length ${Buffer.byteLength(content)} >>`, data: Buffer.from(content, 'utf8') }));
  }
  const pageIds = [];
  for (let p = 0; p < total; p++) {
    pageIds.push(addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /${fReg.name} ${fReg.type0Id} 0 R /${fBold.name} ${fBold.type0Id} 0 R >> >> /Contents ${contentIds[p]} 0 R >>`));
  }
  objs[0] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objs[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const infoId = addObj(`<< /Title (${String(title || 'Hujjat').replace(/[()\\]/g, ' ')}) /Producer (Deborah minipdf) /Creator (Deborah AI Studiya) >>`);

  // ── Bayt oqimi + xref ──
  const parts = [];
  let pos = 0;
  const push = (buf) => { parts.push(buf); pos += buf.length; };
  push(Buffer.from('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n', 'binary'));
  const objOffsets = [];
  objs.forEach((o, i) => {
    objOffsets.push(pos);
    const num = i + 1;
    if (typeof o === 'string') {
      push(Buffer.from(`${num} 0 obj\n${o}\nendobj\n`, 'utf8'));
    } else if (o && o.dict !== undefined) {
      push(Buffer.from(`${num} 0 obj\n${o.dict}\nstream\n`, 'utf8'));
      push(o.data);
      push(Buffer.from('\nendstream\nendobj\n', 'utf8'));
    }
  });
  const xrefPos = pos;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) xref += `${String(objOffsets[i - 1]).padStart(10, '0')} 00000 n \n`;
  push(Buffer.from(xref, 'utf8'));
  push(Buffer.from(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`, 'utf8'));
  return Buffer.concat(parts);
}

// ═══════════════ 5) Public API ═══════════════
export function buildPdf(opts) {
  return buildPdfInternal(opts, getFonts());
}

export function deckToPdfBlocks(deck) {
  const blocks = [];
  for (const s of deck?.slides || []) {
    blocks.push({ type: 'h2', text: s.title || '' });
    for (const b of s?.bullets || []) blocks.push({ type: 'bullet', text: b });
    blocks.push({ type: 'gap' });
  }
  return blocks;
}

export function questionsToPdfBlocks(questions, { withAnswers = true } = {}) {
  const blocks = [];
  (questions || []).forEach((q, i) => {
    blocks.push({ type: 'text', text: `${i + 1}. ${q.text}`, bold: true });
    (q.options || []).forEach((o, j) => {
      blocks.push({ type: 'opt', text: `${String.fromCharCode(65 + j)}) ${o}`, correct: withAnswers && j === q.correctIndex });
    });
    if (withAnswers && q.explanation) blocks.push({ type: 'note', text: `Izoh: ${q.explanation}` });
    blocks.push({ type: 'gap' });
  });
  return blocks;
}
