#!/usr/bin/env node
/**
 * Edikit — Visual Test Server bootstrap (platform-mos)
 *
 * Playwright webServer komandasi Windows'da ishlamaydi (POSIX `rm -f`,
 * `VAR=val` sintaksisi). Bu skript toza DB + test credential'lari bilan
 * server.js'ni platform mustaqil ishga tushiradi.
 *
 * Usage: node scripts/visual-server.js [PORT]
 */

import { rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

// STEP 08: har run alohida TOZA DB — dashboard jonli raqamlar run'lararo
// o'sib, baseline'ni eskirib qoldirmasligi uchun (deterministik screenshotlar).
const dbFile = join(tmpdir(), 'edikit-visual-db.json');
rmSync(dbFile, { force: true });

process.env.LOCAL_DB_FILE = dbFile;
process.env.NODE_ENV = 'test';
process.env.SESSION_SECRET = 'ci-secret-for-testing-0123';
process.env.ADMIN_USER = 'admin';
process.env.ADMIN_PASS = 'admin';
if (process.argv[2]) process.env.PORT = process.argv[2];

const __dirname = fileURLToPath(new URL('.', import.meta.url));
// Windows: ESM loader 'D:\...' ni qabul qilmaydi — file:// URL kerak
const { createApp } = await import(pathToFileURL(join(__dirname, '..', 'server.js')).href);
const { httpServer: server } = await createApp();
const port = process.env.PORT || '3477';
server.listen(port, '0.0.0.0', () => {
  console.log(`visual-server listening on http://0.0.0.0:${port}`);
});
