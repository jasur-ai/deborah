/**
 * Script to apply Prompt 08 changes to socket/game-handler.js
 * 
 * Changes:
 * 1. Add identity parameter to setupSocketHandlers
 * 2. Add requireOwnership helper using identity.checkOwnership
 * 3. host:create — create host grant
 * 4. host:start/next/forceNext/end — use requireOwnership
 * 5. arena:botAnswer — add owner check
 * 6. arena:watch — sanitize for public
 * 7. endGame — revoke host grant
 */
import { readFileSync, writeFileSync } from 'fs';

const src = readFileSync('socket/game-handler.js', 'utf8');
let code = src;

let changes = 0;

// 1. Update function signature
const oldSig = `export function setupSocketHandlers(io, socket, rateLimiter) {
  const rl = rateLimiter || null; // Optional rate limiter
  const wrap = (event, handler) => rl ? rl.wrap(event, handler) : handler;
  const log = (...args) => console.log(\`[Socket \${socket.id.slice(0, 8)}]\`, ...args);`;

const newSig = `export function setupSocketHandlers(io, socket, rateLimiter, identity) {
  const rl = rateLimiter || null; // Optional rate limiter
  const wrap = (event, handler) => rl ? rl.wrap(event, handler) : handler;
  const log = (...args) => console.log(\`[Socket \${socket.id.slice(0, 8)}]\`, ...args);

  // ABAC ownership check — uses identity middleware + host grant
  async function requireOwnership(code) {
    if (identity && typeof identity.checkOwnership === 'function') {
      const result = await identity.checkOwnership(socket, code);
      if (!result.authorized) {
        socket.emit('error', { message: result.reason || 'Siz bu o\'yinni boshqara olmaysiz' });
        return false;
      }
      return true;
    }
    // Fallback: legacy socket.data check
    if (socket.data.role === 'host' && socket.data.code === code) return true;
    socket.emit('error', { message: 'Siz bu o\'yinni boshqara olmaysiz' });
    return false;
  }`;

if (code.includes(oldSig)) {
  code = code.replace(oldSig, newSig);
  changes++;
  console.log('1. Updated function signature ✅');
} else {
  console.log('1. Function signature NOT FOUND ❌');
}

// 2. host:create — add host grant creation
const hostCreateGrantAdd = `      await fb.set(\`game_sessions/\${code}\`, sessionData);

      socket.join(\`game:\${code}\`);
      socket.data.code = code;
      socket.data.role = 'host';

      log(\`Host created game: \${code}\`);
      socket.emit('host:created', { code, session: sessionData });`;

const hostCreateGrantNew = `      await fb.set(\`game_sessions/\${code}\`, sessionData);

      // Create persistent host grant for reconnect
      let hostTicket = null;
      if (identity && typeof identity.createHostGrant === 'function') {
        const grant = await identity.createHostGrant(code, hostName || 'Host');
        hostTicket = grant.ticket;
      }

      socket.join(\`game:\${code}\`);
      socket.data.code = code;
      socket.data.role = 'host';

      log(\`Host created game: \${code}\`);
      socket.emit('host:created', { code, session: sessionData, hostTicket });`;

if (code.includes(hostCreateGrantAdd)) {
  code = code.replace(hostCreateGrantAdd, hostCreateGrantNew);
  changes++;
  console.log('2. host:create — host grant ✅');
} else {
  console.log('2. host:create grant NOT FOUND ❌');
}

// 3. host:start — use requireOwnership
const hostStartCheck = `  socket.on('host:start', wrap('host:start', async (data) => {
    try {
      const { code } = data;
      // Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\\'yinni boshqara olmaysiz' });
      }

      const snap = await fb.get(\`game_sessions/\${code}\`);`;

const hostStartNew = `  socket.on('host:start', wrap('host:start', async (data) => {
    try {
      const { code } = data;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      const snap = await fb.get(\`game_sessions/\${code}\`);`;

if (code.includes(hostStartCheck)) {
  code = code.replace(hostStartCheck, hostStartNew);
  changes++;
  console.log('3. host:start — ABAC ✅');
} else {
  console.log('3. host:start NOT FOUND ❌');
}

// 4. host:next — use requireOwnership
const hostNextCheck = `  socket.on('host:next', wrap('host:next', async (data) => {
    try {
      const { code, currentIndex } = data;
      // Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\\'yinni boshqara olmaysiz' });
      }

      const snap = await fb.get(\`game_sessions/\${code}\`);`;

const hostNextNew = `  socket.on('host:next', wrap('host:next', async (data) => {
    try {
      const { code, currentIndex } = data;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      const snap = await fb.get(\`game_sessions/\${code}\`);`;

if (code.includes(hostNextCheck)) {
  code = code.replace(hostNextCheck, hostNextNew);
  changes++;
  console.log('4. host:next — ABAC ✅');
} else {
  console.log('4. host:next NOT FOUND ❌');
}

// 5. host:forceNext — use requireOwnership
const hostForceCheck = `  socket.on('host:forceNext', wrap('host:forceNext', async (data) => {
    try {
      const { code } = data;
      // Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\\'yinni boshqara olmaysiz' });
      }

      const timers = activeTimers.get(code);`;

const hostForceNew = `  socket.on('host:forceNext', wrap('host:forceNext', async (data) => {
    try {
      const { code } = data;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      const timers = activeTimers.get(code);`;

if (code.includes(hostForceCheck)) {
  code = code.replace(hostForceCheck, hostForceNew);
  changes++;
  console.log('5. host:forceNext — ABAC ✅');
} else {
  console.log('5. host:forceNext NOT FOUND ❌');
}

// 6. host:end — use requireOwnership
const hostEndCheck = `  socket.on('host:end', wrap('host:end', async (data) => {
    try {
      const { code } = data;
      // Ownership check
      if (socket.data.role !== 'host' || socket.data.code !== code) {
        return socket.emit('error', { message: 'Siz bu o\\'yinni boshqara olmaysiz' });
      }

      const timers = activeTimers.get(code);`;

const hostEndNew = `  socket.on('host:end', wrap('host:end', async (data) => {
    try {
      const { code } = data;
      // ABAC ownership check
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;

      const timers = activeTimers.get(code);`;

if (code.includes(hostEndCheck)) {
  code = code.replace(hostEndCheck, hostEndNew);
  changes++;
  console.log('6. host:end — ABAC ✅');
} else {
  console.log('6. host:end NOT FOUND ❌');
}

// 7. arena:watch — sanitize for public
const arenaWatchCheck = `  socket.on('arena:watch', wrap('arena:watch', async (data) => {
    try {
      const { code } = data;
      if (!code) return;
      
      socket.join(\`game:\${code}\`);
      
      // Send current state immediately
      const snap = await fb.get(\`game_sessions/\${code}/state\`);
      if (snap.exists()) {
        socket.emit('arena:stateUpdate', { state: snap.val() });
      }
    } catch (err) {
      log('Arena watch error:', err.message);
    }
  }));`;

const arenaWatchNew = `  socket.on('arena:watch', wrap('arena:watch', async (data) => {
    try {
      const { code } = data;
      if (!code) return;
      
      // Mark socket as watcher (read-only)
      socket.data.role = 'watcher';
      
      // Don't join game:code room — watchers get sanitized events
      // Instead, join a separate watcher room
      socket.join(\`watch:\${code}\`);
      
      // Send sanitized state (no answer key, no question details)
      const snap = await fb.get(\`game_sessions/\${code}/state\`);
      if (snap.exists()) {
        const raw = snap.val();
        // Public watchers only get: status, q_count, player_count, time
        socket.emit('arena:stateUpdate', {
          state: {
            status: raw.status,
            q_index: raw.q_index,
            q_time: raw.q_time,
            q_started_at: raw.q_started_at,
            // EXCLUDED: q_text, q_options, q_correct, q_is_double
            // EXCLUDED: leaderboard (player names)
          },
        });
      }
      
      // Send player count
      const playersSnap = await fb.get(\`game_sessions/\${code}/players\`);
      if (playersSnap.exists()) {
        const playerCount = Object.keys(playersSnap.val()).length;
        socket.emit('arena:playerCount', { count: playerCount });
      }
    } catch (err) {
      log('Arena watch error:', err.message);
    }
  }));`;

if (code.includes(arenaWatchCheck)) {
  code = code.replace(arenaWatchCheck, arenaWatchNew);
  changes++;
  console.log('7. arena:watch — sanitized ✅');
} else {
  console.log('7. arena:watch NOT FOUND ❌');
}

// 8. arena:botAnswer — add owner-only check
const arenaBotCheck = `  socket.on('arena:botAnswer', wrap('arena:botAnswer', async (data) => {
    try {
      const { code, qIndex, playerName, optionIndex } = data;
      if (!code || !playerName) return;
      if (!socket.rooms?.has(\`game:\${code}\`)) return;`;

const arenaBotNew = `  socket.on('arena:botAnswer', wrap('arena:botAnswer', async (data) => {
    try {
      const { code, qIndex, playerName, optionIndex } = data;
      if (!code || !playerName) return;
      // Owner-only: only the host can add bot answers
      const isOwner = await requireOwnership(code);
      if (!isOwner) return;`;

if (code.includes(arenaBotCheck)) {
  code = code.replace(arenaBotCheck, arenaBotNew);
  changes++;
  console.log('8. arena:botAnswer — owner-only ✅');
} else {
  console.log('8. arena:botAnswer NOT FOUND ❌');
}

// 9. endGame — revoke host grant
const endGameRevoke = `    await fb.set(\`results/\${code}\`, {
      test_name: session?.test_name || 'Test',
      host: session?.host || '',
      date: Date.now(),
      totalPlayers: allSorted.length,
      leaderboard: top7,
    });

    await fb.update(\`game_sessions/\${code}/state\`, {`;

const endGameRevokeNew = `    // Revoke host grant on game end
    if (identity && typeof identity.revokeHostGrant === 'function') {
      await identity.revokeHostGrant(code);
    }

    await fb.set(\`results/\${code}\`, {
      test_name: session?.test_name || 'Test',
      host: session?.host || '',
      date: Date.now(),
      totalPlayers: allSorted.length,
      leaderboard: top7,
    });

    await fb.update(\`game_sessions/\${code}/state\`, {`;

if (code.includes(endGameRevoke)) {
  code = code.replace(endGameRevoke, endGameRevokeNew);
  changes++;
  console.log('9. endGame — revoke grant ✅');
} else {
  console.log('9. endGame NOT FOUND ❌');
}

writeFileSync('socket/game-handler.js', code);
console.log(`\n✅ Applied ${changes}/9 changes to socket/game-handler.js`);
