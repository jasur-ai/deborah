import ejs from 'ejs';
import fs from 'fs';

// 1. Test head.ejs alone
console.log('1. Rendering head.ejs standalone...');
try {
  const html = await ejs.renderFile('views/partials/head.ejs', { icons: {}, siteUrl: '', path: '' });
  console.log('   OK —', html.length, 'bytes');
} catch (e) {
  console.log('   ERROR:', e.message.slice(0, 100));
}

// 2. Test vip.ejs with head stripped out
console.log('2. Compiling vip.ejs without head include...');
let src = fs.readFileSync('views/admin/vip.ejs', 'utf-8');
src = src.replace("<%- include('../partials/head') %>", '<!-- stripped head -->');
try {
  ejs.compile(src, { filename: 'views/admin/vip.ejs' });
  console.log('   OK');
} catch (e) {
  console.log('   ERROR:', e.message.slice(0, 200));
}

// 3. Find any <%- without matching %>
console.log('3. Scanning for unbalanced <%- tags...');
let depth = 0;
let problemLines = [];
src.split('\n').forEach((line, i) => {
  const opens = (line.match(/<%-/g) || []).length;
  const closes = (line.match(/%>/g) || []).length;
  depth += opens - closes;
  if (depth < 0) {
    problemLines.push(`Line ${i+1}: Extra %> (depth=${depth}): ${line.trim().slice(0, 60)}`);
    depth = 0;
  }
});
if (depth > 0) {
  console.log(`   UNBALANCED: ${depth} unclosed <%- tags`);
  // Find which lines contribute
  let d = 0;
  src.split('\n').forEach((line, i) => {
    const opens = (line.match(/<%-/g) || []).length;
    if (opens > 0 && d < depth) {
      console.log(`   Open on line ${i+1}: ${line.trim().slice(0, 80)}`);
      d += opens;
    }
  });
} else {
  console.log('   All <%- tags balanced (zero depth)');
}
