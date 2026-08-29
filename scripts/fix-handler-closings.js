/**
 * Fix handler closings in socket/game-handler.js
 * 
 * For each socket.on handler wrapped with wrap(), we need to add
 * an extra closing parenthesis ) because wrap() adds one level of nesting.
 * 
 * Approach: find each "socket.on(... wrap(" line, then track the
 * brace depth from that line forward. The first time we return to
 * depth 0 at the handler's outer closing, we know it's the right line.
 */
import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('socket/game-handler.js', 'utf8');
const lines = src.split('\n');
let modified = 0;

for (let li = 0; li < lines.length; li++) {
  const line = lines[li];
  
  // Find handler registration lines with wrap(
  if (line.includes("socket.on(") && line.includes("wrap(")) {
    // Starting from this line, track brace depth
    let braceDepth = 0;
    let parenDepth = 0;
    let inString = false;
    let stringChar = null;
    
    // Count parens/braces in the registration line itself
    // socket.on('event', wrap('event', async (data) => {
    // This line already has: socket.on( 1, wrap( 2, async (data) 3, { 1
    // So we start with braceDepth=1 after processing the opening {
    
    // Actually, let's just process character by character from this line
    // to find when we return to the outermost level
    
    let foundHandlerStart = false;
    
    for (let scanLi = li; scanLi < lines.length; scanLi++) {
      const scanLine = lines[scanLi];
      
      for (let ci = 0; ci < scanLine.length; ci++) {
        const ch = scanLine[ci];
        
        if (inString) {
          if (ch === stringChar) {
            inString = false;
          }
          continue;
        }
        
        if (ch === "'" || ch === '"' || ch === '`') {
          inString = true;
          stringChar = ch;
          continue;
        }
        
        if (ch === '(') parenDepth++;
        if (ch === ')') parenDepth--;
        if (ch === '{') braceDepth++;
        if (ch === '}') braceDepth--;
      }
      
      // After processing this line, check if we've returned to start state
      // Start state: socket.on(1, wrap(2, ... async(data)(3) {1
      // Target: }0)0
      // We want the line where braceDepth=0 AND parenDepth=0
      // AND this is NOT the first line (scanLi > li)
      
      if (scanLi > li && braceDepth <= 0 && parenDepth <= 0) {
        // This is the handler's closing line
        // The line should end with '});' — add an extra ')'
        const trimmed = scanLine.trimEnd();
        if (trimmed.endsWith('});')) {
          lines[scanLi] = scanLine.replace(/\}\);$/, '}));');
          modified++;
          console.log(`  Line ${scanLi + 1}: ${trimmed.replace(/.*(\}\}\);)$/, '...$1')}`);
        }
        break; // Move to next handler
      }
    }
  }
}

if (modified) {
  writeFileSync('socket/game-handler.js', lines.join('\n'));
  console.log(`\n✅ Fixed ${modified} handler closings`);
} else {
  console.log('No changes needed');
}
