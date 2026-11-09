import { describe, expect, it } from 'vitest';
import { allocateAll, findAmountMismatches, monthWriteOff, monthWriteOffByUnit, advancesFromAllocations, receiptBreakdown, summarizeUnit, unitNosFromPayments } from './allocation';
import { emptyData } from './defaults';
import { Due, Payment } from './types';

let seq = 0;
function pay(unitNo: string, paidDate: string, amount: number, billPeriod = '', extra: Partial<Payment> = {}): Payment {
  seq++;
  return {
    id: `p${String(seq).padStart(3, '0')}`, batchId: 'b', unitNo, payerName: '', billPeriod, item: '管理費', paidDate, channel: 'ATM',
    amount, fee: 0, reportDepositDate: '', depositDate: paidDate, depositConfirmed: false, txnNo: '', status: '', note: '', voided: false, ...extra,
  };
}

const due = (unitNo: string, month: string, amount: number, item = '管理費'): Due => ({
  id: `d-${unitNo}-${month}-${item}`, unitNo, month, item, amount, source: 'import', note: '', updatedAt: '',
});

/** 三戶，09～12 月都有帳單：A1-3F／A1-5F 2000、B2-2F 2500。 */
function setup(payments: Payment[], extraDues: Due[] = [], months = ['2026-09', '2026-10', '2026-11', '2026-12']) {
  const d = emptyData();
  d.settings.billingStartMonth = '2026-09';
  d.settings.totalUnits = 3;
  d.settings.units = [
    { id: 'u1', unitNo: 'A1-3F', owner: '王', monthlyFee: 2000, note: '' },
    { id: 'u2', unitNo: 'A1-5F', owner: '李', monthlyFee: 2000, note: '' },
    { id: 'u3', unitNo: 'B2-2F', owner: '陳', monthlyFee: 2500, note: '' },
  ];
  d.dues = [
    ...months.flatMap((m) => [due('A1-3F', m, 2000), due('A1-5F', m, 2000), due('B2-2F', m, 2500)]),
    ...extraDues,
  ];
  d.payments = payments;
  return d;
}

describe('monthly write-off against imported / manual dues', () => {
  it('splits a prepaid range into one write-off per month', () => {
    const d = setup([pay('A1-5F', '2026-10-30', 6000, '115/10~115/12')]);
    const acc = allocateAll(d).byKey.get('A1-5F')!;
    expect(acc.allocations.map((a) => [a.month, a.amount, a.source])).toEqual([
      ['2026-10', 2000, 'period'], ['2026-11', 2000, 'period'], ['2026-12', 2000, 'period'],
    ]);
    expect(acc.credit).toBe(0);
  });

  it('never invents dues: months without a bill are not owed, prepayment waits as credit', () => {
    const d = setup([pay('A1-3F', '2026-10-05', 10000)], [], ['2026-09', '2026-10']);
    const acc = allocateAll(d).byKey.get('A1-3F')!;
    expect(acc.allocations.map((a) => [a.month, a.amount])).toEqual([['2026-09', 2000], ['2026-10', 2000]]);
    expect(acc.credit).toBe(6000);
    // 之後匯入 11 月帳單，溢繳自動銷到 11 月
    d.dues.push(due('A1-3F', '2026-11', 2000));
    const again = allocateAll(d).byKey.get('A1-3F')!;
    expect(again.allocations.map((a) => a.month)).toEqual(['2026-09', '2026-10', '2026-11']);
    expect(again.credit).toBe(4000);
  });

  it('uses the excess of a single-period payment to clear older arrears first', () => {
    const d = setup([pay('B2-2F', '2026-10-01', 6000, '115/10')]);
    const acc = allocateAll(d).byKey.get('B2-2F')!;
    expect(acc.allocations.map((a) => [a.month, a.amount, a.source])).toEqual([
      ['2026-09', 2500, 'auto'], ['2026-10', 2500, 'period'], ['2026-11', 1000, 'auto'],
    ]);
  });

  it('handles negative dues (減收) and negative payments (退款)', () => {
    const d = setup([pay('A1-3F', '2026-09-05', 4000), pay('A1-3F', '2026-10-20', -500)], [due('A1-3F', '2026-10', -300, '減收')]);
    const acc = allocateAll(d).byKey.get('A1-3F')!;
    expect(acc.dueByMonth.get('2026-10')).toBe(1700);
    // 4000 → 09 月 2000、10 月 1700，溢繳 300；退款 500 先沖溢繳 300，再沖最近已銷的 10 月 200
    expect(acc.paidByMonth.get('2026-09')).toBe(2000);
    expect(acc.paidByMonth.get('2026-10')).toBe(1500);
    expect(acc.credit).toBe(0);
    const s = summarizeUnit(acc, '2026-09', '2026-10');
    expect(s).toMatchObject({ due: 3700, paid: 3500, owing: 200, owingMonths: ['2026-10'], received: 3500 });
  });

  it('respects manual write-offs and keeps the rest as credit', () => {
    const d = setup([pay('A1-3F', '2026-10-05', 5000, '', { allocations: [{ month: '2026-10', amount: 2000 }, { month: '2026-11', amount: 2000 }] })]);
    const acc = allocateAll(d).byKey.get('A1-3F')!;
    expect(acc.allocations.map((a) => [a.month, a.source])).toEqual([['2026-10', 'manual'], ['2026-11', 'manual']]);
    expect(acc.credit).toBe(1000);
  });

  it('writes off every item (no keyword filter) and lists unknown door numbers', () => {
    const d = setup([pay('A1-3F', '2026-09-05', 2300, '115/09'), pay('Z9-9F', '2026-10-05', 2000)], [due('A1-3F', '2026-09', 300, '車位清潔費')]);
    const r = allocateAll(d);
    expect(r.byKey.get('A1-3F')!.dueByMonth.get('2026-09')).toBe(2300);
    expect(r.byKey.get('A1-3F')!.paidByMonth.get('2026-09')).toBe(2300);
    expect(r.unmatched.map((p) => p.unitNo)).toEqual(['Z9-9F']);
    expect(unitNosFromPayments(d.payments, d.settings.units)).toEqual(['Z9-9F']);
  });

  it('summarises paid, owing, prepaid and paid-through per door number', () => {
    const d = setup([pay('A1-5F', '2026-10-30', 6000, '115/10~115/12'), pay('A1-3F', '2026-09-10', 2000)]);
    const r = allocateAll(d);
    expect(summarizeUnit(r.byKey.get('A1-5F')!, '2026-09', '2026-10')).toMatchObject({ due: 4000, paid: 2000, owing: 2000, owingMonths: ['2026-09'], prepaid: 4000, received: 6000, paidThrough: '' });
    expect(summarizeUnit(r.byKey.get('A1-3F')!, '2026-09', '2026-10')).toMatchObject({ due: 4000, paid: 2000, owingMonths: ['2026-10'], paidThrough: '2026-09', lastPaidDate: '2026-09-10' });
  });

  it('computes prepaid balance and monthly write-off', () => {
    const d = setup([pay('A1-5F', '2026-10-30', 6000, '115/10~115/12'), pay('A1-3F', '2026-11-05', 4000)]);
    const r = allocateAll(d);
    expect(advancesFromAllocations(r, d.payments, '2026-10')).toEqual({ prepaid: 4000, suspense: 0 });
    expect(receiptBreakdown(r, d.payments, '2026-10-01', '2026-10-31')).toEqual({ current: 2000, prepaid: 4000, arrears: 0, credit: 0, unmatched: 0 });
    expect(receiptBreakdown(r, d.payments, '2026-11-01', '2026-11-30')).toMatchObject({ current: 0, arrears: 4000 });
    expect(monthWriteOff(r, d.payments, '2026-11')).toMatchObject({ units: 3, due: 6500, writtenOff: 2000, fromPrepaid: 2000, owing: 4500, owingUnits: 2 });
    expect(monthWriteOffByUnit(r, d.payments, '2026-11').map((x) => [x.unitNo, x.due, x.writtenOff, x.fromPrepaid, x.owing])).toEqual([
      ['A1-3F', 2000, 0, 0, 2000],
      ['A1-5F', 2000, 2000, 2000, 0],
      ['B2-2F', 2500, 0, 0, 2500],
    ]);
  });
});

describe('import amount check', () => {
  it('flags new payments that pay more or less than the period due', () => {
    const d = setup([
      pay('A1-3F', '2026-10-05', 2000, '115/10'),
      pay('A1-5F', '2026-10-05', 6000, '115/10'),
      pay('B2-2F', '2026-10-05', 1000, '115/10'),
      pay('A1-5F', '2026-10-06', 4000, '115/11~115/12'),
    ]);
    const ids = new Set(d.payments.map((p) => p.id));
    const checks = findAmountMismatches(d, ids);
    expect(checks.map((c) => [c.account.unit.unitNo, c.payment.amount, c.expected, c.diff])).toEqual([
      ['A1-5F', 6000, 2000, 4000],
      ['B2-2F', 1000, 2500, -1500],
    ]);
    expect(findAmountMismatches(d, new Set())).toEqual([]);
  });
});

describe('deleted units', () => {
  it('excludes deleted units from write-off and lists their payments as unmatched', () => {
    const d = setup([pay('A1-3F', '2026-10-05', 2000, '115/10')]);
    d.settings.units[0].deletedAt = '2026-11-01T00:00:00Z';
    const r = allocateAll(d);
    expect(r.byKey.has('A1-3F')).toBe(false);
    expect(r.unmatched.map((p) => p.unitNo)).toEqual(['A1-3F']);
  });

  it('keeps excluded units excluded on a template import unless unticked', async () => {
    const { applyUnitImport, excludedKeys, planUnitImport } = await import('./owners');
    const units = [{ id: 'x', unitNo: '管理室', owner: '', monthlyFee: 0, note: '', deletedAt: '2026-11-01' }];
    const incoming = [{ unitNo: '管理室', owner: '管理室', zsId: 'z', address: '', month: '2026-11' }, { unitNo: '(A01-02)35號2樓之1', owner: '王', zsId: 'y', address: '', month: '2026-11' }];
    const plan = planUnitImport(units, incoming);
    expect([plan.added, plan.restored]).toEqual([1, 0]);
    expect(Array.from(excludedKeys(units, plan))).toEqual(['管理室']);
    const out = applyUnitImport(units, plan, new Set(), () => 'n');
    expect(out[0]).toEqual(units[0]);
    const back = planUnitImport(units, incoming, new Map([['管理室', false]]));
    expect(back.restored).toBe(1);
    expect(excludedKeys(units, back).size).toBe(0);
    expect(applyUnitImport(units, back, new Set(), () => 'n')[0].deletedAt).toBeUndefined();
  });
});

describe('prepaid vs suspense', () => {
  it('keeps payments without any bill to write off as 暫收, not 預收', () => {
    // 有戶別、有繳費，但完全沒有建立應繳（就像只匯入入帳報表、範本金額未填）
    const d = setup([pay('A1-3F', '2026-10-05', 2000, '115/10'), pay('A1-5F', '2026-10-06', 6000, '115/10~115/12')], [], []);
    const r = allocateAll(d);
    expect(advancesFromAllocations(r, d.payments, '2026-10')).toEqual({ prepaid: 0, suspense: 8000 });
    // 建立 10～12 月應繳後：A1-3F 銷 10 月；A1-5F 銷 10 月，11、12 月轉為預收
    d.dues = ['2026-10', '2026-11', '2026-12'].flatMap((m) => [due('A1-3F', m, 2000), due('A1-5F', m, 2000)]);
    expect(advancesFromAllocations(allocateAll(d), d.payments, '2026-10')).toEqual({ prepaid: 4000, suspense: 0 });
  });
});

describe('write-off print lists', () => {
  it('lists the month payments and every unpaid month separately', async () => {
    const { paidListForMonth, unpaidByMonth } = await import('./allocation');
    const d = setup([pay('A1-5F', '2026-10-30', 6000, '115/10~115/12'), pay('B2-2F', '2026-10-03', 1000, '115/10'), pay('A1-3F', '2026-09-10', 2000)]);
    const r = allocateAll(d);
    const paid = paidListForMonth(r, d.payments, '2026-10');
    expect(paid.map((p) => [p.payment.unitNo, p.payment.amount, p.allocations.map((a) => `${a.month}:${a.amount}`).join(',')])).toEqual([
      ['A1-5F', 6000, '2026-10:2000,2026-11:2000,2026-12:2000'],
      ['B2-2F', 1000, '2026-10:1000'],
    ]);
    expect(unpaidByMonth(r, '2026-10').map((u) => [u.unitNo, u.month, u.owing])).toEqual([
      ['A1-3F', '2026-10', 2000],
      ['A1-5F', '2026-09', 2000],
      ['B2-2F', '2026-09', 2500],
      ['B2-2F', '2026-10', 1500],
    ]);
  });
});

describe('opening prepaid and unreconciled payments', () => {
  it('writes off months from the opening prepaid and keeps the rest as 預收款', () => {
    const d = setup([], [], ['2026-10', '2026-11']);
    d.settings.billingStartMonth = '2026-10';
    d.settings.units[0].openingPrepaid = 6000;
    const r = allocateAll(d);
    const acc = r.byKey.get('A1-3F')!;
    expect([acc.paidByMonth.get('2026-10'), acc.paidByMonth.get('2026-11'), acc.credit]).toEqual([2000, 2000, 2000]);
    expect(advancesFromAllocations(r, d.payments, '2026-11')).toEqual({ prepaid: 2000, suspense: 0 });
    expect(summarizeUnit(acc, '2026-10', '2026-11').received).toBe(0);
  });

  it('leaves payments not yet reconciled out of 預收款 and 暫收款 when asked', () => {
    const d = setup([pay('A1-3F', '2026-10-05', 6000, '115/10~115/12')], [], ['2026-10', '2026-11', '2026-12']);
    const r = allocateAll(d);
    expect(advancesFromAllocations(r, d.payments, '2026-10').prepaid).toBe(4000);
    expect(advancesFromAllocations(r, d.payments, '2026-10', { confirmedOnly: true }).prepaid).toBe(0);
    d.payments[0].depositConfirmed = true;
    expect(advancesFromAllocations(allocateAll(d), d.payments, '2026-10', { confirmedOnly: true }).prepaid).toBe(4000);
  });
});

describe('amount check for payments split into several transfers', () => {
  const ids = (d: ReturnType<typeof setup>) => new Set(d.payments.map((p) => p.id));

  it('does not ask when the parts add up to the bill', () => {
    const d = setup([pay('A1-3F', '2026-11-03', 1000, '115/11'), pay('A1-3F', '2026-11-04', 600, '115/11'), pay('A1-3F', '2026-11-05', 400, '115/11')]);
    d.dues = d.dues.map((x) => ({ ...x, billAmount: x.amount }));
    expect(findAmountMismatches(d, ids(d))).toEqual([]);
  });

  it('asks only about the part that goes over, or the last part when short', () => {
    const over = setup([pay('A1-3F', '2026-11-03', 1000, '115/11'), pay('A1-3F', '2026-11-04', 1000, '115/11'), pay('A1-3F', '2026-11-05', 1500, '115/11')]);
    over.dues = over.dues.map((x) => ({ ...x, billAmount: x.amount }));
    expect(findAmountMismatches(over, ids(over)).map((c) => [c.payment.amount, c.expected, c.diff, c.others])).toEqual([[1500, 0, 1500, { count: 2, amount: 2000 }]]);
    const short = setup([pay('A1-3F', '2026-11-03', 1000, '115/11'), pay('A1-3F', '2026-11-04', 500, '115/11')]);
    short.dues = short.dues.map((x) => ({ ...x, billAmount: x.amount }));
    expect(findAmountMismatches(short, ids(short)).map((c) => [c.payment.amount, c.expected, c.diff])).toEqual([[500, 1000, -500]]);
  });

  it('counts the part imported from an earlier report', () => {
    const first = pay('A1-3F', '2026-11-03', 1200, '115/11');
    const second = pay('A1-3F', '2026-11-10', 800, '115/11');
    const d = setup([first, second]);
    d.dues = d.dues.map((x) => ({ ...x, billAmount: x.amount }));
    expect(findAmountMismatches(d, new Set([second.id]))).toEqual([]);
    const again = pay('A1-3F', '2026-11-12', 2000, '115/11');
    d.payments.push(again);
    expect(findAmountMismatches(d, new Set([again.id])).map((c) => [c.expected, c.diff])).toEqual([[0, 2000]]);
  });
});

describe('payments for bills before the billing start month', () => {
  /** 從 11 月開始記帳，只匯入 11 月帳單；入帳報表裡有 10 月期別的繳款。 */
  function fromNov(payments: Payment[], extraDues: Due[] = []) {
    const d = setup(payments, extraDues, ['2026-11']);
    d.settings.billingStartMonth = '2026-11';
    return d;
  }

  it('does not use an October bill payment to clear November, nor keep it as 暫收', () => {
    const d = fromNov([pay('A1-3F', '2026-10-15', 4000, '115年10月管理費')]);
    const r = allocateAll(d);
    const acc = r.byKey.get('A1-3F')!;
    expect(acc.allocations).toEqual([]);
    expect(acc.credit).toBe(0);
    expect(acc.beforeStart.size).toBe(1);
    expect(advancesFromAllocations(r, d.payments, '2026-11')).toEqual({ prepaid: 0, suspense: 0 });
    expect(summarizeUnit(acc, '2026-11', '2026-11').owing).toBe(2000);
    expect(receiptBreakdown(r, d.payments, '2026-10-01', '2026-10-31').arrears).toBe(4000);
    expect(findAmountMismatches(d, new Set(d.payments.map((p) => p.id)))).toEqual([]);
  });

  it('still writes off October arrears carried on the November bill', () => {
    const d = fromNov([pay('A1-3F', '2026-11-02', 2000, '115年10月管理費')], [{ ...due('A1-3F', '2026-10', 2000, '前期欠款'), fromBill: '2026-11' }]);
    const acc = allocateAll(d).byKey.get('A1-3F')!;
    expect(acc.allocations.map((a) => [a.month, a.amount])).toEqual([['2026-10', 2000]]);
    expect(acc.beforeStart.size).toBe(0);
  });

  it('keeps payments without a period and November payments on the normal rules', () => {
    const d = fromNov([pay('A1-3F', '2026-10-20', 2000), pay('A1-5F', '2026-11-05', 2000, '115年11月管理費')]);
    const r = allocateAll(d);
    expect(r.byKey.get('A1-3F')!.allocations.map((a) => a.month)).toEqual(['2026-11']);
    expect(r.byKey.get('A1-5F')!.allocations.map((a) => a.month)).toEqual(['2026-11']);
  });
});
