/**
 * Deborah — Playwright Visual Test Config (STYLE STEP 03)
 * -------------------------------------------------------
 * S03.01: Desktop 1440×900, small desktop 1280×800, tablet 768×1024,
 *         mobile 390×844, 320×568 projectlar.
 * S03.02: Projector uchun 1920×1080, 1280×720, 1024×768 alohida projectlar.
 * S03.06: `animations: 'disabled'` — transition/animation freeze.
 * S03.08: Screenshot nomlash {page}--{state}--{theme}--{viewport}.png.
 * S03.09: Pixel diff threshold — maxDiffPixels + threshold tolerance.
 * S03.11: Update faqat `npm run test:visual:update` orqali.
 */
import { defineConfig } from '@playwright/test';

// Noyob port — real .env credential'lar bilan ishlayotgan dev server'ini
// qayta ishlatish xavfini kamaytiradi (reuseExistingServer false).
const PORT = process.env.VISUAL_PORT || '3477';
const BASE_URL = `http://localhost:${PORT}`;

export const OUTPUT_DIR = 'design-audit/screenshots';
export const BASELINE_DIR = 'design-audit/baseline';

export const viewports = {
  desktop: { width: 1440, height: 900 },
  'small-desktop': { width: 1280, height: 800 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
  'mobile-small': { width: 320, height: 568 },
};

export const projectorViewports = {
  'projector-hd': { width: 1920, height: 1080 },
  'projector-720p': { width: 1280, height: 720 },
  'projector-xga': { width: 1024, height: 768 },
};

// S03.04 — theme contextlari
export const THEMES = {
  light: { colorScheme: 'light' },
  dark: { colorScheme: 'dark' },
  'high-contrast-light': { forcedColors: 'active', colorScheme: 'light' },
  'high-contrast-dark': { forcedColors: 'active', colorScheme: 'dark' },
  'reduced-motion': { reducedMotion: 'reduce', colorScheme: 'light' },
};

function makeProjects(prefix, entries) {
  return Object.entries(entries).map(([key, viewport]) => ({
    name: `${prefix}-${key}`,
    use: { viewport },
  }));
}

export default defineConfig({
  testDir: './tests/visual',
  // S36.01: axe accessibility audit — tests/a11y/ (WCAG 2.2 AA gate)
  testMatch: undefined,
  projects: [
    ...makeProjects('app', viewports),
    ...makeProjects('projector', projectorViewports),
    {
      name: 'a11y-audit',
      testDir: './tests/a11y',
      use: { viewport: { width: 1440, height: 900 } },
    },
    // AUTH D-14 §09: critical auth journey e2e (login/register/MFA/teacher)
    {
      name: 'auth-e2e',
      testDir: './tests/e2e/auth',
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
  outputDir: 'design-audit/test-results',
  timeout: 90000,
  fullyParallel: false, // db.json determinizm uchun workers=1 yetarli
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ['list'],
    ['json', { outputFile: 'design-audit/visual-report.json' }],
  ],
  webServer: {
    // S03.08: test-only credential fixture — .env'dagi real ADMIN_USER/PASS
    // override qilinadi; production credential hech qayerda ishlatilmaydi.
    // reuseExistingServer false — credential'lar boshqa bo'lgan server'ni
    // qayta ishlatib admin login'ni buzmaslik uchun (reviewer fix).
    // STEP 08: har run alohida TOZA DB bilan boshlanadi — dashboard'dagi
    // jonli raqamlar (sessiyalar/testlar) run'lararo o'sib, baseline'ni
    // eskirib qoldirmasligi uchun (deterministik screenshotlar).
    command: `node scripts/visual-server.js ${PORT}`,
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 60000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'off',
    screenshot: 'off',
    // PW_CHANNEL='chrome' — Windows'da o'rnatilgan Chrome ishlatiladi
    // (playwright chromium headless build mos kelmasa); default chromium (wsl/CI).
    channel: process.env.PW_CHANNEL || undefined,
    // S03.09 determinizm: font rasterizatsiyasi (hinting/LCD/subpixel) OS
    // fontconfig'ga qarab o'zgarmasligi uchun — CI va lokal bir xil render.
    // Aynan shu 1px shift + AA farqi visual baseline'larni buzardi (S11/S12).
    launchOptions: {
      args: [
        '--font-render-hinting=none',
        '--disable-lcd-text',
        '--disable-font-subpixel-positioning',
      ],
    },
  },
  // S03.08: screenshotlar design-audit/screenshots/ ga yoziladi —
  // {page}--{state}--{theme}--{viewport}.png nomi shotName() orqali.
  snapshotPathTemplate: `${OUTPUT_DIR}/{arg}{ext}`,
  // S03.10: failed diff artifact'lari outputDir'da saqlanadi (actual/diff)
  // projects: [app + projector matrixlari yuqorida S36.01 a11y-audit bilan birga]
  expect: {
    toHaveScreenshot: {
      timeout: 15000, // sekin qoldiq o'zgarishlar (font swap, kompozitsiya) stabil bo'lguncha kutiladi
      maxDiffPixels: 2000, // S03.09/S10 — anti-aliasing + glyph noise tolerance (0.15%; real layout breaks are 90%+)
      maxDiffPixelRatio: 0.004, // S10/S11 — jonli stats raqamlari glyph noise (mobile'da 0.002 chegarasi yetmaydi)
      threshold: 0.15,
      animations: 'disabled', // S03.06 — transition/animation freeze
      caret: 'hide',
    },
  },
});
