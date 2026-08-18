/**
 * AUTH A-10 — Roster import: upload + parser (P0)
 * -------------------------------------------------------------------
 * Unit qamrov:
 *  - CSV encoding: UTF-8 BOM strip + cp1251 (rus) auto-detect (guide §29)
 *  - Formula execute YO'Q — parser sandbox (guide §8)
 *  - HEMIS eksporti o'zbek/rus header'lari mapping (guide §12)
 *  - Staging retention: 24 soat purge (guide §26)
 */
import { describe, it, expect, afterEach } from 'vitest';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fb } from '../../firebase/admin.js';
import {
  detectCsvEncoding,
  decodeCsvBuffer,
  parseCsv,
  parseXlsx,
} from '../../src/modules/roster/parser.js';
import { detectColumnMapping } from '../../src/modules/roster/mapper.js';
import {
  createStagingSession,
  getStagingSession,
  deleteStagingSession,
  purgeExpiredStagingSessions,
} from '../../src/modules/roster/staging.js';

const tmpPath = () => path.join(os.tmpdir(), `a10-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);

describe('A-10 — CSV encoding (UTF-8 BOM + cp1251)', () => {
  it('UTF-8 BOM buffer → utf-8', () => {
    const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('a,b\n1,2')]);
    expect(detectCsvEncoding(buf)).toBe('utf-8');
  });

  it('cp1251 (rus) buffer → cp1251', () => {
    // "Алё,2" windows-1251 da: А=0xC0, л=0xEB, ё=0xB8, ','=0x2C, '2'=0x32
    const buf = Buffer.from([0xC0, 0xEB, 0xB8, 0x2C, 0x32]);
    expect(detectCsvEncoding(buf)).toBe('cp1251');
  });

  it('ASCII/UTF-8 buffer → utf-8', () => {
    expect(detectCsvEncoding(Buffer.from('hello,world\n1,2'))).toBe('utf-8');
  });

  it('decodeCsvBuffer — UTF-8 BOM strip qiladi', () => {
    const buf = Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('a,b\n1,2')]);
    const { text, encoding } = decodeCsvBuffer(buf, 'auto');
    expect(encoding).toBe('utf-8');
    expect(text).toBe('a,b\n1,2');
    expect(text.charCodeAt(0)).toBe(97); // BOM emas, 'a'
  });

  it('decodeCsvBuffer — cp1251 aniq ko\'rsatilganda', () => {
    const { text, encoding } = decodeCsvBuffer(Buffer.from([0xC0, 0xEB, 0xB8]), 'cp1251');
    expect(encoding).toBe('cp1251');
    expect(text).toBe('Алё');
  });

  it('parseCsv — UTF-8 BOM fayl toza parse qilinadi', () => {
    const p = tmpPath() + '.csv';
    fs.writeFileSync(p, Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from('ism,fan\nAli,MATH101')]));
    const r = parseCsv(p);
    fs.unlinkSync(p);
    expect(r.errors.length).toBe(0);
    expect(r.sheets[0].headers).toContain('ism');
    expect(r.sheets[0].rows[0].data['ism']).toBe('Ali');
  });

  it('parseCsv — cp1251 (rus) fayl toza parse qilinadi', () => {
    // "Имя,Дисциплина\nАлё,MATH101" → windows-1251 baytlari
    // Д=0xC4 и=0xE8 с=0xF1 ц=0xF6 и=0xE8 п=0xEF л=0xEB и=0xE8 н=0xED а=0xE0
    const p = tmpPath() + '.csv';
    const cp1251 = Buffer.from([
      0xC8, 0xEC, 0xFF, 0x2C, 0xC4, 0xE8, 0xF1, 0xF6, 0xE8, 0xEF, 0xEB, 0xE8, 0xED, 0xE0, 0x0A,
      0xC0, 0xEB, 0xB8, 0x2C, 0x4D, 0x41, 0x54, 0x48, 0x31, 0x30, 0x31,
    ]);
    fs.writeFileSync(p, cp1251);
    const r = parseCsv(p); // encoding 'auto' — cp1251 aniqlanadi
    fs.unlinkSync(p);
    expect(r.errors.length).toBe(0);
    expect(r.sheets[0].headers).toContain('Имя');
    expect(r.sheets[0].headers).toContain('Дисциплина');
    expect(r.sheets[0].rows[0].data['Имя']).toBe('Алё');
    expect(r.sheets[0].rows[0].data['Дисциплина']).toBe('MATH101');
  });
});

describe('A-10 — formula execute YO\'Q (parser sandbox)', () => {
  it('XLSX formula qiymati o\'qilmaydi (execute/cached natija yo\'q)', () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([['A', 'B'], [1, '=2+3']]);
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const p = tmpPath() + '.xlsx';
    XLSX.writeFile(wb, p);

    const r = parseXlsx(p);
    fs.unlinkSync(p);

    expect(r.errors.length).toBe(0);
    const row = r.sheets[0].rows[0];
    expect(row.data['A']).toBe('1');
    // Formula natijasi ("5") oqib chiqmasligi kerak — cellFormula:false sandbox
    expect(String(row.data['B'] || '')).not.toBe('5');
  });

  it('haqiqiy formula (f) execute qilinmaydi — natija oqmaydi', () => {
    const wb = XLSX.utils.book_new();
    const ws = {};
    ws['!ref'] = 'A1:B2';
    ws.A1 = { t: 's', v: 'A' };
    ws.B1 = { t: 's', v: 'B' };
    ws.A2 = { t: 'n', f: '=1+1' }; // formula — cached value yo'q
    ws.B2 = { t: 's', v: 'x' };   // real qiymat — qator mavjud bo'ladi
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    const p = tmpPath() + '.xlsx';
    XLSX.writeFile(wb, p);

    const r = parseXlsx(p);
    fs.unlinkSync(p);
    expect(r.errors.length).toBe(0);
    const row = r.sheets[0].rows[0];
    expect(row.data['B']).toBe('x');
    // cellFormula:false sandbox — formula execute qilinmaydi, '2' oqmaydi
    expect(String(row.data['A'] || '')).not.toBe('2');
    expect(String(row.data['A'] || '')).toBe('');
  });
});

describe('A-10 — HEMIS header mapping (o\'zbek/rus)', () => {
  it('o\'zbekcha HEMIS headerlari avtomatik map bo\'ladi', async () => {
    const rows = [{
      rowIndex: 2,
      data: {
        talaba_id: '001', 'F.I.Sh': 'Aliyev Ali', guruh: 'A',
        kurs: '2026', fan: 'MATH101', fakultet: 'PED', yonalish: '6110100',
      },
    }];
    const r = await detectColumnMapping(rows);
    expect(r.unmapped.length).toBe(0);
    expect(r.mapping.talaba_id.field).toBe('userId');
    expect(r.mapping['F.I.Sh'].field).toBe('displayName'); // normalizatsiya: f_i_sh
    expect(r.mapping.guruh.field).toBe('groupName');
    expect(r.mapping.kurs.field).toBe('termCode');
    expect(r.mapping.fan.field).toBe('courseCode');
    expect(r.mapping.fakultet.field).toBe('facultyCode');
    expect(r.mapping.yonalish.field).toBe('programCode');
  });

  it('ruscha HEMIS headerlari map bo\'ladi', async () => {
    const rows = [{
      rowIndex: 2,
      data: { Фамилия: 'Алиев', Имя: 'Али', Группа: 'A', Курс: '2026', Дисциплина: 'MATH101' },
    }];
    const r = await detectColumnMapping(rows);
    expect(r.mapping['Фамилия'].field).toBe('lastName');
    expect(r.mapping['Имя'].field).toBe('firstName');
    expect(r.mapping['Группа'].field).toBe('groupName');
    expect(r.mapping['Дисциплина'].field).toBe('courseCode');
  });
});

describe('A-10 — staging retention purge (24 soat)', () => {
  let ids = [];

  afterEach(async () => {
    for (const id of ids) {
      const snap = await fb.get(`roster_staging/${id}`);
      if (snap.exists()) await deleteStagingSession(id);
    }
    ids = [];
  });

  it('muddati o\'tgan staging sessiya o\'chiriladi, yangi qoladi', async () => {
    const oldId = await createStagingSession({
      filename: 'old.xlsx', extension: '.xlsx', fileSize: 10,
      uploadedBy: 'admin', totalRows: 1, totalSheets: 1, warnings: [],
    });
    const freshId = await createStagingSession({
      filename: 'fresh.xlsx', extension: '.xlsx', fileSize: 10,
      uploadedBy: 'admin', totalRows: 1, totalSheets: 1, warnings: [],
    });
    ids = [oldId, freshId];

    // Old sessiyani 25 soat orqaga suramiz (retention 24h)
    await fb.set(`roster_staging/${oldId}/updatedAt`, Date.now() - 25 * 60 * 60 * 1000);
    await fb.set(`roster_staging/${oldId}/createdAt`, Date.now() - 25 * 60 * 60 * 1000);

    const result = await purgeExpiredStagingSessions();
    expect(result.ok).toBe(true);
    expect(result.purged).toBeGreaterThanOrEqual(1);

    expect(await getStagingSession(oldId)).toBeNull();
    expect(await getStagingSession(freshId)).not.toBeNull();
    ids = [freshId]; // old allaqachon o'chgan
  });

  it('committed sessiya purge qilinmaydi (tarix saqlanadi)', async () => {
    const id = await createStagingSession({
      filename: 'c.xlsx', extension: '.xlsx', fileSize: 10,
      uploadedBy: 'admin', totalRows: 1, totalSheets: 1, warnings: [],
    });
    ids = [id];
    await fb.set(`roster_staging/${id}/status`, 'committed');
    await fb.set(`roster_staging/${id}/updatedAt`, Date.now() - 25 * 60 * 60 * 1000);

    const result = await purgeExpiredStagingSessions();
    expect(result.purged).toBe(0);
    expect(await getStagingSession(id)).not.toBeNull();
  });
});
