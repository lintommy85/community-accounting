import { describe, expect, it } from 'vitest';
import { emptyData } from './defaults';
import { mergeRows } from './ledger';
import { buildStatement, FEE_LABEL, monthPeriods, positionFor, yearPeriods } from './statement';
import { LedgerEntry } from './types';

function fixture() {
  const d = emptyData();
  d.payments = mergeRows(
    [],
    [
      { rowNumber: 1, unitNo: 'A1', payerName: '', billPeriod: '115/09', item: '管理費', paidDate: '2026-09-29', channel: 'ATM', amount: 2000, fee: 15, reportDepositDate: '2026-09-30', depositAmount: null, txnNo: '', status: '', note: '' },
      { rowNumber: 2, unitNo: 'A2', payerName: '', billPeriod: '115/10', item: '管理費', paidDate: '2026-10-05', channel: 'ATM', amount: 2000, fee: 15, reportDepositDate: '2026-10-07', depositAmount: null, txnNo: '', status: '', note: '' },
      { rowNumber: 3, unitNo: 'A2', payerName: '', billPeriod: '115/10', item: '車位清潔費', paidDate: '2026-10-05', channel: '現金', amount: 300, fee: 0, reportDepositDate: '2026-10-05', depositAmount: null, txnNo: '', status: '', note: '' },
    ],
    'b1',
  ).payments;
  const e = (date: string, type: LedgerEntry['type'], category: string, amount: number, accountId = 'acc_main', toAccountId = ''): LedgerEntry => ({
    id: `${date}${category}`, date, type, category, accountId, toAccountId, amount, counterparty: '', voucherNo: '', note: '',
  });
  d.entries = [
    e('2026-10-10', 'expense', '電費', 1200),
    e('2026-10-12', 'expense', '清潔費', 500),
    e('2026-10-20', 'income', '利息收入', 30, 'acc_fund'),
    e('2026-10-25', 'transfer', '公共基金提撥', 1000, 'acc_main', 'acc_fund'),
    e('2026-03-01', 'expense', '電費', 900),
  ];
  return d;
}

describe('income statement', () => {
  it('builds a month report with year-to-date column', () => {
    const st = buildStatement(fixture(), monthPeriods('2026-10'), { basis: 'paid', fund: '' });
    expect(st.columns).toEqual(['本月', '本年累計']);
    expect(st.income.map((l) => [l.label, ...l.values])).toEqual([
      ['管理費收入－管理費', 2000, 4000],
      ['管理費收入－車位清潔費', 300, 300],
      ['利息收入', 30, 30],
    ]);
    expect(st.expense.map((l) => [l.label, ...l.values])).toEqual([
      ['清潔費', 500, 500],
      ['電費', 1200, 2100],
      [FEE_LABEL, 15, 30],
    ]);
    expect(st.net).toEqual([2330 - 1715, 4330 - 2630]);
  });

  it('recognises management fee by deposit date when asked', () => {
    // 入帳日來自報表：09-29 繳 → 09-30 入帳；10-05 繳 → 10-07 入帳。
    const st = buildStatement(fixture(), monthPeriods('2026-09'), { basis: 'deposit', fund: '' });
    expect(st.incomeTotals[0]).toBe(2000);
  });

  it('builds a 12-month year report plus total column', () => {
    const st = buildStatement(fixture(), yearPeriods(2026), { basis: 'paid', fund: '' });
    expect(st.columns).toHaveLength(13);
    const elec = st.expense.find((l) => l.label === '電費')!;
    expect(elec.values[2]).toBe(900);
    expect(elec.values[9]).toBe(1200);
    expect(elec.values[12]).toBe(2100);
  });

  it('shows inter-fund transfers only when filtering by fund', () => {
    const all = buildStatement(fixture(), monthPeriods('2026-10'), { basis: 'paid', fund: '' });
    expect(all.expense.some((l) => l.label.includes('提撥'))).toBe(false);
    const fund = buildStatement(fixture(), monthPeriods('2026-10'), { basis: 'paid', fund: '公共基金' });
    expect(fund.income.map((l) => [l.label, l.values[0]])).toEqual([['利息收入', 30], ['轉入－公共基金提撥', 1000]]);
    expect(fund.expense).toEqual([]);
    const mgmt = buildStatement(fixture(), monthPeriods('2026-10'), { basis: 'paid', fund: '管理費' });
    expect(mgmt.expense.find((l) => l.label === '轉出－公共基金提撥')?.values[0]).toBe(1000);
  });

  it('computes period-end position per fund', () => {
    const pos = positionFor(fixture(), '2026-10-01', '2026-10-31', '公共基金');
    expect(pos.balances.map((b) => [b.name, b.closing])).toEqual([['公共基金帳戶', 1030]]);
    expect(pos.inTransit).toBe(0);
  });
});

describe('signature rows', () => {
  it('splits slots into up to two rows and skips blank labels', async () => {
    const { signatureRows } = await import('./statement');
    const rows = signatureRows([
      { id: '1', label: '主委', row: 1 },
      { id: '2', label: '財委', row: 2 },
      { id: '3', label: '', row: 1 },
      { id: '4', label: '監委', row: 2 },
    ]);
    expect(rows.map((r) => r.map((s) => s.label))).toEqual([['主委'], ['財委', '監委']]);
  });

  it('exports statement with signature labels', async () => {
    const XLSX = await import('xlsx');
    const { exportStatement } = await import('./xlsxio');
    const d = fixture();
    const st = buildStatement(d, monthPeriods('2026-10'), { basis: 'paid', fund: '' });
    const blob = exportStatement(d, 'T', 'S', st, positionFor(d, '2026-10-01', '2026-10-31', ''));
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets['收支報表']);
    expect(csv).toContain(',主任委員,財務委員,監察委員,製表人');
    expect(csv).toContain('本期結餘,615,1700');
  });
});

describe('management fee received in the month, written off per month', () => {
  it('counts prepaid fees fully as income when received and breaks them down by write-off month', () => {
    const d = fixture();
    d.settings.billingStartMonth = '2026-09';
    d.settings.units = [
      { id: 'u1', unitNo: 'A1', owner: '', monthlyFee: 1000, note: '' },
      { id: 'u2', unitNo: 'A2', owner: '', monthlyFee: 1000, note: '' },
    ];
    d.dues = ['2026-09', '2026-10'].flatMap((month) => ['A1', 'A2'].map((unitNo) => ({ id: `${unitNo}${month}`, unitNo, month, item: '管理費', amount: 1000, source: 'import' as const, note: '', updatedAt: '' })));
    const st = buildStatement(d, monthPeriods('2026-10'), { basis: 'paid', fund: '' });
    const labels = st.income.map((l) => [l.label, l.values[0], !!l.sub]);
    // 10 月收到 A2 2000（期別 10 月 → 10 月銷 1000，餘額先銷 A2 的 09 月舊欠）
    expect(labels).toEqual([
      ['管理費收入－管理費', 2000, false],
      ['　其中：當期銷帳', 1000, true],
      ['　其中：補繳以前月份', 1000, true],
      // 所有項目都列入銷帳；沒有車位費帳單，所以 300 為暫收
      ['　其中：暫收（尚無應繳可銷帳）', 300, true],
      ['管理費收入－車位清潔費', 300, false],
      ['利息收入', 30, false],
    ]);
    expect(st.incomeTotals[0]).toBe(2330);
  });

  it('shows prepayment as income in the month received', () => {
    const d = fixture();
    d.settings.billingStartMonth = '2026-10';
    d.settings.units = [{ id: 'u2', unitNo: 'A2', owner: '', monthlyFee: 500, note: '' }];
    d.dues = ['2026-10', '2026-11', '2026-12', '2027-01'].map((month) => ({ id: month, unitNo: 'A2', month, item: '管理費', amount: 500, source: 'import' as const, note: '', updatedAt: '' }));
    const st = buildStatement(d, monthPeriods('2026-10'), { basis: 'paid', fund: '' });
    const get = (label: string) => st.income.find((l) => l.label === label)?.values[0];
    expect(get('管理費收入－管理費')).toBe(2000);
    expect(get('　其中：當期銷帳')).toBe(500);
    expect(get('　其中：預收（銷以後月份）')).toBe(1500);
  });
});

describe('財務收支總表 lines', () => {
  it('splits management fee income per item and marks fixed categories', async () => {
    const { monthSheet } = await import('./statement');
    const d = fixture();
    d.settings.billingStartMonth = '2026-09';
    d.settings.units = [{ id: 'u2', unitNo: 'A2', owner: '', monthlyFee: 1000, note: '' }];
    d.dues = ['2026-10', '2026-11'].map((month) => ({ id: month, unitNo: 'A2', month, item: '管理費', amount: 1000, source: 'import' as const, note: '', updatedAt: '' }));
    d.settings.fixedCategories = ['電費'];
    const sheet = monthSheet(d, '2026-10');
    // 所有收費項目共用同一個銷帳順序：同日繳的車位清潔費先銷 10 月，管理費剩餘部分列預收／暫收
    expect(sheet.income.map((l) => [l.subject, l.item, l.amount, l.fixed])).toEqual([
      ['管理費收入', '車位清潔費收入', 300, false],
      ['管理費收入', '管理費收入', 700, false],
      ['管理費收入', '管理費預收款', 1000, false],
      ['管理費收入', '管理費暫收款', 300, false],
      ['利息收入', '利息收入', 30, false],
    ]);
    expect(sheet.income.filter((l) => l.subject === '管理費收入').reduce((s, l) => s + l.amount, 0)).toBe(2300);
    expect(sheet.expense.map((l) => [l.subject, l.amount, l.fixed])).toEqual([
      ['清潔費', 500, false],
      ['電費', 1200, true],
    ]);
  });
});
