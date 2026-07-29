/**
 * Edikit — Dev Seed Script (VIP + Migration)
 * Run: node scripts/seed-dev.js
 * Adds isVip fields to existing users + creates VIP demo users
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_FILE = resolve(__dirname, '..', 'data', 'db.json');

if (!existsSync(DB_FILE)) {
  console.log('❌ data/db.json topilmadi. Avval serverni ishga tushiring.');
  process.exit(1);
}

const data = JSON.parse(readFileSync(DB_FILE, 'utf-8'));

// ── Migration: add isVip to all existing users ──
let migrated = 0;
if (data.users) {
  for (const [key, user] of Object.entries(data.users)) {
    if (user.isVip === undefined) {
      user.isVip = false;
      migrated++;
    }
  }
}

console.log(`📦 ${migrated} ta foydalanuvchiga isVip maydoni qo'shildi`);

// ── Add VIP demo users (if they exist, add isVip) ──
const vipUsers = ['sardor', 'feruza', 'shoxrux'];
let vipCount = 0;
for (const key of vipUsers) {
  if (data.users[key]) {
    const oldIsVip = data.users[key].isVip;
    data.users[key].isVip = true;
    data.users[key].vipGrantedAt = Date.now();
    data.users[key].vipGrantedBy = 'seed';
    if (!data.users[key].vipPlainPassword) {
      data.users[key].vipPlainPassword = 'vip1234';
    }
    if (!oldIsVip) vipCount++;
  }
}

console.log(`👑 ${vipCount} ta demo foydalanuvchi VIP qilindi: ${vipUsers.join(', ')}`);

// ── Write back ──
writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
console.log('✅ data/db.json yangilandi');
