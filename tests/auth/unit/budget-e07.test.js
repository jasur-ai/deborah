/**
 * AUTH E-07 — Email budget (P2 upgrade): dynamic alert + monthly report + config UI
 * ---------------------------------------------------------------------------------
 *  - getBudgetConfig: env default → DB (admin set) ustun; 60s TTL cache
 *  - setBudgetConfig: validatsiya (1..100000), audit EMAIL_BUDGET_CONFIG, cache invalidate
 *  - budgetStatus: ok | warn (>=80%) | exceeded (>=100%), pct
 *  - monthlyReportCsv: header + oy/provider qatorlari
 *  - markBudgetAlert: idempotent (oyiga bir marta audit)
 *  - recordEmailCost (provider.js): budget DB'dan o'qiladi, 80% warn + 100% exceeded
 *    audit bir martadan (spam yo'q), fail-soft saqlanadi
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const testStore = {};

vi.mock('../../../firebase/admin.js', () => {
  function navigate(store, path) {
    const parts = path.split('/').filter(Boolean);
    let current = store;
    for (let i = 0; i < parts.length; i++) {
      if (current === null || typeof current !== 'object' || !(parts[i] in current))
        return { found: false, parent: current, key: parts[i] };
      if (i === parts.length - 1) return { found: true, value: current[parts[i]], parent: current, key: parts[i] };
      current = current[parts[i]];
    }
    return { found: true, value: current, parent: null, key: null };
  }
  function setAt(store, path, value) {
    const parts = path.split('/').filter(Boolean);
    let cur = store;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in cur) || typeof cur[parts[i]] !== 'object') cur[parts[i]] = {};
      cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = JSON.parse(JSON.stringify(value));
  }
  return {
    fb: {
      get: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        return { exists: () => r.found, val: () => (r.found ? JSON.parse(JSON.stringify(r.value)) : null) };
      }),
      set: vi.fn(async (path, value) => setAt(testStore, path, value)),
      update: vi.fn(async () => {}),
      remove: vi.fn(async (path) => {
        const r = navigate(testStore, path);
        if (r.found && r.parent) delete r.parent[r.key];
        else if (r.found) Object.keys(testStore).forEach((k) => delete testStore[k]);
      }),
    },
    default: {},
  };
});

vi.mock('../../../src/modules/auth/audit.js', () => ({
  logAuthEvent: vi.fn(async () => {}),
  AUDIT_ACTIONS: {
    EMAIL_BUDGET_ALERT: 'email:budget:alert',
    EMAIL_BUDGET_CONFIG: 'email:budget:config',
  },
}));

const auditMock = await import('../../../src/modules/auth/audit.js');
const budget = await import('../../../src/modules/email/budget.js');
const { recordEmailCost } = await import('../../../src/modules/email/provider.js');

describe('AUTH E-07 — email budget', () => {
  beforeEach(() => {
    Object.keys(testStore).forEach((k) => delete testStore[k]);
    auditMock.logAuthEvent.mockClear();
    budget._resetBudgetCache();
  });
  afterEach(() => {
    budget._resetBudgetCache();
  });

  /* ── Config: env default → DB ustun ── */
  it('1) getBudgetConfig — DB bo\'sh bo\'lsa env default', async () => {
    process.env.EMAIL_MONTHLY_BUDGET_USD = '25';
    try {
      const cfg = await budget.getBudgetConfig({ force: true });
      expect(cfg.amount).toBe(25);
      expect(cfg.source).toBe('env');
    } finally {
      delete process.env.EMAIL_MONTHLY_BUDGET_USD;
    }
  });

  it('2) getBudgetConfig — DB config env\'dan ustun', async () => {
    testStore.email_budget_config = { amount: 40, updatedBy: 'admin', updatedAt: 1 };
    const cfg = await budget.getBudgetConfig({ force: true });
    expect(cfg.amount).toBe(40);
    expect(cfg.source).toBe('db');
  });

  it('3) setBudgetConfig — invalid qiymatlar qabul qilinmaydi (0, manfiy, >100000, NaN)', async () => {
    for (const bad of [0, -5, 100001, 'abc', NaN]) {
      const r = await budget.setBudgetConfig(bad, 'admin');
      expect(r.ok).toBe(false);
      expect(r.error).toBe('invalid_amount');
    }
    expect(auditMock.logAuthEvent).not.toHaveBeenCalled();
  });

  it('4) setBudgetConfig — valid → DB yozadi + audit + cache', async () => {
    const r = await budget.setBudgetConfig(55.5, 'admin');
    expect(r.ok).toBe(true);
    expect(r.amount).toBe(55.5);
    expect(testStore.email_budget_config.amount).toBe(55.5);
    expect(testStore.email_budget_config.updatedBy).toBe('admin');
    expect(auditMock.logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email:budget:config', outcome: 'success' })
    );
    // cache yangilangan — force'siz ham DB qiymat qaytadi
    const cfg = await budget.getBudgetConfig();
    expect(cfg.amount).toBe(55.5);
  });

  /* ── Status: ok | warn | exceeded ── */
  it('5) budgetStatus — 80% dan past → ok', async () => {
    testStore.email_cost = { '2026-08': { postmark: { cost: 10, count: 100 } } };
    testStore.email_budget_config = { amount: 50, updatedAt: 1 };
    const s = await budget.budgetStatus(new Date('2026-08-10T00:00:00Z'));
    expect(s.month).toBe('2026-08');
    expect(s.level).toBe('ok');
    expect(s.pct).toBe(20);
  });

  it('6) budgetStatus — >=80% → warn, >=100% → exceeded', async () => {
    testStore.email_budget_config = { amount: 10, updatedAt: 1 };
    testStore.email_cost = { '2026-08': { postmark: { cost: 8, count: 100 } } };
    let s = await budget.budgetStatus(new Date('2026-08-10T00:00:00Z'));
    expect(s.level).toBe('warn');
    testStore.email_cost['2026-08'].postmark.cost = 10;
    s = await budget.budgetStatus(new Date('2026-08-10T00:00:00Z'));
    expect(s.level).toBe('exceeded');
    expect(s.pct).toBe(100);
  });

  /* ── CSV ── */
  it('7) monthlyReportCsv — header + qatorlar', async () => {
    testStore.email_cost = {
      '2026-08': { postmark: { cost: 3.3, count: 2000 }, smtp: { cost: 0.8, count: 2000 } },
      '2026-07': { mock: { cost: 0, count: 5 } },
    };
    const csv = await budget.monthlyReportCsv('2026-08');
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('oy,provider,count,cost_usd');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('2026-08,postmark,2000,3.30');
    expect(lines[2]).toContain('2026-08,smtp,2000,0.80');
  });

  /* ── Idempotent alert ── */
  it('8) markBudgetAlert — idempotent (bir marta yozadi, takroriy false)', async () => {
    expect(await budget.markBudgetAlert('2026-08', 'warn80')).toBe(true);
    expect(await budget.markBudgetAlert('2026-08', 'warn80')).toBe(false);
    expect(await budget.getBudgetAlerts('2026-08')).toEqual(expect.objectContaining({ warn80: true }));
    expect(await budget.markBudgetAlert('2026-08', 'exceeded')).toBe(true);
  });

  /* ── recordEmailCost E-07 ulanishi ── */
  it('9) recordEmailCost — 80% oshsa warn80 audit (bir marta)', async () => {
    testStore.email_budget_config = { amount: 10, updatedAt: 1 };
    // postmark unit 0.00165 × 5000 = 8.25 → 82.5% (warn)
    await recordEmailCost({ provider: 'postmark', count: 5000 });
    expect(auditMock.logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'email:budget:alert', outcome: 'warn' })
    );
    auditMock.logAuthEvent.mockClear();
    // yana yuborish → totalCost 16.5 (exceeded), warn80 YO'Q (allaqachon), exceeded BOR
    await recordEmailCost({ provider: 'postmark', count: 5000 });
    expect(auditMock.logAuthEvent).toHaveBeenCalledTimes(1);
    expect(auditMock.logAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ details: expect.objectContaining({ budget: 10 }) })
    );
  });

  it('10) recordEmailCost — idempotent: takroriy exceeded audit spam qilmaydi', async () => {
    testStore.email_budget_config = { amount: 1, updatedAt: 1 };
    await recordEmailCost({ provider: 'postmark', count: 1000 }); // 1.65 → exceeded
    const firstCalls = auditMock.logAuthEvent.mock.calls.length;
    await recordEmailCost({ provider: 'postmark', count: 1 });
    expect(auditMock.logAuthEvent.mock.calls.length).toBe(firstCalls); // yangi audit YO'Q
  });

  it('11) recordEmailCost — budget param berilsa u ishlatiladi (backward-compat)', async () => {
    auditMock.logAuthEvent.mockClear();
    await recordEmailCost({ provider: 'mock', count: 1, budget: 0.001 });
    // mock unit = 0 → cost 0 → hech qanday alert
    expect(auditMock.logAuthEvent).not.toHaveBeenCalled();
  });
});
