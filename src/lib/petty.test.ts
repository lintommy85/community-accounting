import { describe, expect, it } from 'vitest';
import { emptyData } from './defaults';
import { monthReport } from './ledger';
import { defaultReplenishDate, PETTY_CATEGORY, pettyTotal, replenishmentOf, replenishReportMonths, upsertReplenishment } from './petty';
import { monthSheet } from './statement';

describe('petty cash', () => {
  it('keeps petty cash items out of the income statement and replenishes the monthly total as one expense', () => {
    const d = emptyData();
    d.pettyCash = [
      { id: '1', date: '2026-10-03', item: '文具', amount: 350, payee: '書局', note: '' },
      { id: '2', date: '2026-10-18', item: '郵資', amount: 125, payee: '郵局', note: '' },
      { id: '3', date: '2026-11-02', item: '茶水', amount: 500, payee: '', note: '' },
    ];
    expect(pettyTotal(d.pettyCash, '2026-10')).toBe(475);
    expect(monthReport(d, '2026-10').expense).toEqual([]);

    d.entries = upsertReplenishment(d.entries, '2026-10', { date: '2026-10-31', accountId: 'acc_main', amount: 475, voucherNo: '115-0001' });
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ date: '2026-10-31', category: PETTY_CATEGORY, amount: 475, pettyMonth: '2026-10', accountId: 'acc_main' });
    expect(monthReport(d, '2026-10').expense).toEqual([{ category: PETTY_CATEGORY, amount: 475 }]);

    // 補登零用金後更新撥補：同一筆，金額變動
    d.pettyCash.push({ id: '4', date: '2026-10-30', item: '雜支', amount: 25, payee: '', note: '' });
    d.entries = upsertReplenishment(d.entries, '2026-10', { date: '2026-10-31', accountId: 'acc_main', amount: pettyTotal(d.pettyCash, '2026-10'), voucherNo: 'x' });
    expect(d.entries).toHaveLength(1);
    expect(replenishmentOf(d.entries, '2026-10')).toMatchObject({ amount: 500, voucherNo: '115-0001' });
  });

  it('lists the replenishment on the next month report by default and can move it back to the same month', () => {
    expect(replenishReportMonths('2026-11')).toEqual(['2026-12', '2026-11']);
    expect(replenishReportMonths('2026-12')).toEqual(['2027-01', '2026-12']);
    expect(defaultReplenishDate('2026-11', '2026-12', '2026-11-14')).toBe('2026-12-01');
    expect(defaultReplenishDate('2026-11', '2026-12', '2026-12-05')).toBe('2026-12-05');
    expect(defaultReplenishDate('2026-11', '2026-11', '2026-12-05')).toBe('2026-11-30');

    const d = emptyData();
    d.pettyCash = [
      { id: '1', date: '2026-11-03', item: '文具', amount: 350, payee: '', note: '' },
      { id: '2', date: '2026-11-20', item: '郵資', amount: 125, payee: '', note: '' },
    ];
    const total = pettyTotal(d.pettyCash, '2026-11');
    d.entries = upsertReplenishment(d.entries, '2026-11', { date: '2026-12-01', accountId: 'acc_main', amount: total, voucherNo: '115-0001' });
    expect(monthReport(d, '2026-11').expense).toEqual([]);
    expect(monthReport(d, '2026-12').expense).toEqual([{ category: PETTY_CATEGORY, amount: 475 }]);
    expect(monthSheet(d, '2026-11').expense).toEqual([]);
    expect(monthSheet(d, '2026-12').expense.map((l) => [l.subject, l.item, l.amount])).toEqual([[PETTY_CATEGORY, '2026-11 零用金使用總額', 475]]);

    d.entries = upsertReplenishment(d.entries, '2026-11', { date: '2026-11-30', accountId: 'acc_main', amount: total, voucherNo: '115-0002' });
    expect(d.entries).toHaveLength(1);
    expect(d.entries[0]).toMatchObject({ date: '2026-11-30', pettyMonth: '2026-11', voucherNo: '115-0001' });
    expect(monthReport(d, '2026-11').expense).toEqual([{ category: PETTY_CATEGORY, amount: 475 }]);
    expect(monthReport(d, '2026-12').expense).toEqual([]);
  });

  it('takes a voucher number of the new year when the replenishment moves into another year', () => {
    let entries = upsertReplenishment([], '2026-12', { date: '2026-12-31', accountId: 'acc_main', amount: 100, voucherNo: '115-0009' });
    entries = upsertReplenishment(entries, '2026-12', { date: '2027-01-04', accountId: 'acc_main', amount: 100, voucherNo: '116-0001' });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ date: '2027-01-04', pettyMonth: '2026-12', voucherNo: '116-0001' });
    entries = upsertReplenishment(entries, '2026-12', { date: '2027-01-06', accountId: 'acc_main', amount: 120, voucherNo: '116-0002' });
    expect(entries[0]).toMatchObject({ date: '2027-01-06', amount: 120, voucherNo: '116-0001' });
  });
});

describe('petty cash balance', () => {
  it('starts from the fund, deducts each expense, adds back replenishments and carries over months', async () => {
    const { pettyLedger } = await import('./petty');
    const petty = [
      { id: '1', date: '2026-10-03', item: '文具', amount: 350, payee: '', note: '' },
      { id: '2', date: '2026-10-18', item: '郵資', amount: 125, payee: '', note: '' },
      { id: '3', date: '2026-11-02', item: '茶水', amount: 500, payee: '', note: '' },
    ];
    let entries = upsertReplenishment([], '2026-10', { date: '2026-11-05', accountId: 'acc_main', amount: 475, voucherNo: 'v1' });
    const oct = pettyLedger(petty, entries, 10000, '2026-10');
    expect([oct.opening, ...oct.lines.map((l) => l.balance), oct.closing]).toEqual([10000, 9650, 9525, 9525]);
    const nov = pettyLedger(petty, entries, 10000, '2026-11');
    expect(nov.opening).toBe(9525);
    expect(nov.lines.map((l) => [l.date, l.kind, l.out, l.in, l.balance])).toEqual([
      ['2026-11-02', 'expense', 500, 0, 9025],
      ['2026-11-05', 'replenish', 0, 475, 9500],
    ]);
    entries = upsertReplenishment(entries, '2026-10', { date: '2026-10-31', accountId: 'acc_main', amount: 475, voucherNo: 'v1' });
    expect(pettyLedger(petty, entries, 10000, '2026-10').closing).toBe(10000);
  });
});
