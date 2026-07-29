/**
 * Edikit — Constants & Configuration
 */

// ── Cartoon Characters Registry ──
export const CARTOON_CHARS = [
  { id: 'dark-wolf', name: 'Dark Wolf', image: 'characters/dark-wolf.png', from: 'Fantasy / Original', animation: 'hover', animationStyle: 'sway 2.4s ease-in-out infinite' },
  { id: 'genral', name: 'General Kai', image: 'characters/general.png', from: 'Fantasy', animation: 'hover', animationStyle: 'sway 2.4s ease-in-out infinite' },
  { id: 'dark-blade', name: 'Dark Blade', image: 'characters/dark-blade.png', from: 'Fantasy / Original', animation: 'hover', animationStyle: 'float 2.6s ease-in-out infinite' },
  { id: 'lord-shen', name: 'Lorn Shen', image: 'characters/lord-shen.png', from: 'Fantasy', animation: 'hover', animationStyle: 'sway 2.4s ease-in-out infinite' },
  { id: 'baby-boss', name: 'Baby Boss', image: 'characters/baby-boss.svg', from: 'The Boss Baby (2017)', animation: 'always', animationStyle: 'sway 3s ease-in-out infinite' },
  { id: 'baby-boss-girl', name: 'Baby Boss Girl', image: 'characters/baby-boss-girl.svg', from: 'Family Business (2021)', animation: 'hover', animationStyle: 'sway 3.4s ease-in-out infinite' },
  { id: 'puss-in-boots', name: 'Puss in Boots', image: 'characters/puss-in-boots.svg', from: 'Shrek / DreamWorks', animation: 'hover', animationStyle: 'float 2.8s ease-in-out infinite' },
  { id: 'puss-in-boots-nailles', name: 'Puss in Boots Nailles', image: 'characters/puss-in-boots-nailles.svg', from: 'Shrek / DreamWorks', animation: 'hover', animationStyle: 'float 3.1s ease-in-out infinite' },
  { id: 'snitch', name: 'Snitch', image: 'characters/snitch.png', from: 'Disney', animation: 'hover', animationStyle: 'float 2.8s ease-in-out infinite' },
  { id: 'Tai-Lung', name: 'Tai Lung', image: 'characters/kitty-softpaws.png', from: 'Puss in Boots (2011)', animation: null, animationStyle: null },
  { id: 'tigress', name: 'Tigress', image: 'characters/tigress.png', from: 'Kung Fu Panda', animation: 'hover', animationStyle: 'sway 2.8s ease-in-out infinite' },
  { id: 'prince', name: 'Prince', image: 'characters/prince.webp', from: 'Ralph break the net', animation: 'hover', animationStyle: 'sway 2.5s ease-in-out infinite' },
  { id: 'judy-hopps', name: 'Judy Hopps', image: 'characters/judy-hopps.png', from: 'Zootopia', animation: 'hover', animationStyle: 'sway 2.5s ease-in-out infinite' },
  { id: 'nick-wilde', name: 'Nick Wilde', image: 'characters/nick-wilde.png', from: 'Zootopia', animation: 'hover', animationStyle: 'sway 3s ease-in-out infinite' },
  { id: 'wolf_bad', name: 'Mr.Wolf', image: 'characters/wolf_bad.png', from: 'Bad Guys', animation: 'hover', animationStyle: 'float 2.6s ease-in-out infinite' },
  { id: 'fox_bad', name: 'Agent Diana', image: 'characters/fox_bada$$.png', from: 'Bad Guys', animation: 'hover', animationStyle: 'float 2.6s ease-in-out infinite' },
  { id: 'white-fury', name: 'Night Fury', image: 'characters/white-fury.png', from: 'Fantasy', animation: 'hover', animationStyle: 'float 2.6s ease-in-out infinite' },
  { id: 'black-fury', name: 'Night Fury fury', image: 'characters/black-fury.png', from: 'Fantasy', animation: 'hover', animationStyle: 'float 2.6s ease-in-out infinite' },
];

// ── Answer option colors ──
export const OPT_COLORS = ['#ff4466', '#38bdf8', '#ffd60a', '#00ffaa', '#c084fc'];

// ── Option symbols ──
export const OPT_SYMBOLS = ['▲', '●', '◆', '★', '✦'];

// ── Emojis for bot players ──
export const BOT_EMOJIS = ['🦊','🐺','🦁','🐯','🦝','🐲','🦄','🦅','🐸','🦑','🤖','👾','🦸','🧙','🥷','🦈','🐙','🦉','🦩','🎭'];

// ── Admin credentials (from .env file via process.env) ──
export const ADMIN_USER = process.env.ADMIN_USER || 'admin';
export const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';

// ── Firebase paths ──
export const DB_PATHS = {
  USERS: 'users',
  GAME_SESSIONS: 'game_sessions',
  MOCK_FANS: 'mock_fans',
  PRE_GROUPS: 'pre_groups',
  RESULTS: 'results',
  PRE_AUTHOR_UID: '__pre_admin__',
};

// ── Game settings ──
export const GAME_SETTINGS = {
  TIME_OPTIONS: [10, 15, 20, 30],
  DEFAULT_TIME: 20,
  PREVIEW_COUNTDOWN: 3,
  AUTO_LB_DELAY: 5,
  LEADERBOARD_TOP: 7,
  MOCK_COUNT: 25,
  PRE_CHUNK: 25,
};

// ── Background styles ──
export const BG_STYLES = [
  '',
  'radial-gradient(ellipse at 20% 20%,#0a1628 0%,#0d2240 50%,#1a3a5c 100%)',
  'radial-gradient(ellipse at 50% 0%,#1a0020 0%,#2d003a 50%,#0a1a10 100%)'
];
