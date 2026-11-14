import { describe, expect, it } from 'vitest';
import { allocateAll, findAmountMismatches, monthWriteOff, paidListForMonth, summarizeUnit, unitChargeRows } from './allocation';
import { BILL_DEPOSIT, BILL_FINE, planBillImport, suggestBillItem } from './bills';
import { emptyData } from './defaults';
import { applyDueChanges, diffDues, DueRow } from './dues';
import { accountBalances } from './ledger';
import { addRenovationOpening, cancelSettlement, computeDeductions, isBeforeOpening, openDepositSummary, renameRenovationLabel, renovationAfterCategoryRename, settleRenovation, unitDeposits } from './renovation';
import { buildStatement, monthPeriods, monthSheet } from './statement';
import { AppData, Due, Payment, RenovationRateItem } from './types';

const pay = (id: string, unitNo: string, paidDate: string, amount: number, billPeriod = '', item = '管理費'): Payment => ({
  id, batchId: 'b', unitNo, payerName: '', billPeriod, item, paidDate, channel: 'ATM',
  amount, fee: 0, reportDepositDate: '', depositDate: paidDate, depositConfirmed: true, txnNo: '', status: '', note: '', voided: false,
});
const bill = (unitNo: string, amount: number, item: string, month = '2026-11'): DueRow => ({ unitNo, owner: '', month, item, amount });

/** 兩戶管理費基準 2000，11 月帳單 A 戶有罰款 500、B 戶有裝潢保證金 10000。 */
function setup(): AppData {
  const d = emptyData();
  d.settings.billingStartMonth = '2026-11';
  d.settings.billItemMap = { 罰款: BILL_FINE, 裝潢保證金: BILL_DEPOSIT };
  d.settings.units = [
    { id: 'a', unitNo: 'A', owner: '王', monthlyFee: 2000, note: '' },
    { id: 'b', unitNo: 'B', owner: '李', monthlyFee: 2000, note: '' },
  ];
  const plan = planBillImport(d, [bill('A', 2000, '11月管理費'), bill('A', 500, '11月罰款'), bill('B', 2000, '11月管理費'), bill('B', 10000, '裝潢保證金')]);
  d.dues = applyDueChanges([], diffDues([], plan.rows, plan.billed));
  return d;
}

describe('罰款與裝潢保證金的帳單項目', () => {
  it('suggests the new targets and keeps them out of the dues', () => {
    expect(suggestBillItem('裝潢保證金', ['管理費'])).toBe(BILL_DEPOSIT);
    expect(suggestBillItem('違規罰款', ['管理費'])).toBe(BILL_FINE);
    const d = setup();
    const kinds = (unitNo: string) => d.dues.filter((x) => x.unitNo === unitNo).map((x: Due) => [x.item, x.kind, x.amount, x.billAmount]);
    expect(kinds('A')).toEqual([['管理費', 'fee', 2000, 2000], ['罰款', 'fine', 0, 500]]);
    expect(kinds('B')).toEqual([['管理費', 'fee', 2000, 2000], ['裝潢保證金', 'deposit', 0, 10000]]);
  });

  it('does not touch the dues when a bill only has a deposit', () => {
    const d = setup();
    const plan = planBillImport(d, [bill('A', 8000, '12月裝潢保證金', '2026-12')]);
    expect(plan.rows).toEqual([{ unitNo: 'A', owner: '', month: '2026-12', item: '裝潢保證金', amount: 0, billAmount: 8000, kind: 'deposit' }]);
    expect(plan.diffs).toEqual([]);
  });

  it('pays the period dues first, then the fine or deposit on that bill; neither counts as owing or prepaid', () => {
    const d = setup();
    d.payments = [pay('a1', 'A', '2026-11-05', 2500, '115年11月管理費'), pay('b1', 'B', '2026-11-06', 12000, '115年11月管理費')];
    const r = allocateAll(d);
    const a = r.byKey.get('A')!;
    const b = r.byKey.get('B')!;
    expect([a.paidByMonth.get('2026-11'), a.credit, r.chargesByPayment.get('a1')]).toEqual([2000, 0, { fine: 500, deposit: 0 }]);
    expect([b.paidByMonth.get('2026-11'), b.credit, r.chargesByPayment.get('b1')]).toEqual([2000, 0, { fine: 0, deposit: 10000 }]);
    expect(summarizeUnit(a, '2026-11', '2026-11').owing).toBe(0);
    expect(findAmountMismatches(d, new Set(['a1', 'b1']))).toEqual([]);
    expect(unitChargeRows(a, d.entries)).toEqual([{ month: '2026-11', kind: 'fine', item: '罰款', billed: 500, paid: 500, dates: ['2026-11-05'] }]);
  });

  it('does not count a deposit paid on its own as this month’s management fee when checking amounts', () => {
    const d = setup();
    // A 戶另外繳了裝潢保證金（帳單上沒有保證金，只有罰款）：之後匯入 11 月管理費，不應該跳出金額不同
    const deposit = pay('a0', 'A', '2026-11-13', 36000, '115年度裝潢保證金', '115年度裝潢保證金');
    d.settings.billItemMap = { ...d.settings.billItemMap, 裝潢保證金: BILL_DEPOSIT };
    d.payments = [deposit, pay('a1', 'A', '2026-11-10', 2500, '115年11月管理費')];
    expect(findAmountMismatches(d, new Set(['a1']))).toEqual([]);
    const a = allocateAll(d).byKey.get('A')!;
    expect([a.paidByMonth.get('2026-11'), a.credit]).toEqual([2000, 0]);
    expect(a.chargePaid.map((c) => [c.paymentId, c.kind, c.amount])).toEqual([['a1', 'fine', 500], ['a0', 'deposit', 36000]]);
    // 只繳管理費、沒繳罰款：照樣提醒少繳，保證金不會拿來抵
    d.payments = [deposit, pay('a1', 'A', '2026-11-10', 2000, '115年11月管理費')];
    expect(findAmountMismatches(d, new Set(['a1'])).map((c) => [c.expected, c.diff, c.others.count, c.others.amount])).toEqual([[2500, -500, 0, 0]]);
  });

  it('keeps a deposit-type payment out of the management fee even if it carries an old manual write-off', () => {
    const d = setup();
    d.payments = [{ ...pay('a0', 'A', '2026-11-13', 36000, '115年度裝潢保證金', '115年度裝潢保證金'), allocations: [{ month: '2026-11', amount: 2000 }] }];
    const a = allocateAll(d).byKey.get('A')!;
    expect([a.allocations.length, a.paidByMonth.get('2026-11') ?? 0, a.credit]).toEqual([0, 0, 0]);
    expect(a.chargePaid.map((c) => [c.kind, c.amount])).toEqual([['deposit', 36000]]);
  });

  it('still counts a separately paid deposit against the deposit on the same bill', () => {
    const d = setup();
    d.payments = [pay('b0', 'B', '2026-11-03', 10000, '115年11月裝潢保證金', '裝潢保證金'), pay('b1', 'B', '2026-11-06', 2000, '115年11月管理費')];
    expect(findAmountMismatches(d, new Set(['b1']))).toEqual([]);
  });

  it('leaves the fine unpaid when the payment only covers the dues', () => {
    const d = setup();
    d.payments = [pay('a1', 'A', '2026-11-05', 2000, '115年11月管理費')];
    const a = allocateAll(d).byKey.get('A')!;
    expect([a.paidByMonth.get('2026-11'), a.chargePaid]).toEqual([2000, []]);
    expect(unitChargeRows(a, d.entries)[0]).toMatchObject({ billed: 500, paid: 0 });
  });

  it('treats a payment whose item is the deposit as all deposit', () => {
    const d = setup();
    d.payments = [pay('x', 'A', '2026-11-08', 6000, '', '裝潢保證金')];
    const r = allocateAll(d);
    expect([r.byKey.get('A')!.paidByMonth.get('2026-11') ?? 0, r.chargesByPayment.get('x')]).toEqual([0, { fine: 0, deposit: 6000 }]);
  });

  it('leaves fines and deposits out of the management fee write-off and its paid list', () => {
    const d = setup();
    d.payments = [pay('a1', 'A', '2026-11-05', 2500, '115年11月管理費'), pay('b1', 'B', '2026-11-06', 2000, '115年11月管理費'), pay('x', 'A', '2026-11-08', 6000, '', '裝潢保證金')];
    const r = allocateAll(d);
    expect(paidListForMonth(r, d.payments, '2026-11').map((l) => [l.payment.id, l.fee])).toEqual([['a1', 2000], ['b1', 2000]]);
    const w = monthWriteOff(r, d.payments, '2026-11');
    expect([w.received, w.fromCurrent, w.total]).toEqual([4000, 4000, 4000]);
  });

  it('reports fines and deposits as their own income lines, not management fee income', () => {
    const d = setup();
    d.payments = [pay('a1', 'A', '2026-11-05', 2500, '115年11月管理費'), pay('b1', 'B', '2026-11-06', 12000, '115年11月管理費')];
    const st = buildStatement(d, monthPeriods('2026-11'), { basis: 'paid', fund: '' });
    const line = (label: string) => st.income.find((l) => l.label === label)?.values[0];
    expect([line('管理費收入－管理費'), line('罰款收入'), line('裝潢保證金')]).toEqual([4000, 500, 10000]);
    const sheet = monthSheet(d, '2026-11').income.map((l) => [l.subject, l.amount]);
    expect(sheet).toEqual(expect.arrayContaining([['罰款收入', 500], ['裝潢保證金', 10000]]));
  });
});

describe('裝潢保證金結算', () => {
  const items: RenovationRateItem[] = [
    { id: 'i1', name: '保護費', mode: 'once', amount: 2000 },
    { id: 'i2', name: '清潔費', mode: 'daily', amount: 300 },
  ];

  it('deducts single items directly and daily items by the number of days', () => {
    expect(computeDeductions(items, { i2: 10 }).map((x) => x.deducted)).toEqual([2000, 3000]);
    expect(computeDeductions([], {})).toEqual([]);
  });

  it('creates the refund and fee entries, merges several units into one report line, and can be cancelled', () => {
    let d = setup();
    d.payments = [pay('b1', 'B', '2026-11-06', 12000, '115年11月管理費')];
    d.entries = [{ id: 'm1', date: '2026-11-10', type: 'income', category: '裝潢保證金', accountId: 'acc_main', toAccountId: '', amount: 8000, counterparty: '', voucherNo: '115-0001', note: '', renovationKind: 'deposit', renovationUnit: 'A' }];
    const alloc = allocateAll(d);
    expect(openDepositSummary(d, alloc, '2026-11')).toEqual({ total: 18000, units: 2 });
    const dep = unitDeposits(d, alloc, '2026-11');
    const b = dep.get('B')!;
    const deductions = computeDeductions(items, { i2: 10 });
    d = settleRenovation(d, { unitNo: 'B', planName: '一般', items, startDate: '2026-11-15', deposit: b.openTotal, receiptIds: b.open.map((x) => x.id), deductions, refund: 4970, fee: 30, date: '2026-11-28', accountId: 'acc_main' });
    const a = dep.get('A')!;
    d = settleRenovation(d, { unitNo: 'A', planName: '無費率', items: [], startDate: '', deposit: a.openTotal, receiptIds: a.open.map((x) => x.id), deductions: [], refund: 8000, fee: 0, date: '2026-11-29', accountId: 'acc_main' });
    const settled = d.renovations.find((r) => r.unitNo === 'B')!.settlement!;
    expect([settled.deducted, settled.refundTotal, settled.refund, settled.fee]).toEqual([5000, 5000, 4970, 30]);
    expect(openDepositSummary(d, allocateAll(d), '2026-11')).toEqual({ total: 0, units: 0 });
    const refunds = monthSheet(d, '2026-11').expense.filter((l) => l.subject === '裝潢保證金退款');
    expect(refunds).toEqual([expect.objectContaining({ amount: 12970, note: '' })]);
    expect(d.entries.filter((e) => e.renovationKind === 'refund').every((e) => e.counterparty === '' && e.note === '')).toBe(true);

    d = renameRenovationLabel(d, 'refund', '保證金退還');
    expect(d.entries.filter((e) => e.renovationKind === 'refund').map((e) => e.category)).toEqual(['保證金退還', '保證金退還']);
    expect(d.settings.expenseCategories).toContain('保證金退還');

    d = cancelSettlement(d, d.renovations.find((r) => r.unitNo === 'A')!.id);
    expect(openDepositSummary(d, allocateAll(d), '2026-11')).toEqual({ total: 8000, units: 1 });
  });
});

describe('建立系統前已收的保證金與手續費呈現方式', () => {
  /** 管理費帳戶 2026-10-28 期初 100,000（已含 A 戶 9 月收的保證金 8,000）。 */
  function opened(): AppData {
    let d = setup();
    d.settings.accounts = d.settings.accounts.map((a) => (a.id === 'acc_main' ? { ...a, openingBalance: 100000, openingDate: '2026-10-28' } : a));
    d = addRenovationOpening(d, { unitNo: 'A', date: '2026-09-15', amount: 8000, accountId: 'acc_main' });
    return d;
  }
  const main = (d: AppData) => accountBalances(d, '2026-12-31').find((b) => b.accountId === 'acc_main')!;
  const settleA = (d: AppData, fee: number, feeMode?: 'separate' | 'combined', date = '2026-11-28') => {
    const a = unitDeposits(d, allocateAll(d), '2026-11').get('A')!;
    return settleRenovation(d, { unitNo: 'A', planName: '無費率', items: [], startDate: '', deposit: a.openTotal, receiptIds: a.open.map((x) => x.id), deductions: [], refund: a.openTotal - fee, fee, feeMode, date, accountId: 'acc_main' });
  };

  it('offers the option only before the account opening date', () => {
    const d = opened();
    expect([isBeforeOpening(d.settings, 'acc_main', '2026-10-27'), isBeforeOpening(d.settings, 'acc_main', '2026-10-28'), isBeforeOpening(d.settings, 'acc_fund', '2020-01-01')]).toEqual([true, false, false]);
  });

  it('counts the opening deposit for the unit but not in balances or reports', () => {
    const d = opened();
    expect(unitDeposits(d, allocateAll(d), '2026-11').get('A')!.open.map((x) => [x.source, x.amount])).toEqual([['opening', 8000]]);
    expect(main(d).closing).toBe(100000);
    const year = buildStatement(d, monthPeriods('2026-09'), { basis: 'paid', fund: '' });
    expect(year.income.find((l) => l.label === '裝潢保證金')?.values[0] ?? 0).toBe(0);
    expect(monthSheet(d, '2026-09').income).toEqual([]);
  });

  it('shows the fee on its own line when separate, merging units per subject', () => {
    let d = opened();
    d.entries = [{ id: 'm1', date: '2026-11-10', type: 'income', category: '裝潢保證金', accountId: 'acc_main', toAccountId: '', amount: 5000, counterparty: '', voucherNo: '115-0001', note: '', renovationKind: 'deposit', renovationUnit: 'C' }];
    d = settleA(d, 30, 'separate');
    const c = unitDeposits(d, allocateAll(d), '2026-11').get('C')!;
    d = settleRenovation(d, { unitNo: 'C', planName: '無費率', items: [], startDate: '', deposit: 5000, receiptIds: c.open.map((x) => x.id), deductions: [], refund: 4985, fee: 15, date: '2026-11-29', accountId: 'acc_main' });
    const lines = monthSheet(d, '2026-11').expense.map((l) => [l.subject, l.amount]);
    expect(lines).toEqual([['裝潢保證金退款', 12955], ['裝潢保證金退款手續費', 45]]);
    expect(main(d).closing).toBe(100000 + 5000 - 8000 - 5000);
  });

  it('combines the fee into the refund line when chosen, and remembers the choice', () => {
    const d = settleA(opened(), 30, 'combined');
    expect(monthSheet(d, '2026-11').expense.map((l) => [l.subject, l.amount])).toEqual([['裝潢保證金退款', 8000]]);
    const st = d.renovations[0].settlement!;
    expect([st.refund, st.fee, st.feeMode, d.settings.renovation?.feeMode]).toEqual([7970, 30, 'combined', 'combined']);
    expect(main(d).closing).toBe(92000);
  });

  it('keeps the fixed-expense ticks when the labels are renamed, from either page', () => {
    let d = settleA(opened(), 30, 'separate');
    d.settings.fixedCategories = ['裝潢保證金退款', '裝潢保證金退款手續費'];
    expect(monthSheet(d, '2026-11').expense.every((l) => l.fixed)).toBe(true);
    d = renameRenovationLabel(d, 'fee', '退款匯費');
    expect(d.entries.filter((e) => e.renovationKind === 'fee').map((e) => e.category)).toEqual(['退款匯費']);
    expect(d.settings.fixedCategories).toEqual(['裝潢保證金退款', '退款匯費']);
    expect(d.settings.expenseCategories).toContain('退款匯費');
    expect(d.settings.expenseCategories).not.toContain('裝潢保證金退款手續費');
    expect(renovationAfterCategoryRename(d.settings, 'expense', '裝潢保證金退款', '保證金退還')).toMatchObject({ refundLabel: '保證金退還', feeLabel: '退款匯費' });
    expect(renovationAfterCategoryRename(d.settings, 'income', '裝潢保證金退款', 'X')).toBe(d.settings.renovation);
  });
});
