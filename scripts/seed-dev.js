#!/usr/bin/env node

/**
 * Edikit — Development Seed Script
 * Seeds local database with sample data for testing
 * Usage: node scripts/seed-dev.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

async function seed() {
  console.log('\n🌱 Edikit — Development Seed\n');
  console.log('Seeding database with sample data...\n');

  try {
    // Load seed data
    const { seedData } = await import('../firebase/seed-data.js');
    const results = await seedData();
    
    console.log('✅ Seed complete!');
    console.log(`   Users: ${results?.users || 0}`);
    console.log(`   Tests: ${results?.tests || 0}`);
    console.log(`   Fans:  ${results?.fans || 0}`);
    console.log(`   PRE:   ${results?.pre || 0}`);
    console.log(`   Games: ${results?.games || 0}\n`);

    console.log('   🔐 Admin: admin / admin');
    console.log('   👤 User:  user / user\n');
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  }
}

seed();
