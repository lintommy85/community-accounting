import { describe, expect, it } from 'vitest';
import { allocateAll, prepaidLedger, prepaidTotals } from './allocation';
import { BILL_ARREARS, BILL_ASIS, BILL_PREPAID } from './bills';
import { emptyData } from './defaults';
import { optionalItemChoices, owingAt, receivableRollForward, reportLabels } from './receivable';
import { Due, Payment } from './types';

let seq = 0;
function pay(unitNo: string, paidDate: string, amount: number, billPeriod: string, depositDate: string): Payment {
  seq++;
  return {
    id: `r${seq}`, batchId: 'b', unitNo, payerName: '', billPeriod, item: '管理費', paidDate, channel: 'ATM',
    amount, fee: 0, reportDepositDate: '', depositDate, depositConfirmed: false, txnNo: '', status: '', note: '', voided: false,
  };
}

const due = (unitNo: string, month: string, amount: number, item = '管理費', kind?: Due['kind']): Due => ({
  id: `d-${unitNo}-${month}-${item}`, unitNo, month, item, amount, source: 'import', note: '', updatedAt: '', ...(kind ? { kind, billAmount: amount } : {}),
});

/**
 * A 戶每月 2000、B 戶每月 2500，10、11 月都有帳單；B 戶 11 月有委員減免 500。
 * A：10/28 繳 10 月、11/2 才入帳；11/20 繳 11～12 月（12 月帳單還沒匯入，暫收）；11/29 多繳 1000、12/1 才入帳。
 * B：10/15 預繳 11 月 2000；11/5 補繳 10 月的一部分 1500。
 */
function setup() {
  const d = emptyData();
  d.settings.billingStartMonth = '2026-10';
  d.settings.totalUnits = 2;
  d.settings.units = [
    { id: 'u1', unitNo: 'A', owner: '甲', monthlyFee: 2000, note: '' },
    { id: 'u2', unitNo: 'B', owner: '乙', monthlyFee: 2500, note: '' },
  ];
  d.settings.billItemMap = { 委員減免: BILL_ASIS, 年繳沖銷: BILL_PREPAID, 未繳管理費: BILL_ARREARS };
  d.dues = [due('A', '2026-10', 2000), due('B', '2026-10', 2500), due('A', '2026-11', 2000), due('B', '2026-11', 2500), due('B', '2026-11', -500, '委員減免', 'asis')];
  d.payments = [
    pay('A', '2026-10-28', 2000, '115/10', '2026-11-02'),
    pay('B', '2026-10-15', 2000, '115/11', '2026-10-15'),
    pay('B', '2026-11-05', 1500, '115/10', '2026-11-05'),
    pay('A', '2026-11-20', 4000, '115/11~115/12', '2026-11-21'),
    pay('A', '2026-11-29', 1000, '', '2026-12-01'),
  ];
  return d;
}

const rows = (d: ReturnType<typeof setup>, month: string) =>
  receivableRollForward(d, allocateAll(d), month).lines.map((l) => [l.label, l.sign, l.amount]);

describe('應收（未繳）管理費變動', () => {
  it('counts the month-end arrears as they were then, before later payments', () => {
    const r = allocateAll(setup());
    expect(owingAt(r, '2026-10')).toEqual({ amount: 2500, units: 1 });
    expect(owingAt(r, '2026-11')).toEqual({ amount: 1000, units: 1 });
  });

  it('rolls the arrears forward and ends at the ledger arrears once the waiver is an optional item', () => {
    const d = setup();
    d.settings.reportFields = { items: [{ bill: '委員減免' }] };
    expect(rows(d, '2026-11')).toEqual([
      ['前期未繳', 0, 2500],
      ['截至本月入帳的在途款項', 1, 2000],
      ['本月應收（基準費率加總）', 1, 4500],
      ['本月預收款沖銷', -1, 2000],
      ['本月已銷帳', -1, 7500],
      ['本月繳款中的預收、暫收', 1, 3000],
      ['委員減免', -1, 500],
      ['截至目前的在途款', -1, 1000],
      ['本月應收（未繳）管理費累計', 0, 1000],
    ]);
    const rf = receivableRollForward(d, allocateAll(d), '2026-11');
    expect([rf.result, rf.owing, rf.owingUnits]).toEqual([1000, 1000, 1]);
    expect(rf.lines.find((l) => l.key === 'arPrepaidUsed')!.amount).toBe(prepaidTotals(prepaidLedger(allocateAll(d), '2026-11').rows).used);
  });

  it('leaves out unset optional items and shows the gap between the baseline and the ledger dues', () => {
    const d = setup();
    const rf = receivableRollForward(d, allocateAll(d), '2026-11');
    expect(rf.lines.some((l) => l.key === 'item')).toBe(false);
    expect([rf.result, rf.owing, rf.baseline, rf.due]).toEqual([1500, 1000, 4500, 4000]);
  });

  it('hides the prepaid adjustment when it is 0 and uses the renamed labels', () => {
    const d = setup();
    d.payments = d.payments.slice(0, 3);
    d.settings.reportFields = { labels: { arWrittenOff: '本月入帳', arResult: '應收管理費累計' }, items: [{ bill: '委員減免', label: '減免' }] };
    const labels = rows(d, '2026-11').map((x) => x[0]);
    expect(labels).toEqual(['前期未繳', '截至本月入帳的在途款項', '本月應收（基準費率加總）', '本月預收款沖銷', '本月入帳', '減免', '截至目前的在途款', '應收管理費累計']);
    expect(reportLabels(d.settings).ppTitle).toBe('預收款項變動');
  });

  it('offers bill items from the mapping except 沖銷 and 逾期 types', () => {
    const choices = optionalItemChoices(setup().settings);
    expect(choices).toContain('委員減免');
    expect(choices).not.toContain('年繳沖銷');
    expect(choices).not.toContain('未繳管理費');
  });
});
