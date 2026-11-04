import { describe, expect, it } from 'vitest';
import { parseDate, parsePeriods } from './dates';
import { defaultSettings, emptyData } from './defaults';
import { awaitingDeposit, depositGroups, inTransitAt, mergeRows, monthReport } from './ledger';
import { extractRows, gridToTable, guessMapping, missingRequired } from './parser';

describe('dates', () => {
  it('parses ROC, slash, compact and Excel serial dates', () => {
    expect(parseDate('115/10/05')).toBe('2026-10-05');
    expect(parseDate('115年10月5日')).toBe('2026-10-05');
    expect(parseDate('2026/1/31 14:22:01')).toBe('2026-01-31');
    expect(parseDate('20261005')).toBe('2026-10-05');
    expect(parseDate(46300)).toBe('2026-10-05');
    expect(parseDate('2026/02/30')).toBe('');
  });

  it('parses bill periods including ranges', () => {
    expect(parsePeriods('115年10月')).toEqual(['2026-10']);
    expect(parsePeriods('2026/10~2026/12')).toEqual(['2026-10', '2026-11', '2026-12']);
    expect(parsePeriods('11510')).toEqual(['2026-10']);
    expect(parsePeriods('')).toEqual([]);
  });
});

const sampleGrid = [
  ['某某社區 管理費入帳報表'],
  ['列印日期：115/11/01'],
  ['戶號', '住戶姓名', '帳單期別', '收費項目', '應繳金額', '實繳金額', '繳費方式', '繳費日期', '入帳日期', '狀態'],
  ['A1-3F', '王小明', '115/10', '管理費', 2000, 2000, '超商代收', '115/10/28', '115/11/04', '已繳'],
  ['A1-5F', '李大華', '115/10~115/12', '管理費', 6000, 6000, 'ATM轉帳', '115/10/30', '115/11/04', '已繳'],
  ['B2-2F', '陳美麗', '115/10', '管理費', 2000, 2000, 'ATM轉帳', '115/10/20', '115/10/21', '已繳'],
  ['B2-7F', '林志強', '115/10', '管理費', 2000, '', '', '', '', '未繳'],
  ['合計', '', '', '', 12000, 10000],
];

describe('parser', () => {
  it('detects header row and maps columns', () => {
    const table = gridToTable('入帳報表', sampleGrid);
    expect(table.headerRow).toBe(2);
    const mapping = guessMapping(table.headers);
    expect(mapping.amount).toBe('實繳金額');
    expect(mapping.paidDate).toBe('繳費日期');
    expect(mapping.unitNo).toBe('戶號');
    expect(mapping.payerName).toBe('住戶姓名');
    expect(mapping.depositDate).toBe('入帳日期');
    expect(missingRequired(mapping)).toEqual([]);
  });

  it('extracts paid rows and skips unpaid / total rows', () => {
    const s = defaultSettings();
    const table = gridToTable('入帳報表', sampleGrid);
    const { rows, issues } = extractRows(table, guessMapping(table.headers), s.excludeStatusKeywords);
    expect(rows.map((r) => r.unitNo)).toEqual(['A1-3F', 'A1-5F', 'B2-2F']);
    expect(issues).toHaveLength(1);
  });
});

describe('month report and in-transit deposits', () => {
  function load() {
    const data = emptyData();
    const table = gridToTable('入帳報表', sampleGrid);
    const { rows } = extractRows(table, guessMapping(table.headers), data.settings.excludeStatusKeywords);
    const merged = mergeRows([], rows, 'b1');
    data.payments = merged.payments;
    return { data, rows, merged };
  }

  it('does not duplicate on re-import', () => {
    const { data, rows } = load();
    const again = mergeRows(data.payments, rows, 'b2');
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(3);
  });

  it('moves undeposited October payments into in-transit at month end', () => {
    const { data } = load();
    const oct = monthReport(data, '2026-10');
    // 入帳日來自報表：10-20 繳的 10-21 入帳；10-28、10-30 繳的 11-04 才入帳 → 10 月底在途。
    expect(oct.received.gross).toBe(10000);
    expect(oct.deposited.gross).toBe(2000);
    expect(oct.closingInTransit.gross).toBe(8000);
    expect(inTransitAt(data.payments, oct.end).map((p) => p.unitNo).sort()).toEqual(['A1-3F', 'A1-5F']);
    expect(oct.prepaid).toBe(4000);
    expect(oct.checkDiff).toBe(0);

    const nov = monthReport(data, '2026-11');
    expect(nov.openingInTransit.gross).toBe(8000);
    expect(nov.depositedFromPrior.gross).toBe(8000);
    expect(nov.closingInTransit.gross).toBe(0);
    expect(nov.checkDiff).toBe(0);
  });

  it('groups deposits by report deposit date and payment method text', () => {
    const { data } = load();
    const groups = depositGroups(data.payments, '2026-11');
    expect(groups.map((g) => [g.depositDate, g.channelName, g.totals.gross])).toEqual([
      ['2026-11-04', 'ATM轉帳', 6000],
      ['2026-11-04', '超商代收', 2000],
    ]);
  });

  it('keeps payments without a report deposit date in transit until a later report provides one', () => {
    const data = emptyData();
    const table = gridToTable('入帳報表', sampleGrid.map((r, i) => (i === 3 ? [...r.slice(0, 8), '', ...r.slice(9)] : r)));
    const mapping = guessMapping(table.headers);
    const { rows } = extractRows(table, mapping, data.settings.excludeStatusKeywords);
    data.payments = mergeRows([], rows, 'b1').payments;
    expect(awaitingDeposit(data.payments).map((p) => p.unitNo)).toEqual(['A1-3F']);
    expect(monthReport(data, '2026-11').closingInTransit.gross).toBe(2000);
    // 下個月的報表補上入帳日 → 自動更新
    const full = extractRows(gridToTable('入帳報表', sampleGrid), mapping, data.settings.excludeStatusKeywords).rows;
    const again = mergeRows(data.payments, full, 'b2');
    expect(again.updated).toBe(1);
    data.payments = again.payments;
    expect(awaitingDeposit(data.payments)).toEqual([]);
    expect(monthReport(data, '2026-11').closingInTransit.gross).toBe(0);
  });
});

describe('repeated payment imports with transaction numbers', () => {
  const row = (txnNo: string, amount: number, extra = {}) => ({
    rowNumber: 1, unitNo: 'A1', payerName: '', billPeriod: '115/11', item: '管理費', paidDate: '2026-11-05', channel: 'ATM',
    amount, fee: 0, reportDepositDate: '', depositAmount: null, txnNo, status: '', note: '', ...extra,
  });

  it('updates only rows whose amount or details changed', () => {
    const first = mergeRows([], [row('T1', 2000), row('T2', 2000), row('T3', -300)], 'b1');
    expect(first.added).toBe(3);
    const again = mergeRows(first.payments, [row('T1', 2000), row('T2', 1800), row('T3', -300, { fee: 10 })], 'b2');
    expect([again.added, again.duplicates, again.updated]).toEqual([0, 3, 2]);
    expect(again.payments.map((p) => [p.txnNo, p.amount, p.fee])).toEqual([['T1', 2000, 0], ['T2', 1800, 0], ['T3', -300, 10]]);
  });
});

/** 仿智生活「管理費入帳報表」實際格式（資料為虛構）。 */
const zsDepositReport = [
  ['社區名稱', '範例社區'],
  ['預計入帳日', '2026/10/14'],
  ['統一編號', '12345678'],
  ['銀行分行代號', '8071387'],
  ['撥款帳號', '13801800012345'],
  ['入帳筆數', 3],
  ['代收手續費', 15],
  ['匯款手續費', 0],
  ['撥款金額', 6539],
  ['入帳報表僅會顯示預計存入社區戶頭交易總額及明細…'],
  [],
  ['期別名稱', '戶別代碼', '所有權人', '繳費金額', '繳費日期', '繳費方式', '費用支付模式', '代收手續費', '入帳金額', '銷帳編號', '收據單號'],
  ['115年10月管理費', '(A01-02)35號2樓之1', '王小明', 2000, '2026/10/07', 'ATM/轉帳', '內含', 0, 2000, '57627860000001', '25070810-202610-0001'],
  ['115年10月管理費', '(A02-02)35號2樓之2', '李大華', 2554, '2026/10/09', '超商代收', '內含', 15, 2539, '57627860000002', '25070810-202610-0002'],
  ['115年10月管理費', '(B07-07)37號7樓之7', '陳美麗', 2000, '2026/10/11', '信用卡', '外加', 0, 2000, '57627860000003', '25070810-202610-0003'],
];

describe('智生活入帳報表 format', () => {
  it('uses 預計入帳日 from the header block, 入帳金額 and 收據單號, and splits 期別名稱', async () => {
    const { detectHeaderRow, sheetMeta } = await import('./parser');
    const hr = detectHeaderRow(zsDepositReport);
    expect(hr).toBe(11);
    const meta = sheetMeta(zsDepositReport, hr);
    expect(meta).toEqual({ depositDate: '2026-10-14', payoutAccount: '13801800012345', payoutAmount: 6539, count: 3 });
    const table = gridToTable('入帳明細', zsDepositReport, hr);
    const mapping = guessMapping(table.headers);
    expect(mapping).toMatchObject({ unitNo: '戶別代碼', payerName: '所有權人', billPeriod: '期別名稱', amount: '繳費金額', fee: '代收手續費', depositAmount: '入帳金額', txnNo: '收據單號' });
    const { rows } = extractRows(table, mapping, defaultSettings().excludeStatusKeywords, { depositDate: meta.depositDate });
    expect(rows.map((r) => [r.unitNo, r.billPeriod, r.item, r.amount, r.depositAmount, r.reportDepositDate, r.txnNo])).toEqual([
      ['(A01-02)35號2樓之1', '115年10月管理費', '管理費', 2000, 2000, '2026-10-14', '25070810-202610-0001'],
      ['(A02-02)35號2樓之2', '115年10月管理費', '管理費', 2554, 2539, '2026-10-14', '25070810-202610-0002'],
      ['(B07-07)37號7樓之7', '115年10月管理費', '管理費', 2000, 2000, '2026-10-14', '25070810-202610-0003'],
    ]);
    const payments = mergeRows([], rows, 'b1').payments;
    const total = depositGroups(payments).reduce((s, g) => s + g.totals.net, 0);
    expect(total).toBe(meta.payoutAmount);
  });
});

describe('in transit by payment month end', () => {
  it('marks a payment as in transit when it is not deposited by the end of the month it was paid', async () => {
    const { isMonthEndInTransit } = await import('./ledger');
    const p = (paidDate: string, depositDate: string) => ({ paidDate, depositDate }) as Parameters<typeof isMonthEndInTransit>[0];
    expect(isMonthEndInTransit(p('2026-10-28', '2026-11-04'))).toBe(true);
    expect(isMonthEndInTransit(p('2026-10-20', '2026-10-31'))).toBe(false);
    expect(isMonthEndInTransit(p('2026-10-20', ''))).toBe(true);
  });
});

describe('account registers', () => {
  it('lists each account separately with running balances that match the balance sheet', async () => {
    const { accountRegisters, accountBalances } = await import('./ledger');
    const d = emptyData();
    d.settings.accounts[0].openingBalance = 10000;
    d.settings.accounts[0].openingDate = '2026-09-30';
    d.settings.accounts[1].openingBalance = 50000;
    d.settings.accounts[1].openingDate = '2026-09-30';
    const table = gridToTable('入帳報表', sampleGrid);
    d.payments = mergeRows([], extractRows(table, guessMapping(table.headers), d.settings.excludeStatusKeywords).rows, 'b1').payments;
    const e = (id: string, date: string, type: 'income' | 'expense' | 'transfer', category: string, amount: number, accountId = 'acc_main', toAccountId = '') => ({
      id, date, type, category, accountId, toAccountId, amount, counterparty: '', voucherNo: id, note: '',
    });
    d.entries = [
      e('V1', '2026-10-05', 'expense', '電費', 1200),
      e('V2', '2026-10-25', 'transfer', '公共基金提撥', 3000, 'acc_main', 'acc_fund'),
      e('V3', '2026-10-31', 'income', '利息收入', 12, 'acc_fund'),
      e('V4', '2026-11-02', 'expense', '清潔費', 500),
    ];
    const regs = accountRegisters(d, '2026-10');
    const main = regs.find((r) => r.accountId === 'acc_main')!;
    expect(main.lines.map((l) => [l.date, l.kind, l.inflow, l.outflow, l.balance])).toEqual([
      ['2026-10-05', 'expense', 0, 1200, 8800],
      ['2026-10-21', 'deposit', 2000, 0, 10800],
      ['2026-10-25', 'transferOut', 0, 3000, 7800],
    ]);
    const fund = regs.find((r) => r.accountId === 'acc_fund')!;
    expect(fund.lines.map((l) => [l.kind, l.balance])).toEqual([['transferIn', 53000], ['income', 53012]]);
    const balances = accountBalances(d, '2026-10-31');
    for (const r of regs) expect(r.closing).toBe(balances.find((b) => b.accountId === r.accountId)!.closing);
    // 11 月的期初接續 10 月期末
    const nov = accountRegisters(d, '2026-11').find((r) => r.accountId === 'acc_main')!;
    expect(nov.opening).toBe(7800);
    expect(nov.lines.map((l) => [l.date, l.kind, l.balance])).toEqual([['2026-11-02', 'expense', 7300], ['2026-11-04', 'deposit', 15300]]);
  });
});

describe('choosing which report rows to add', () => {
  const row = (n: number, amount: number, receipt: string) => ({ rowNumber: n, unitNo: 'A1', payerName: '', billPeriod: '115/11', item: '管理費', paidDate: `2026-11-0${n}`, channel: 'ATM', amount, fee: 0, reportDepositDate: '', depositAmount: null, txnNo: receipt, status: '', note: '' });

  it('adds split payments separately and never adds the same receipt twice', () => {
    const rows = [row(1, 1000, 'R1'), row(2, 1000, 'R2'), row(3, 1000, 'R3')];
    const first = mergeRows([], rows, 'b1');
    expect([first.added, first.duplicates]).toEqual([3, 0]);
    const again = mergeRows(first.payments, rows, 'b2');
    expect([again.added, again.duplicates, again.payments.length]).toEqual([0, 3, 3]);
    expect(Array.from(again.status.values())).toEqual(['duplicate', 'duplicate', 'duplicate']);
  });

  it('skips rows the user unticks and can add them from a later upload', () => {
    const rows = [row(1, 1000, ''), row(2, 1000, '')];
    rows[1].paidDate = rows[0].paidDate;
    const first = mergeRows([], rows, 'b1', new Set([1]));
    expect([first.added, first.status.get(1), first.status.get(2)]).toEqual([1, 'skipped', 'added']);
    // 兩列內容完全相同：略過第一列後，第二列仍保有自己的辨識，重新上傳時只會補上第一列
    const later = mergeRows(first.payments, rows, 'b2');
    expect([later.added, later.status.get(1), later.status.get(2)]).toEqual([1, 'added', 'duplicate']);
  });
});
