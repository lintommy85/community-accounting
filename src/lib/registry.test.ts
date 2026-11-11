import { describe, expect, it } from 'vitest';
import { emptyData } from './defaults';
import { annualAmount, contractAlert, coveredYear, dateDue, dueText, filingDue, nextFilingMonth, presetFilings, registryAlerts, reminderMonths, shiftDate, withRecord } from './registry';
import { normalizeData } from './storage';
import { AppData } from './types';

describe('合約、設備與證書的到期提醒', () => {
  it('highlights from three months before the exact expiry date', () => {
    expect(dateDue('2027-02-12', '2026-11-11').state).toBe('ok');
    expect(dateDue('2027-02-12', '2026-11-12')).toEqual({ state: 'soon', deadline: '2027-02-12', days: 92 });
    expect(dateDue('2027-02-12', '2027-02-12').state).toBe('soon');
    expect(dateDue('2027-02-12', '2027-02-13')).toMatchObject({ state: 'overdue', days: -1 });
    expect(dateDue('', '2026-11-12').state).toBe('unset');
    expect(shiftDate('2027-05-31', -3)).toBe('2027-02-28');
  });

  it('describes the remaining days and the yearly contract amount', () => {
    expect([dueText(dateDue('2026-11-20', '2026-11-12')), dueText(dateDue('2026-11-10', '2026-11-12')), dueText(dateDue('2026-11-12', '2026-11-12'))]).toEqual(['剩 8 天', '已過期 2 天', '今天到期']);
    expect([annualAmount({ amount: 18000, cycle: 'month' }), annualAmount({ amount: 30000, cycle: 'quarter' }), annualAmount({ amount: 50000, cycle: 'half' }), annualAmount({ amount: 12000, cycle: 'year' })]).toEqual([216000, 120000, 100000, 12000]);
  });
});

describe('政府申報的週期', () => {
  it('counts an early or late filing toward the nearest deadline', () => {
    expect(coveredYear('2026-02', 3)).toBe(2026);
    expect(coveredYear('2026-08', 3)).toBe(2026);
    expect(coveredYear('2026-12', 1)).toBe(2027);
    expect(nextFilingMonth({ everyYears: 3, dueMonth: 3, lastMonth: '2026-02' })).toBe('2029-03');
    expect(nextFilingMonth({ everyYears: 1, dueMonth: 1, lastMonth: '2026-12' })).toBe('2028-01');
  });

  it('uses the next deadline from today while the last filing is blank', () => {
    expect(nextFilingMonth({ everyYears: 3, dueMonth: 3, lastMonth: '' }, '2026-11-12')).toBe('2027-03');
    expect(nextFilingMonth({ everyYears: 1, dueMonth: 12, lastMonth: '' }, '2026-11-12')).toBe('2026-12');
  });

  it('highlights from half a year before the deadline until the last filing month is updated', () => {
    const f = { everyYears: 1, dueMonth: 4, lastMonth: '2026-04' };
    expect(filingDue(f, '2026-10-31').state).toBe('ok');
    expect(filingDue(f, '2026-11-01')).toMatchObject({ state: 'soon', month: '2027-04', deadline: '2027-04-30' });
    expect(filingDue(f, '2027-05-01').state).toBe('overdue');
    expect(filingDue({ ...f, lastMonth: '2027-04' }, '2027-05-01').state).toBe('ok');
  });
});

describe('預先載入與修改紀錄', () => {
  it('loads the three government filings once, and keeps them deleted after that', () => {
    expect(emptyData().filings!.map((f) => [f.name, f.everyYears, f.dueMonth, f.lastMonth])).toEqual([['透保水檢查', 1, 4, ''], ['消防申報', 1, 12, ''], ['公安申報', 3, 3, '']]);
    const old = { ...emptyData(), filings: undefined } as AppData;
    expect(normalizeData(old).filings!.length).toBe(3);
    expect(normalizeData({ ...emptyData(), filings: [] }).filings).toEqual([]);
  });

  it('adds history records newest first and counts the alerts', () => {
    const f = withRecord(withRecord(presetFilings()[0], '2025-04', '', '2025-04-20T00:00:00Z'), '2026-04', '', '2026-04-18T00:00:00Z');
    expect(f.history.map((r) => r.value)).toEqual(['2026-04', '2025-04']);
    const d = { settings: emptyData().settings, contracts: [{ id: 'c', title: '保全', vendor: 'X', amount: 1, cycle: 'month' as const, startDate: '', endDate: '2027-01-31', note: '', history: [] }], assets: [{ id: 'a', kind: 'certificate' as const, name: '昇降機使用許可', expiry: '2028-01-01', note: '', history: [] }], filings: presetFilings() };
    expect(registryAlerts(d, '2026-11-12')).toEqual({ contracts: 1, assets: 0, filings: 3 });
  });
});

describe('到期提醒設定與到期不續約', () => {
  const contract = { id: 'c', title: '清潔', vendor: 'Y', amount: 1, cycle: 'month' as const, startDate: '', endDate: '2027-01-31', note: '', history: [] };
  const base = { contracts: [contract], assets: [{ id: 'a', kind: 'equipment' as const, name: '滅火器', expiry: '2027-04-30', note: '', history: [] }], filings: [{ ...presetFilings()[0], lastMonth: '2026-04' }] };

  it('uses the defaults until the lead times are set, and ignores invalid values', () => {
    expect(reminderMonths({})).toEqual({ contracts: 3, assets: 3, filings: 6 });
    expect(reminderMonths({ reminders: { contracts: 1, assets: 6, filings: 0 } })).toEqual({ contracts: 1, assets: 6, filings: 6 });
  });

  it('applies each lead time separately', () => {
    const settings = { ...emptyData().settings, reminders: { contracts: 1, assets: 6, filings: 3 } };
    expect(registryAlerts({ ...base, settings }, '2026-11-12')).toEqual({ contracts: 0, assets: 1, filings: 0 });
    expect(registryAlerts({ ...base, settings: emptyData().settings }, '2026-11-12')).toEqual({ contracts: 1, assets: 0, filings: 1 });
    expect(filingDue(base.filings[0], '2027-01-31', 3).state).toBe('ok');
    expect(filingDue(base.filings[0], '2027-02-01', 3).state).toBe('soon');
  });

  it('does not alert a contract that will not be renewed, even after it expires', () => {
    expect(contractAlert({ noRenew: true }, dateDue('2027-01-31', '2026-12-01'))).toBe(false);
    expect(contractAlert({ noRenew: true }, dateDue('2027-01-31', '2027-03-01'))).toBe(false);
    expect(contractAlert({}, dateDue('2027-01-31', '2026-12-01'))).toBe(true);
    const settings = emptyData().settings;
    expect(registryAlerts({ ...base, settings, contracts: [{ ...contract, noRenew: true }] }, '2026-11-12').contracts).toBe(0);
  });
});
