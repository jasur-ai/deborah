import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

const navCss = read('public/design/components/navigation.css');
const navJs = read('public/js/components/navigation.js');
const sidebar = read('views/partials/sidebar.ejs');
const navEjs = read('views/partials/nav.ejs');
const crumb = read('views/partials/breadcrumb.ejs');

describe('STEP 17 — Navigation components', () => {
  describe('S17.05: Active nav state', () => {
    it('active = soft fill + text weight 700 + inset indicator', () => {
      const block = navCss.match(/\.shell-nav-link\.active\s*\{([\s\S]*?)\}/)[1];
      expect(block).toMatch(/background:\s*var\(--accent-alpha/);
      expect(block).toMatch(/font-weight:\s*700/);
      expect(block).toMatch(/box-shadow:\s*inset 3px 0 0 var\(--deborah-semantic-color-action-primary\)/);
    });
    it('hover active dan farq qiladi (font-weight 600)', () => {
      const hover = navCss.match(/\.shell-nav-link:hover\s*\{([\s\S]*?)\}/)[1];
      expect(hover).toMatch(/font-weight:\s*600/);
    });
  });

  describe('S17.06/07: Mobile drawer', () => {
    it('mobile media query nav-links drawer ga o taradi', () => {
      const mq = navCss.match(/@media \(max-width:\s*768px\)([\s\S]*?)\n}/);
      expect(mq[1]).toMatch(/\.nav-links\s*\{/);
      expect(mq[1]).toMatch(/transform:\s*translateX\(100%\)/);
    });
    it('navigation.js focus trap mavjud (Tab + first/last)', () => {
      expect(navJs).toMatch(/e\.key !== 'Tab'/);
      expect(navJs).toMatch(/focusables/);
      expect(navJs).toMatch(/first\.focus\(\)/);
    });
    it('Escape yopadi', () => {
      expect(navJs).toMatch(/e\.key === 'Escape'/);
    });
    it('overlay click + trigger focus restore', () => {
      expect(navJs).toMatch(/data-shell-close/);
      expect(navJs).toMatch(/prevFocus/);
    });
    it('role viewlarda inline drawer JS yoq', () => {
      for (const r of ['student', 'teacher', 'proctor', 'marker', 'board']) {
        const v = read(`views/role/${r}.ejs`);
        expect(v, `${r}.ejs`).not.toMatch(/var b=document\.querySelector\('\[data-shell-open\]'\)/);
      }
    });
  });

  describe('S17.08: Sticky header tokens', () => {
    it('scroll-margin-top tokenlashtirilgan', () => {
      expect(navCss).toMatch(/scroll-margin-top:\s*calc\(var\(--deborah-shell-header-h/);
    });
    it('safe-area inset ishlatilgan', () => {
      expect(navCss).toMatch(/env\(safe-area-inset-bottom/);
    });
  });

  describe('S17.09: Breadcrumb', () => {
    it('partial faqat 2+ item bo lsa render', () => {
      expect(crumb).toMatch(/crumbs\.length > 1/);
    });
    it('aria-label + aria-current mavjud', () => {
      expect(crumb).toMatch(/aria-label="Yo'l \(breadcrumb\)"/);
      expect(crumb).toMatch(/aria-current/);
    });
    it('CSS .crumb class bor', () => {
      expect(navCss).toMatch(/\.crumb\b/);
    });
  });

  describe('S17.10: Keyboard tab order + skip link', () => {
    it('sidebar skip-link main-content ga', () => {
      expect(sidebar).toMatch(/href="#main-content"/);
    });
    it('focus-visible outline component da', () => {
      expect(navCss).toMatch(/:focus-visible/);
    });
  });

  describe('S17.11: Account menu', () => {
    it('shell account button + aria-expanded', () => {
      expect(sidebar).toMatch(/shell-account-btn/);
      expect(sidebar).toMatch(/aria-expanded="false"/);
    });
    it('theme grouped, logout primary emas', () => {
      expect(sidebar).toMatch(/include\('theme-control'/); // S14: headerCopy argument bilan ham mos
      expect(sidebar).toMatch(/shell-account-menu-item--logout/);
      expect(sidebar).not.toMatch(/shell-account-menu-item--logout\s*nav-btn--primary/);
    });
    it('navigation.js initAccountMenu', () => {
      expect(navJs).toMatch(/initAccountMenu/);
    });
  });

  describe('S17.02: Public nav IA', () => {
    it('Product/Teachers/Cast/Ready/Resources linklar', () => {
      // EJS interpolyatsiya orqali render — manba kodda _t() default fallback mavjud
      expect(navEjs).toMatch(/'product', 'Product'/);
      expect(navEjs).toMatch(/'teachers', 'Teachers'/);
      expect(navEjs).toMatch(/'ready', 'Ready tests'/);
      expect(navEjs).toMatch(/'resources', 'Resources'/);
      expect(navEjs).toMatch(/nav-link.*Cast/);
    });
    it('Login + CTA, Admin primary nav da yoq', () => {
      expect(navEjs).toMatch(/\/user\/login/);
      expect(navEjs).toMatch(/nav-btn--primary/);
      expect(navEjs).not.toMatch(/\/admin\/login\b/);
    });
  });
});
