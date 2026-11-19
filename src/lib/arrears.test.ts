import { describe, expect, it } from 'vitest';
import { allocateAll, receiptBreakdown } from './allocation';
import { arrearsLines, arrearsReportLines, suggestArrearsLabel } from './arrears';
import { emptyData } from './defaults';
import { monthSheet } from './statement';
import { AppData, Due, Payment } from './types';

const due = (unitNo: string, month: string, item: string, amount: number): Due => ({ id: `${unitNo}${month}${item}`, unitNo, month, item, amount, source: 'import', note: '', updatedAt: '', kind: 'fee', billAmount: amount });
const pay = (id: string, unitNo: string, paidDate: string, amount: number, billPeriod: string): Payment => ({
  id, batchId: 'b', unitNo, payerName: '', billPeriod, item: '管理費', paidDate, channel: 'ATM',
  amount, fee: 0, reportDepositDate: '', depositDate: paidDate, depositConfirmed: true, txnNo: '', status: '', note: '', voided: false,
});

/** A、B 兩戶 10、11 月都是坪數費 2000＋汽車位清潔費 500；10 月都沒繳，11 月一起補繳。 */
function setup(): AppData {
  const d = emptyData();
  d.settings.billingStartMonth = '2026-10';
  d.settings.units = [
    { id: 'a', unitNo: 'A', owner: '王', monthlyFee: 2000, note: '' },
    { id: 'b', unitNo: 'B', owner: '李', monthlyFee: 2000, note: '' },
  ];
  for (const u of ['A', 'B']) for (const m of ['2026-10', '2026-11']) d.dues.push(due(u, m, '坪數費', 2000), due(u, m, '汽車位清潔費', 500));
  d.payments = [pay('a1', 'A', '2026-11-05', 5000, '115/11'), pay('b1', 'B', '2026-11-06', 4000, '115/11')];
  return d;
}

describe('逾期款項', () => {
  it('lists which month and which due items each payment settled, in due-item order', () => {
    const d = setup();
    const lines = arrearsLines(d, '2026-11');
    expect(lines.map((l) => [l.unitNo, l.month, l.item, l.amount, l.label])).toEqual([
      ['A', '2026-10', '坪數費', 2000, ''],
      ['A', '2026-10', '汽車位清潔費', 500, ''],
      ['B', '2026-10', '坪數費', 1500, ''],
    ]);
    expect(lines[0].dueItems).toEqual([{ item: '坪數費', amount: 2000 }, { item: '汽車位清潔費', amount: 500 }]);
    expect(suggestArrearsLabel(lines[1])).toBe('10月逾期汽車位清潔費');
    // 和收支報表「補繳以前月份」一致
    const total = receiptBreakdown(allocateAll(d), d.payments, '2026-11-01', '2026-11-30').arrears;
    expect(lines.reduce((t, l) => t + l.amount, 0)).toBe(total);
  });

  it('shows classified subjects in the month report, merged by default or one line each when chosen', () => {
    const d = setup();
    const keys = arrearsLines(d, '2026-11').map((l) => l.key);
    d.arrearsLabels = { [keys[0]]: '10月逾期管理費', [keys[2]]: '10月逾期管理費' };
    const sheet = (x: AppData) => monthSheet(x, '2026-11').income.filter((l) => l.item.includes('逾期')).map((l) => [l.item, l.amount, l.note]);
    expect(sheet(d)).toEqual([['10月逾期管理費', 3500, '住戶'], ['10月逾期汽車位清潔費（未歸類）', 500, '住戶']]);
    d.settings.arrearsMerge = { '10月逾期管理費': false };
    expect(sheet(d)).toEqual([['10月逾期管理費', 2000, '住戶'], ['10月逾期汽車位清潔費（未歸類）', 500, '住戶'], ['10月逾期管理費', 1500, '住戶']]);
    expect(arrearsReportLines(arrearsLines(d, '2026-11')).filter((l) => l.unclassified).length).toBe(1);
  });

  it('has nothing to classify when every payment is for the current month', () => {
    const d = setup();
    d.payments = [pay('a1', 'A', '2026-10-05', 2500, '115/10'), pay('a2', 'A', '2026-11-05', 2500, '115/11')];
    expect(arrearsLines(d, '2026-11')).toEqual([]);
  });
});

describe('依入帳日認列', () => {
  /** A 戶 10/30 繳 10 月、11/2 才入帳；B 戶 10/5 繳 10 月、當天入帳。 */
  function lateDeposit(): AppData {
    const d = setup();
    d.payments = [
      { ...pay('a1', 'A', '2026-10-30', 2500, '115/10'), depositDate: '2026-11-02' },
      pay('b1', 'B', '2026-10-05', 2500, '115/10'),
    ];
    return d;
  }
  const sheetFee = (d: AppData, month: string, basis: 'paid' | 'deposit') =>
    monthSheet(d, month, basis).income.filter((l) => l.subject === '管理費收入').map((l) => [l.item, l.amount]);

  it('puts a payment deposited next month into that month for the report and its arrears lines', () => {
    const d = lateDeposit();
    expect(sheetFee(d, '2026-10', 'paid')).toEqual([['管理費收入', 5000]]);
    expect(sheetFee(d, '2026-10', 'deposit')).toEqual([['管理費收入', 2500]]);
    expect(arrearsLines(d, '2026-11', allocateAll(d), 'paid')).toEqual([]);
    const lines = arrearsLines(d, '2026-11', allocateAll(d), 'deposit');
    expect(lines.map((l) => [l.unitNo, l.month, l.item, l.amount])).toEqual([['A', '2026-10', '坪數費', 2000], ['A', '2026-10', '汽車位清潔費', 500]]);
    // 10 月就繳了、只是 11 月才入帳，建議名稱不寫逾期
    expect(lines.map((l) => suggestArrearsLabel(l))).toEqual(['10月坪數費（10月繳費）', '10月汽車位清潔費（10月繳費）']);
    expect(sheetFee(d, '2026-11', 'deposit').reduce((t, [, v]) => t + (v as number), 0)).toBe(2500);
    expect(sheetFee(d, '2026-11', 'paid')).toEqual([]);
  });
});
