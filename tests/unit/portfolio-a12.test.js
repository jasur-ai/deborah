/**
 * AUTH A-12 — Transkript/portfolio import (P1)
 * -------------------------------------------------------------------
 * Unit qamrov (guide A-12 §20):
 *  - PDF parse xavfsiz: magic bytes, yolg'on/malicious PDF rad etiladi
 *  - PDF transcript qatorlari mapping (semestr/fan/baho/kredit, uz+rus)
 *  - Excel HEMIS mapping (o'zbek/rus ustunlar) — A-10 parser qayta ishlatiladi
 *  - PDF eksport builder — haqiqiy PDF (header/xref/%%EOF, faqat matn)
 *  - Privacy: har item default-private; IDOR (boshqa user item'iga kirish)
 *  - Share grant: private item share'lanmaydi; token faqat hash; revoke/expire
 *  - Import: consent talab; idempotent (duplikat skip)
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fb } from '../../firebase/admin.js';
import {
  parseTranscriptFile,
  parsePdfText,
  pdfLinesToItems,
  mapExcelRowToItem,
  PortfolioImportError,
} from '../../src/modules/portfolio/transcript.parser.js';
import { buildTranscriptPdf, toAscii } from '../../src/modules/portfolio/transcript.pdf.js';
import {
  addItem,
  listItems,
  setVisibility,
  createShareGrant,
  revokeShareGrant,
  resolveShareToken,
  importTranscript,
  exportTranscriptRows,
  buildUserTranscriptPdf,
  deleteItem,
} from '../../src/modules/portfolio/index.js';

const tmpPath = () => path.join(os.tmpdir(), `a12-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

async function resetPortfolio() {
  await fb.set('portfolio_items', {});
  await fb.set('portfolio_profiles', {});
  await fb.set('portfolio_share_grants', {});
}

beforeAll(async () => { await resetPortfolio(); }, 30000);
afterAll(async () => { await resetPortfolio(); });

function writeTmpXlsx(rows) {
  const p = tmpPath() + '.xlsx';
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, 'Transkript');
  XLSX.writeFile(wb, p);
  return p;
}

/** Minimal hand-made PDF with one text line per Tj (no fonts embedded). */
function makeMinimalPdf(lines) {
  const content = lines.map((l) => `BT /F1 10 Tf 50 ${800 - lines.indexOf(l) * 16} Td (${l}) Tj ET`).join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objs.length; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

describe('A-12 — ASCII transliteration + PDF builder (§13)', () => {
  it('toAscii: uz-lotin + kirill → ASCII', () => {
    expect(toAscii("O'zbekiston ta'limi")).toMatch(/O'zbekiston/);
    expect(toAscii('Математика')).toBe('Matematika');
    expect(toAscii('Физика')).toBe('Fizika');
    expect(toAscii('—')).toBe('-');
  });

  it('buildTranscriptPdf — haqiqiy PDF (header, pages, xref, EOF, faqat matn)', () => {
    const buf = buildTranscriptPdf({
      rows: [
        { semester: '1', subject: "Oliy matematika", grade: '5', credit: '4' },
        { semester: '1', subject: 'Fizika', grade: '4', credit: '3' },
      ],
      studentName: 'Aliyev Ali',
    });
    const s = buf.toString('latin1');
    expect(s.startsWith('%PDF-1.4')).toBe(true);
    expect(s).toContain('/Type /Page');
    expect(s).toContain('/Type /Catalog');
    expect(s).toContain('startxref');
    expect(s.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(s).toContain('Oliy matematika');
    expect(s).toContain('Aliyev Ali');
    // Font ob'yektlari to'g'ri: /F1 3 0 R /F2 4 0 R → 3/4 ob'yektlar font dict
    expect(s).toContain('/F1 3 0 R /F2 4 0 R');
    const obj3 = s.match(/3 0 obj\n<<([^>]*)>>/);
    expect(obj3 && obj3[1]).toContain('/BaseFont /Helvetica');
    const obj4 = s.match(/4 0 obj\n<<([^>]*)>>/);
    expect(obj4 && obj4[1]).toContain('/BaseFont /Helvetica-Bold');
    // Xavfsizlik: skript/attachments yo'q
    expect(s).not.toContain('/JavaScript');
    expect(s).not.toContain('/AA');
    expect(s).not.toContain('/EmbeddedFile');
  });
});

describe('A-12 — PDF matn → transcript qatorlari (§08)', () => {
  it('semestr header + fan/baho/kredit qatorlarini aniqlaydi', () => {
    const text = 'Semestr 1\nOliy matematika 5 4\nFizika 4 3\nSemestr 2\nDasturlash 5 5';
    const items = pdfLinesToItems(text);
    expect(items.length).toBe(3);
    expect(items[0].evidence.subject).toBe('Oliy matematika');
    expect(items[0].evidence.grade).toBe('5');
    expect(items[0].evidence.credit).toBe('4');
    expect(items[0].evidence.semester).toBe('1');
    expect(items[2].evidence.semester).toBe('2');
    expect(items.every((i) => i.kind === 'result')).toBe(true);
  });

  it('ruscha semestr/qatorlarni aniqlaydi', () => {
    const text = '1-семестр\nМатематика 4 2\nФизика 3 1';
    const items = pdfLinesToItems(text);
    expect(items.length).toBe(2);
    expect(items[0].evidence.grade).toBe('4');
    expect(items[0].evidence.credit).toBe('2');
    expect(items[0].evidence.semester).toBe('1');
  });

  it('noise qatorlar (headerlar, imzolar) o\'tkazib yuboriladi', () => {
    const text = 'Oliy matematika 5 4\nBaho\nF.I.Sh: Aliyev Ali\nRektor imzosi';
    const items = pdfLinesToItems(text);
    expect(items.length).toBe(1);
    expect(items[0].evidence.subject).toBe('Oliy matematika');
  });
});

describe('A-12 — PDF parse xavfsizlik (§08, §17, §29)', () => {
  it('yolg\'on PDF (magic bytes yo\'q) → invalid_pdf', async () => {
    const p = tmpPath() + '.pdf';
    fs.writeFileSync(p, Buffer.from('PK\x03\x04not a pdf at all'));
    await expect(parseTranscriptFile(p, '.pdf')).rejects.toBeInstanceOf(PortfolioImportError);
    await expect(parseTranscriptFile(p, '.pdf')).rejects.toMatchObject({ code: 'invalid_pdf' });
  });

  it('PDF magic bytes bor, lekin buzilgan → pdf_parse_error (xavfsiz)', async () => {
    const p = tmpPath() + '.pdf';
    fs.writeFileSync(p, Buffer.from('%PDF-1.4\n%%%%% garbage streams'));
    await expect(parsePdfText(p)).rejects.toMatchObject({ code: 'pdf_parse_error' });
  });

  it('qo\'llab-quvvatlanmaydigan kengaytma → unsupported_format', async () => {
    const p = tmpPath() + '.doc';
    fs.writeFileSync(p, Buffer.from('hello'));
    await expect(parseTranscriptFile(p, '.doc')).rejects.toMatchObject({ code: 'unsupported_format' });
  });

  it('juda katta fayl → file_too_large', async () => {
    const p = tmpPath() + '.xlsx';
    fs.writeFileSync(p, Buffer.alloc(9 * 1024 * 1024, 0x41));
    await expect(parseTranscriptFile(p, '.xlsx')).rejects.toMatchObject({ code: 'file_too_large' });
  });

  it('haqiqiy (minimal) PDF matni parse qilinadi', async () => {
    const p = tmpPath() + '.pdf';
    fs.writeFileSync(p, makeMinimalPdf(['Semestr 1', 'Oliy matematika 5 4', 'Fizika 4 3']));
    const { items, warnings } = await parseTranscriptFile(p, '.pdf');
    expect(items.length).toBeGreaterThan(0);
    expect(warnings.length).toBe(0);
  });
});

describe('A-12 — Excel HEMIS mapping (§09, §12)', () => {
  it('o\'zbekcha HEMIS ustunlari (fan, baho, kredit, semestr)', async () => {
    const p = writeTmpXlsx([
      ['fan', 'baho', 'kredit', 'semestr'],
      ['Oliy matematika', 5, 4, 1],
      ['Fizika', 4, 3, 1],
    ]);
    const { items, warnings } = await parseTranscriptFile(p, '.xlsx');
    expect(warnings.length).toBe(0);
    expect(items.length).toBe(2);
    expect(items[0].evidence.subject).toBe('Oliy matematika');
    expect(items[0].evidence.grade).toBe('5');
    expect(items[0].evidence.credit).toBe('4');
    expect(items[0].evidence.semester).toBe('1');
  });

  it('ruscha ustunlar (Дисциплина, Оценка, Кредит, Семестр)', async () => {
    const p = writeTmpXlsx([
      ['Дисциплина', 'Оценка', 'Кредит', 'Семестр'],
      ['Математика', 4, 2, 1],
    ]);
    const { items } = await parseTranscriptFile(p, '.xlsx');
    expect(items.length).toBe(1);
    expect(items[0].evidence.subject).toBe('Математика');
    expect(items[0].evidence.grade).toBe('4');
    expect(items[0].evidence.credit).toBe('2');
  });

  it('formula hujum bloklanadi (fanga =1+1 yozilmaydi)', () => {
    const item = mapExcelRowToItem({ fan: '=1+1', baho: 5 });
    expect(item).toBeNull();
  });

  it('subject bo\'lmasa → null (skip)', () => {
    const item = mapExcelRowToItem({ izoh: 'foo', sana: '2026' });
    expect(item).toBeNull();
  });
});

describe('A-12 — Privacy va IDOR (§07, §12, §17)', () => {
  it('yangi item har doim default-private', async () => {
    const r = await addItem({ userId: 'u1', kind: 'result', title: 'Matematika', evidence: { subject: 'Matematika', grade: '5' } });
    expect(r.ok).toBe(true);
    const { items } = await listItems({ userId: 'u1' });
    expect(items[0].visibility).toBe('private');
  });

  it('IDOR: boshqa user item visibility\'sini o\'zgartira olmaydi', async () => {
    const { itemId } = await addItem({ userId: 'u1', kind: 'result', title: 'Fizika', evidence: { subject: 'Fizika' } });
    const r = await setVisibility({ userId: 'u2', itemId, visibility: 'public' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('forbidden');
    const r2 = await deleteItem({ userId: 'u2', itemId });
    expect(r2.code).toBe('forbidden');
    // owner o'zi o'zgartira oladi
    const own = await setVisibility({ userId: 'u1', itemId, visibility: 'public' });
    expect(own.ok).toBe(true);
  });
});

describe('A-12 — Share grant (§12)', () => {
  it('private item share qilib bo\'lmaydi', async () => {
    const { itemId } = await addItem({ userId: 'u1', kind: 'credential', title: 'Sertifikat' });
    const r = await createShareGrant({ userId: 'u1', itemId });
    expect(r.ok).toBe(false);
  });

  it('shared/public item → token; resolve; revoke → invalid; IDOR revoke 403', async () => {
    const { itemId } = await addItem({ userId: 'u1', kind: 'result', title: 'Algoritmlar', evidence: { subject: 'Algoritmlar', grade: '5', credit: '5', semester: '2' } });
    await setVisibility({ userId: 'u1', itemId, visibility: 'shared' });
    const r = await createShareGrant({ userId: 'u1', itemId });
    expect(r.ok).toBe(true);
    expect(r.token.length).toBeGreaterThanOrEqual(48);

    const view = await resolveShareToken({ token: r.token });
    expect(view.ok).toBe(true);
    expect(view.item.title).toBe('Algoritmlar');
    expect(view.item.evidence.subject).toBe('Algoritmlar');

    // boshqa user revoke qila olmaydi (IDOR)
    const bad = await revokeShareGrant({ userId: 'u2', grantId: r.grant.id });
    expect(bad.code).toBe('forbidden');

    const ok = await revokeShareGrant({ userId: 'u1', grantId: r.grant.id });
    expect(ok.ok).toBe(true);
    const after = await resolveShareToken({ token: r.token });
    expect(after.ok).toBe(false);
  });

  it('expired grant → share link ishlamaydi', async () => {
    const { itemId } = await addItem({ userId: 'u1', kind: 'result', title: 'Tarix', evidence: { subject: 'Tarix' } });
    await setVisibility({ userId: 'u1', itemId, visibility: 'public' });
    const r = await createShareGrant({ userId: 'u1', itemId, expiresAt: Date.now() - 1000 });
    expect(r.ok).toBe(true);
    const view = await resolveShareToken({ token: r.token });
    expect(view.ok).toBe(false);
    expect(view.error).toMatch(/expired/);
  });

  it('viewer-email cheklangan grant', async () => {
    const { itemId } = await addItem({ userId: 'u1', kind: 'result', title: 'Ingliz tili', evidence: { subject: 'Ingliz tili' } });
    await setVisibility({ userId: 'u1', itemId, visibility: 'shared' });
    const r = await createShareGrant({ userId: 'u1', itemId, viewerEmail: 'viewer@example.com' });
    const wrong = await resolveShareToken({ token: r.token, viewerEmail: 'other@example.com' });
    expect(wrong.ok).toBe(false);
    const right = await resolveShareToken({ token: r.token, viewerEmail: 'viewer@example.com' });
    expect(right.ok).toBe(true);
  });
});

describe('A-12 — Import: consent + idempotency (§11, §18)', () => {
  it('consent bo\'lmasa → consent_required', async () => {
    const p = writeTmpXlsx([['fan', 'baho', 'kredit'], ['Matematika', 5, 4]]);
    const r = await importTranscript({ userId: 'u1', filePath: p, extension: '.xlsx', consent: false });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('consent_required');
  });

  it('consent bilan import → itemlar yaratiladi, 2-chi import duplikat skip qiladi', async () => {
    const p = writeTmpXlsx([
      ['fan', 'baho', 'kredit', 'semestr'],
      ['Matematika', 5, 4, 1],
      ['Fizika', 4, 3, 1],
    ]);
    const r1 = await importTranscript({ userId: 'u1', filePath: p, extension: '.xlsx', consent: true });
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(2);
    expect(r1.items.every((i) => i.visibility === 'private')).toBe(true); // default-private

    const r2 = await importTranscript({ userId: 'u1', filePath: p, extension: '.xlsx', consent: true });
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(2); // idempotent
  });
});

describe('A-12 — Export (§13)', () => {
  it('exportTranscriptRows + buildUserTranscriptPdf → PDF', async () => {
    const rows = await exportTranscriptRows({ userId: 'u1' });
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const { buffer, filename } = await buildUserTranscriptPdf({ userId: 'u1', displayName: 'Aliyev Ali' });
    expect(filename).toMatch(/\.pdf$/);
    expect(buffer.toString('latin1').startsWith('%PDF-1.4')).toBe(true);
  });
});
