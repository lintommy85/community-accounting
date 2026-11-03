import * as XLSX from 'xlsx';
import { FIELD_LABELS, withCommunity } from './defaults';
import { AccountRegister, netAmount, MonthReport } from './ledger';
import { decodeText, Grid } from './parser';
import { BREAKDOWN_LABELS, PositionSummary, signatureRows, Statement } from './statement';
import { UnitSummary } from './allocation';
import { AppData, FieldKey } from './types';

export interface SheetGrid {
  sheetName: string;
  grid: Grid;
}

export async function readWorkbook(file: File): Promise<SheetGrid[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isText = /\.(csv|txt|tsv)$/i.test(file.name);
  const wb = isText ? XLSX.read(decodeText(buf), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array' });
  return wb.SheetNames.map((sheetName) => ({
    sheetName,
    grid: XLSX.utils.sheet_to_json<Grid[number]>(wb.Sheets[sheetName], { header: 1, raw: true, defval: null, blankrows: false }),
  }));
}

function sheet(rows: Record<string, unknown>[], widths?: number[]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  if (widths) ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

const yesNo = (b: boolean) => (b ? '是' : '否');

/** 匯出全部資料為 Excel，方便人工查閱或交接；還原請使用 JSON 備份檔。 */
export function exportAllToExcel(data: AppData): Blob {
  const { settings } = data;
  const accName = (id: string) => settings.accounts.find((a) => a.id === id)?.name ?? '';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      data.payments.map((p) => ({
        戶別: p.unitNo,
        住戶: p.payerName,
        期別: p.billPeriod,
        項目: p.item,
        繳費日期: p.paidDate,
        繳費方式: p.channel,
        金額: p.amount,
        手續費: p.fee,
        入帳淨額: netAmount(p),
        報表撥款日: p.reportDepositDate,
        入帳日: p.depositDate || '尚未入帳',
        已核對銀行: yesNo(p.depositConfirmed),
        交易序號: p.txnNo,
        狀態: p.status,
        作廢: yesNo(p.voided),
        備註: p.note,
      })),
      [10, 10, 14, 10, 12, 14, 10, 8, 10, 12, 12, 10, 18, 8, 6, 20],
    ),
    '繳費紀錄',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [...data.dues]
        .sort((a, b) => a.month.localeCompare(b.month) || a.unitNo.localeCompare(b.unitNo, 'zh-Hant', { numeric: true }))
        .map((d) => ({ 月份: d.month, 戶別: d.unitNo, 項目: d.item, 應繳金額: d.amount, 智生活帳單金額: d.billAmount ?? d.amount, 帳單內含逾期: Math.max(0, (d.billAmount ?? d.amount) - d.amount), 拆出自帳單: d.fromBill ?? '', 來源: d.source === 'import' ? '匯入' : '手動', 更新時間: d.updatedAt })),
      [10, 10, 12, 10, 12, 12, 10, 6, 22],
    ),
    '每月應繳',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      data.entries.map((e) => ({
        日期: e.date,
        類型: { income: '收入', expense: '支出', transfer: '轉帳' }[e.type],
        科目: e.category,
        帳戶: accName(e.accountId),
        轉入帳戶: accName(e.toAccountId),
        金額: e.amount,
        對象: e.counterparty,
        傳票號碼: e.voucherNo,
        備註: e.note,
      })),
    ),
    '收支分錄',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(data.pettyCash.slice().sort((x, y) => x.date.localeCompare(y.date)).map((e) => ({ 日期: e.date, 項目: e.item, 金額: e.amount, 店家對象: e.payee, 備註: e.note }))),
    '零用金',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(settings.units.map((u) => ({ 戶別: u.unitNo, 所有權人: u.owner, 每月應繳基準: u.monthlyFee, 地址: u.address ?? '', 狀態: u.deletedAt ? `已刪除 ${u.deletedAt.slice(0, 10)}` : '使用中', 備註: u.note }))),
    '戶別',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      settings.accounts.map((a) => ({
        帳戶: a.name,
        帳號: a.accountNo,
        類型: a.kind === 'bank' ? '銀行' : '現金',
        基金: a.fund,
        期初餘額: a.openingBalance,
        期初日期: a.openingDate,
      })),
    ),
    '帳戶',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      data.batches.map((b) => ({
        匯入時間: b.importedAt,
        檔名: b.fileName,
        工作表: b.sheetName,
        總列數: b.totalRows,
        新增: b.added,
        重複: b.duplicates,
        略過: b.skipped,
      })),
    ),
    '匯入紀錄',
  );
  XLSX.utils.book_append_sheet(
    wb,
    sheet(data.closes.map((c) => ({ 月份: c.month, 結帳時間: c.closedAt, 本月入帳: c.deposited, 月底在途: c.inTransit, 備註: c.note }))),
    '月結',
  );
  XLSX.utils.book_append_sheet(wb, sheet(data.audit.map((a) => ({ 時間: a.at, 動作: a.action, 內容: a.detail }))), '操作紀錄');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportMonthReport(data: AppData, r: MonthReport): Blob {
  const { settings } = data;
  const wb = XLSX.utils.book_new();
  const totalIncome = r.received.gross + r.income.reduce((sum, i) => sum + i.amount, 0);
  const totalExpense = r.expense.reduce((sum, i) => sum + i.amount, 0);
  const summary: (string | number)[][] = [
    [withCommunity(settings, `${r.month} 財務月報`)],
    [],
    ['一、收支明細表'],
    ['收入科目', '金額'],
    ...r.byItem.map((i) => [`管理費收款－${i.item}`, i.amount]),
    ...(r.receipt ? (Object.keys(BREAKDOWN_LABELS) as (keyof typeof BREAKDOWN_LABELS)[]).filter((k) => r.receipt![k]).map((k) => [BREAKDOWN_LABELS[k], Math.round(r.receipt![k])]) : []),
    ...r.income.map((i) => [i.category, i.amount]),
    ['收入合計', totalIncome],
    [],
    ['支出科目', '金額'],
    ...r.expense.map((i) => [i.category, i.amount]),
    ['支出合計', totalExpense],
    ['本期結餘', totalIncome - totalExpense],
    [],
    ['二、管理費入帳及在途存款', '筆數', '金額', '手續費', '入帳淨額'],
    ['上月底在途存款', r.openingInTransit.count, r.openingInTransit.gross, r.openingInTransit.fee, r.openingInTransit.net],
    ['＋ 本月住戶繳費', r.received.count, r.received.gross, r.received.fee, r.received.net],
    ['－ 本月撥入銀行', r.deposited.count, r.deposited.gross, r.deposited.fee, r.deposited.net],
    ['　其中：上月在途本月入帳', r.depositedFromPrior.count, r.depositedFromPrior.gross, r.depositedFromPrior.fee, r.depositedFromPrior.net],
    ['＝ 本月底在途存款', r.closingInTransit.count, r.closingInTransit.gross, r.closingInTransit.fee, r.closingInTransit.net],
    [],
    ['三、結存表', '上月結存', '本月存入', '本月支出', '本月結存'],
    ...r.balances.map((b) => [b.name, b.opening, b.inflow, b.outflow, b.closing]),
    ['在途存款', '', '', '', r.closingInTransit.net],
    ['資產合計', '', '', '', r.balances.reduce((sum, b) => sum + b.closing, 0) + r.closingInTransit.net],
    ...(r.prepaid ? [['其中：預收管理費（已入帳，待以後月份銷帳）', '', '', '', r.prepaid]] : []),
    ...(r.suspense ? [['其中：暫收款（已入帳，尚無應繳可銷帳）', '', '', '', r.suspense]] : []),
  ];
  const ws = XLSX.utils.aoa_to_sheet(summary);
  ws['!cols'] = [{ wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, ws, '月報');
  if (r.writeOff) {
    const ml = (m: string) => `${Number(m.slice(0, 4)) - 1911}/${m.slice(5)}`;
    const paid = XLSX.utils.aoa_to_sheet([
      [withCommunity(settings, `${r.month} 管理費繳費明細－已繳`)],
      [],
      ['戶別', '所有權人', '繳費日期', '繳費方式', '期別', '銷帳月份', '繳費金額'],
      ...r.paidList.map((l) => [
        l.payment.unitNo,
        l.owner,
        l.payment.paidDate,
        l.payment.channel,
        l.payment.billPeriod,
        [...l.allocations.map((a) => `${ml(a.month)} ${a.amount}`), ...(l.credit ? [`暫收 ${l.credit}`] : [])].join('、'),
        l.payment.amount,
      ]),
      ['', '', '', '', '', '已繳合計', r.paidList.reduce((sum, l) => sum + l.payment.amount, 0)],
    ]);
    paid['!cols'] = [24, 12, 12, 12, 16, 36, 12].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, paid, '已繳');
    const unpaid = XLSX.utils.aoa_to_sheet([
      [withCommunity(settings, `截至 ${r.month} 管理費繳費明細－未繳（逐月）`)],
      [],
      ['戶別', '所有權人', '月份', '應繳', '已繳', '未繳'],
      ...r.unpaidList.map((l) => [l.unitNo, l.owner, ml(l.month), l.due, l.paid, l.owing]),
      ['', '', '', '', '未繳合計', r.unpaidList.reduce((sum, l) => sum + l.owing, 0)],
    ]);
    unpaid['!cols'] = [24, 12, 10, 10, 10, 10].map((wch) => ({ wch }));
    XLSX.utils.book_append_sheet(wb, unpaid, '未繳');
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function mappingSummary(mapping: Partial<Record<FieldKey, string>>): string {
  return (Object.keys(FIELD_LABELS) as FieldKey[])
    .filter((k) => mapping[k])
    .map((k) => `${FIELD_LABELS[k]}←${mapping[k]}`)
    .join('、');
}

export function exportStatement(data: AppData, title: string, sub: string, st: Statement, pos: PositionSummary): Blob {
  const n = st.columns.length;
  const line = (label: string, values: number[]) => [label, ...values.map((v) => Math.round(v))];
  const sigRows = signatureRows(data.settings.signatures).flatMap((row) => [['', ...row.map((s) => s.label)], [], []]);
  const aoa: (string | number)[][] = [
    [title],
    [sub],
    [],
    ['科目', ...st.columns],
    ['收入'],
    ...st.income.map((l) => line(l.label, l.values)),
    line('收入合計', st.incomeTotals),
    ['支出'],
    ...st.expense.map((l) => line(l.label, l.values)),
    line('支出合計', st.expenseTotals),
    line('本期結餘', st.net),
    [],
    ['結存表', '期初結存', '本期存入', '本期支出', '期末結存'],
    ...pos.balances.map((b) => [b.name, b.opening, b.inflow, b.outflow, b.closing]),
    ...(pos.inTransit ? [['在途存款', '', '', '', pos.inTransit]] : []),
    ['資金合計', '', '', '', pos.balances.reduce((s, b) => s + b.closing, 0) + pos.inTransit],
    ...(pos.prepaid ? [['其中：預收管理費', '', '', '', pos.prepaid]] : []),
    ...(pos.suspense ? [['其中：暫收款（尚無應繳可銷帳）', '', '', '', pos.suspense]] : []),
    [],
    ['簽章'],
    ...sigRows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 24 }, ...Array.from({ length: Math.max(n, 9) }, () => ({ wch: 12 }))];
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: n } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: n } },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '收支報表');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportUnitSummaries(data: AppData, rows: UnitSummary[], from: string, to: string): Blob {
  const ws = XLSX.utils.aoa_to_sheet([
    [withCommunity(data.settings, `戶別繳費明細 ${from} 至 ${to}`)],
    [],
    ['戶別', '所有權人', '月管理費', '期間應繳', '已銷帳', '未繳', '未繳期數', '未繳月份', '期間繳款', '預繳／暫收', '已繳至', '最後繳費日'],
    ...rows.map((r) => [
      r.account.unit.unitNo, r.account.unit.owner, r.account.unit.monthlyFee, r.due, r.paid, r.owing,
      r.owingMonths.length, r.owingMonths.join('、'), r.received, r.prepaid, r.paidThrough, r.lastPaidDate,
    ]),
  ]);
  ws['!cols'] = [10, 10, 10, 10, 10, 10, 8, 30, 10, 10, 10, 12].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '戶別繳費明細');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function exportAccountRegisters(data: AppData, month: string, regs: AccountRegister[]): Blob {
  const KIND: Record<string, string> = { deposit: '撥款入帳', income: '收入', expense: '支出', transferIn: '轉入', transferOut: '轉出' };
  const wb = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    [withCommunity(data.settings, `${month} 各帳戶結存`)],
    [],
    ['帳戶', '帳號', '上月結存', '本月存入', '本月支出', '本月結存'],
    ...regs.map((r) => [r.name, r.accountNo, r.opening, r.inflow, r.outflow, r.closing]),
  ]);
  summary['!cols'] = [16, 20, 12, 12, 12, 12].map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, summary, '各帳戶結存');
  const used = new Set<string>();
  for (const r of regs) {
    const ws = XLSX.utils.aoa_to_sheet([
      [`${r.name}${r.accountNo ? `（${r.accountNo}）` : ''} ${month} 變動紀錄`],
      [],
      ['日期', '類別', '摘要', '傳票', '存入', '支出', '餘額'],
      [`${month}-01`, '', '上月結存', '', '', '', r.opening],
      ...r.lines.map((l) => [l.date, KIND[l.kind], l.description, l.ref, l.inflow || '', l.outflow || '', l.balance]),
      ['', '', '本月合計／結存', '', r.inflow, r.outflow, r.closing],
    ]);
    ws['!cols'] = [12, 10, 40, 12, 12, 12, 12].map((wch) => ({ wch }));
    let sheetName = r.name.replace(/[\\/?*[\]:]/g, '').slice(0, 28) || '帳戶';
    while (used.has(sheetName)) sheetName += '_';
    used.add(sheetName);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
