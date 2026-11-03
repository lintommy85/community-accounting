import { describe, expect, it } from 'vitest';
import { advancesFromAllocations, allocateAll, findAmountMismatches, prepaidLedger } from './allocation';
import { applyBaselineUpdates, ARREARS_ITEM, BILL_ARREARS, BILL_ASIS, BILL_PREPAID, billItemName, DiffDecision, planBillImport, suggestBillItem } from './bills';
import { emptyData } from './defaults';
import { applyDueChanges, diffDues, DueRow } from './dues';
import { setUnitItemBaseline, unitBaselines } from './fees';
import { AppData, Due, Payment } from './types';

const due = (unitNo: string, month: string, amount: number, item = '管理費'): Due => ({ id: `d-${unitNo}-${month}-${item}`, unitNo, month, item, amount, source: 'import', note: '', updatedAt: '', kind: 'fee', billAmount: amount });
const pay = (id: string, unitNo: string, paidDate: string, amount: number, billPeriod = ''): Payment => ({
  id, batchId: 'b', unitNo, payerName: '', billPeriod, item: '管理費', paidDate, channel: 'ATM',
  amount, fee: 0, reportDepositDate: '', depositDate: paidDate, depositConfirmed: false, txnNo: '', status: '', note: '', voided: false,
});
const bill = (unitNo: string, amount: number, item = '11月管理費', month = '2026-11'): DueRow => ({ unitNo, owner: '', month, item, amount });

/** 管理費基準 2000；A 戶 10 月沒繳、B 戶 10 月已繳；汽車位清潔費方案 500。 */
function setup(): AppData {
  const d = emptyData();
  d.settings.feePlans = [{ id: 'car', name: '汽車位清潔費', amount: 500 }];
  d.settings.units = [
    { id: 'a', unitNo: 'A', owner: '', monthlyFee: 2000, note: '' },
    { id: 'b', unitNo: 'B', owner: '', monthlyFee: 2000, note: '', extras: [{ planId: 'car', qty: 1 }] },
  ];
  d.dues = [due('A', '2026-10', 2000), due('B', '2026-10', 2000)];
  d.payments = [pay('p1', 'B', '2026-10-05', 2000, '115/10')];
  return d;
}

function importBills(d: AppData, rows: DueRow[], decisions?: Map<string, DiffDecision>, rebase = false) {
  const plan = planBillImport(d, rows, { decisions, rebase });
  const changes = diffDues(d.dues, plan.rows, plan.billed);
  return { plan, changes, dues: applyDueChanges(d.dues, changes) };
}

describe('bill item mapping', () => {
  it('strips the month prefix and suggests a target', () => {
    expect(billItemName('11月坪數費')).toBe('坪數費');
    expect(billItemName('10月未繳管理費')).toBe('未繳管理費');
    expect(suggestBillItem('未繳管理費', ['管理費'])).toBe(BILL_ARREARS);
    expect(suggestBillItem('年繳沖銷', ['管理費'])).toBe(BILL_PREPAID);
    expect(suggestBillItem('委員減免', ['管理費'])).toBe(BILL_ASIS);
    expect(suggestBillItem('預繳扣抵', ['管理費'])).toBe(BILL_PREPAID);
    expect(suggestBillItem('腳踏車清潔費', ['管理費', '腳踏車位清潔費'])).toBe('腳踏車位清潔費');
    expect(suggestBillItem('坪數費', ['管理費'])).toBe('');
  });

  it('refuses to import until every bill item is mapped to the baseline', () => {
    const d = setup();
    const rows = [bill('B', 2000, '11月坪數費'), bill('B', 500, '11月汽車位清潔費'), bill('B', 100, '11月機車位清潔費')];
    expect(planBillImport(d, rows)).toMatchObject({ unmapped: ['坪數費', '機車位清潔費'], rows: [] });
    d.settings.billItemMap = { 坪數費: '管理費' };
    d.settings.feePlans.push({ id: 'moto', name: '機車位清潔費', amount: 100 });
    expect(planBillImport(d, rows).unmapped).toEqual([]);
  });
});

describe('splitting 智生活 bills against the baseline', () => {
  it('keeps arrears lines out of the dues and does not count them twice', () => {
    const d = setup();
    d.settings.billItemMap = { 未繳管理費: BILL_ARREARS };
    const { plan, dues } = importBills(d, [bill('A', 2000), bill('A', 2000, '10月未繳管理費')]);
    expect(plan.diffs).toEqual([]);
    expect(plan.splits[0]).toMatchObject({ base: 2000, carried: 2000, arrears: 2000, prior: 0, flags: [] });
    const nov = dues.filter((x) => x.unitNo === 'A' && x.month === '2026-11');
    expect(nov.map((x) => [x.item, x.amount, x.billAmount, x.kind])).toEqual([[ARREARS_ITEM, 0, 2000, 'arrears'], ['管理費', 2000, 2000, 'fee']]);
    d.dues = dues;
    const acc = allocateAll(d).byKey.get('A')!;
    expect(acc.dueByMonth.get('2026-10')! + acc.dueByMonth.get('2026-11')!).toBe(4000);
    // 繳清整張帳單不跳多繳確認；兩個月都銷清
    d.payments.push(pay('p2', 'A', '2026-11-10', 4000, '115/11'));
    expect(findAmountMismatches(d, new Set(['p2']))).toEqual([]);
    const paid = allocateAll(d).byKey.get('A')!;
    expect([paid.paidByMonth.get('2026-10'), paid.paidByMonth.get('2026-11')]).toEqual([2000, 2000]);
  });

  it('treats a renamed main plan (坪數費) and 管理費 as the same main fee', () => {
    const d = setup();
    d.settings.feePlans.push({ id: 'area', name: '坪數費', amount: 100, basis: 'area' });
    d.settings.units[0] = { ...d.settings.units[0], planId: 'area', area: 20, monthlyFee: 2000 };
    const { plan, dues } = importBills(d, [bill('A', 2000, '11月坪數費')]);
    expect(plan.diffs).toEqual([]);
    expect(dues.find((x) => x.unitNo === 'A' && x.month === '2026-11')).toMatchObject({ item: '坪數費', amount: 2000 });
    // 個別金額的戶別：帳單對應到主方案名稱也算主要費用
    d.settings.billItemMap = {};
    expect(importBills(d, [bill('B', 2000, '11月坪數費'), bill('B', 500, '11月汽車位清潔費')]).plan.diffs).toEqual([]);
  });

  it('records arrears the system does not know as 前期欠款', () => {
    const d = setup();
    d.settings.billItemMap = { 前期未繳: BILL_ARREARS };
    const { plan, dues } = importBills(d, [bill('B', 2000), bill('B', 500, '11月汽車位清潔費'), bill('B', 3000, '前期未繳')]);
    expect(plan.splits[0]).toMatchObject({ carried: 3000, arrears: 0, prior: 3000, flags: ['prior'] });
    expect(dues.find((x) => x.item === '前期欠款')).toMatchObject({ month: '2026-10', amount: 3000, fromBill: '2026-11' });
  });

  it('lists every household item that differs from the baseline and waits for a decision', () => {
    const d = setup();
    const rows = [bill('A', 2000), bill('B', 2000), bill('B', 600, '11月汽車位清潔費')];
    const first = importBills(d, rows);
    expect(first.plan.diffs.map((x) => [x.unitNo, x.item, x.base, x.bill])).toEqual([['B', '汽車位清潔費', 500, 600]]);
    // 不更新：基準不變，多出的 100 視為帳單內含逾期
    const keep = importBills(d, rows, new Map([[first.plan.diffs[0].key, 'keep']]));
    expect(keep.plan.splits[1]).toMatchObject({ base: 2500, carried: 100 });
    expect(keep.plan.baselineUpdates.size).toBe(0);
    // 更新基準：應繳照帳單，戶別基準改為 600
    const upd = importBills(d, rows, new Map([[first.plan.diffs[0].key, 'update']]));
    expect(upd.plan.splits[1]).toMatchObject({ base: 2600, carried: 0 });
    const units = applyBaselineUpdates(d.settings, upd.plan.baselineUpdates);
    expect(unitBaselines(units[1], d.settings.feePlans).get('汽車位清潔費')).toBe(600);
  });

  it('lists items missing from the bill and items the household has no baseline for', () => {
    const d = setup();
    const { plan } = importBills(d, [bill('A', 2000), bill('A', 500, '11月汽車位清潔費'), bill('B', 2000)]);
    expect(plan.diffs.map((x) => [x.unitNo, x.item, x.base, x.bill])).toEqual([['A', '汽車位清潔費', 0, 500], ['B', '汽車位清潔費', 500, 0]]);
  });

  it('keeps 沖銷／減免 items as they are, without comparing to the baseline', () => {
    const d = setup();
    d.settings.billItemMap = { 年繳沖銷: BILL_ASIS };
    const { plan, dues } = importBills(d, [bill('B', 2000), bill('B', 500, '11月汽車位清潔費'), bill('B', -2500, '年繳沖銷')]);
    expect(plan.diffs).toEqual([]);
    expect(dues.filter((x) => x.unitNo === 'B' && x.month === '2026-11').reduce((t, x) => t + x.amount, 0)).toBe(0);
  });

  it('pays 年繳沖銷 months from the annual payment already received; falls back to reducing the due', () => {
    const d = setup();
    d.settings.billItemMap = { 年繳沖銷: BILL_PREPAID };
    d.dues = [due('A', '2026-10', 2000)];
    d.payments = [pay('y', 'A', '2026-10-02', 24000, '115/10')];
    const { plan, dues } = importBills(d, [bill('A', 2000), bill('A', -2000, '年繳沖銷')]);
    expect(plan.splits[0]).toMatchObject({ prepaid: 2000, prepaidBefore: 0 });
    d.dues = dues;
    const acc = allocateAll(d).byKey.get('A')!;
    expect([acc.dueByMonth.get('2026-11'), acc.paidByMonth.get('2026-11'), acc.credit]).toEqual([2000, 2000, 20000]);
    expect(findAmountMismatches({ ...d, payments: [...d.payments, pay('z', 'A', '2026-11-05', 1, '115/11')] }, new Set(['z']))[0].expected).toBe(0);
    // 系統沒有預繳款：照帳單減少應繳
    const none = setup();
    none.settings.billItemMap = { 年繳沖銷: BILL_PREPAID };
    const r = importBills(none, [bill('B', 2000), bill('B', 500, '11月汽車位清潔費'), bill('B', -2500, '年繳沖銷')]);
    expect(r.plan.splits[0]).toMatchObject({ prepaid: 0, prepaidBefore: 2500 });
    expect(r.dues.filter((x) => x.unitNo === 'B' && x.month === '2026-11').reduce((t, x) => t + x.amount, 0)).toBe(0);
  });

  it('pays 年繳沖銷 from the opening prepaid entered for households that prepaid before the system started', () => {
    const d = setup();
    d.settings.billingStartMonth = '2026-11';
    d.settings.billItemMap = { 年繳沖銷: BILL_PREPAID };
    d.dues = [];
    d.payments = [];
    d.settings.units[1].openingPrepaid = 2500 * 8;
    const { plan, dues } = importBills(d, [bill('B', 2000), bill('B', 500, '11月汽車位清潔費'), bill('B', -2500, '年繳沖銷')]);
    expect(plan.splits[0]).toMatchObject({ bill: 0, base: 2500, carried: 0, prior: 0, prepaid: 2500, prepaidBefore: 0 });
    d.dues = dues;
    const acc = allocateAll(d).byKey.get('B')!;
    expect([acc.dueByMonth.get('2026-11'), acc.paidByMonth.get('2026-11'), acc.credit]).toEqual([2500, 2500, 17500]);
    expect(advancesFromAllocations(allocateAll(d), d.payments, '2026-11')).toEqual({ prepaid: 17500, suspense: 0 });
  });

  it('takes 沖銷 out of the household’s prepaid even when an older month is still unpaid', () => {
    const d = setup();
    d.settings.billItemMap = { 年繳沖銷: BILL_PREPAID };
    // A 戶 10 月沒繳；10 月另外溢繳 6000（沒有期別）
    d.payments = [pay('x', 'A', '2026-10-20', 6000)];
    const before = allocateAll(d).byKey.get('A')!;
    expect([before.paidByMonth.get('2026-10'), before.credit]).toEqual([2000, 4000]);
    const { plan, dues } = importBills(d, [bill('A', 2000), bill('A', -2000, '年繳沖銷')]);
    expect(plan.splits[0]).toMatchObject({ prepaid: 2000, prepaidBalance: 6000, prepaidBefore: 0 });
    d.dues = dues;
    const acc = allocateAll(d).byKey.get('A')!;
    expect(acc.allocations.filter((a) => a.source === 'offset').map((a) => [a.month, a.amount])).toEqual([['2026-11', 2000]]);
    expect([acc.paidByMonth.get('2026-10'), acc.paidByMonth.get('2026-11'), acc.credit]).toEqual([2000, 2000, 2000]);
  });

  it('counts an overpayment as prepaid and uses it for next month’s bill like a 沖銷', () => {
    const d = setup();
    // B 戶 10 月已繳；10 月 25 日又多繳 3000（沒有欠繳）
    d.payments.push(pay('o', 'B', '2026-10-25', 3000, '115/10'));
    expect(advancesFromAllocations(allocateAll(d), d.payments, '2026-10')).toEqual({ prepaid: 3000, suspense: 0 });
    const { plan, dues } = importBills(d, [bill('B', 2000), bill('B', 500, '11月汽車位清潔費')]);
    expect(plan.splits[0]).toMatchObject({ base: 2500, autoPrepaid: 2500, autoBalance: 3000 });
    d.dues = dues;
    const r = allocateAll(d);
    expect(r.byKey.get('B')!.paidByMonth.get('2026-11')).toBe(2500);
    expect(advancesFromAllocations(r, d.payments, '2026-11')).toEqual({ prepaid: 500, suspense: 0 });
    const { rows, uses } = prepaidLedger(r, '2026-11');
    expect(rows.find((x) => x.unitNo === 'B')).toMatchObject({ opening: 3000, added: 0, used: 2500, closing: 500 });
    expect(uses.map((u) => [u.unitNo, u.payment.id, u.amount])).toEqual([['B', 'o', 2500]]);
  });

  it('keeps a payment as 暫收 while the bill for its period is not imported yet', () => {
    const d = setup();
    d.payments.push(pay('n', 'B', '2026-10-28', 2500, '115/11'));
    expect(advancesFromAllocations(allocateAll(d), d.payments, '2026-10')).toEqual({ prepaid: 0, suspense: 2500 });
    const { plan } = importBills(d, [bill('B', 2000), bill('B', 500, '11月汽車位清潔費')]);
    expect(plan.splits[0].autoPrepaid).toBe(0);
  });

  it('never treats a bill that 沖銷 brings to 0 as arrears, even without a baseline', () => {
    const d = setup();
    d.settings.billItemMap = { 年繳沖銷: BILL_PREPAID };
    d.settings.units[0].monthlyFee = 0;
    d.dues = [];
    d.payments = [];
    const rows = [bill('A', 2676), bill('A', -2676, '年繳沖銷')];
    const keep = new Map<string, DiffDecision>([['A|2026-11|管理費', 'keep']]);
    const { plan, dues } = importBills(d, rows, keep);
    expect(plan.splits[0]).toMatchObject({ bill: 0, carried: 0, prior: 0 });
    expect(dues.filter((x) => x.unitNo === 'A').reduce((t, x) => t + x.amount, 0)).toBe(0);
    expect(dues.some((x) => x.item === '前期欠款')).toBe(false);
  });

  it('keeps the baseline used when a month was imported; later rate changes only affect new months', () => {
    const d = setup();
    d.dues = importBills(d, [bill('A', 2000)]).dues;
    d.settings.units[0].monthlyFee = 2200;
    const again = importBills(d, [bill('A', 2000)]);
    expect(again.plan.diffs).toEqual([]);
    expect(again.changes.every((c) => c.status === 'same')).toBe(true);
    expect(importBills(d, [bill('A', 2200, '12月管理費', '2026-12')]).plan.diffs).toEqual([]);
    expect(importBills(d, [bill('A', 2000)], undefined, true).plan.diffs.map((x) => [x.base, x.bill])).toEqual([[2200, 2000]]);
  });

  it('spreads an annual bill over 12 months from a custom start month', () => {
    const d = setup();
    d.dues = [];
    d.payments = [];
    d.settings.units[0].cycle = 12;
    d.settings.units[0].cycleStart = 7;
    const { plan, dues } = importBills(d, [bill('A', 24000, '07月管理費', '2026-07')]);
    expect(plan.diffs).toEqual([]);
    const months = dues.filter((x) => x.unitNo === 'A').map((x) => x.month).sort();
    expect([months.length, months[0], months[11]]).toEqual([12, '2026-07', '2027-06']);
    d.dues = dues;
    d.payments = [pay('y1', 'A', '2026-07-05', 24000, '115/07')];
    expect(findAmountMismatches(d, new Set(['y1']))).toEqual([]);
    expect(allocateAll(d).byKey.get('A')!.paidByMonth.get('2027-06')).toBe(2000);
    expect(importBills(d, [bill('A', 2000)]).plan.splits[0].flags).toEqual(['offCycle']);
  });
});

describe('payments across a rate change', () => {
  it('asks which month to write off when the amount matches last month’s unpaid bill', () => {
    const d = setup();
    d.dues = [due('B', '2026-10', 2000), due('B', '2026-10', 500, '汽車位清潔費'), due('B', '2026-11', 2000), due('B', '2026-11', 600, '汽車位清潔費')];
    d.payments = [pay('late', 'B', '2026-11-03', 2500, '115/11')];
    expect(findAmountMismatches(d, new Set(['late'])).map((c) => [c.expected, c.prev])).toEqual([[2600, { month: '2026-10', bill: 2500 }]]);
    d.payments = [pay('ok', 'B', '2026-11-03', 2600, '115/11')];
    expect(findAmountMismatches(d, new Set(['ok']))).toEqual([]);
  });
});

describe('updating a household baseline from the bill', () => {
  it('changes 坪數 for area plans, 數量 for multiples, otherwise a custom amount', () => {
    const plans = [{ id: 'area', name: '管理費', amount: 100, basis: 'area' as const }, { id: 'car', name: '汽車位清潔費', amount: 500 }];
    const u = { id: 'x', unitNo: 'X', owner: '', monthlyFee: 2900, note: '', planId: 'area', area: 29, extras: [{ planId: 'car', qty: 1 }] };
    expect(setUnitItemBaseline(u, '管理費', 2933, plans)).toMatchObject({ planId: 'area', area: 29.33, monthlyFee: 2933 });
    expect(setUnitItemBaseline(u, '汽車位清潔費', 1000, plans).extras).toEqual([{ planId: 'car', qty: 2 }]);
    expect(setUnitItemBaseline(u, '汽車位清潔費', 650, plans).extras).toEqual([{ item: '汽車位清潔費', amount: 650, qty: 1 }]);
    expect(setUnitItemBaseline(u, '汽車位清潔費', 0, plans).extras).toEqual([]);
  });
});
