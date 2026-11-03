import { addMonths, monthEnd, monthRange } from './dates';
import { allocateAll, receiptBreakdown, receiptBreakdownBy } from './allocation';
import { resolveDepositAccountId } from './defaults';
import { AccountBalance, accountBalances, active, advancesFor, inTransitAt, netAmount } from './ledger';
import { Account, AppData, SignatureSlot } from './types';

export type Basis = 'paid' | 'deposit';
export type FundFilter = '' | Account['fund'];

export interface StatementOptions {
  basis: Basis;
  fund: FundFilter;
}

export interface Period {
  label: string;
  start: string;
  end: string;
}

export interface StatementLine {
  label: string;
  values: number[];
  /** 說明用的拆解列，不計入合計。 */
  sub?: boolean;
}

export interface Statement {
  columns: string[];
  income: StatementLine[];
  expense: StatementLine[];
  incomeTotals: number[];
  expenseTotals: number[];
  net: number[];
}

export const FEE_LABEL = '代收手續費';

export const FEE_INCOME_LABEL = '管理費收入－管理費';

function collect(data: AppData, p: Period, opts: StatementOptions) {
  const { settings } = data;
  const fundOf = (accountId: string) => settings.accounts.find((a) => a.id === accountId)?.fund;
  const inFund = (accountId: string) => !opts.fund || fundOf(accountId) === opts.fund;
  const income = new Map<string, number>();
  const expense = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => v && m.set(k, (m.get(k) ?? 0) + v);

  if (inFund(resolveDepositAccountId(settings))) {
    for (const pay of active(data.payments)) {
      const d = opts.basis === 'deposit' ? pay.depositDate : pay.paidDate;
      if (d < p.start || d > p.end) continue;
      add(income, `管理費收入－${pay.item || '管理費'}`, pay.amount);
      add(expense, FEE_LABEL, pay.amount - netAmount(pay));
    }
  }

  for (const e of data.entries) {
    if (e.date < p.start || e.date > p.end) continue;
    const category = e.category || '未分類';
    if (e.type === 'income' && inFund(e.accountId)) add(income, category, e.amount);
    else if (e.type === 'expense' && inFund(e.accountId)) add(expense, category, e.amount);
    else if (e.type === 'transfer' && opts.fund) {
      const from = fundOf(e.accountId);
      const to = fundOf(e.toAccountId);
      if (from === to) continue;
      if (to === opts.fund) add(income, `轉入－${category}`, e.amount);
      if (from === opts.fund) add(expense, `轉出－${category}`, e.amount);
    }
  }
  return { income, expense };
}

function order(labels: Set<string>, preferred: string[]): string[] {
  const rank = (l: string) => {
    if (l === FEE_INCOME_LABEL) return -2;
    if (l.startsWith('管理費收入')) return -1;
    const i = preferred.indexOf(l);
    return i === -1 ? preferred.length : i;
  };
  return Array.from(labels).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'zh-Hant'));
}

/** 依期間欄位（例如本月／本年累計，或 1–12 月＋全年）彙總收入與支出科目。 */
export const BREAKDOWN_LABELS = {
  current: '　其中：當期銷帳',
  prepaid: '　其中：預收（預繳、多繳）',
  arrears: '　其中：補繳以前月份',
  credit: '　其中：暫收（期別的每月應繳還沒匯入）',
  unmatched: '　其中：未對應門牌',
} as const;

/** 管理費收入全額列入收款當期，並附上依銷帳月份的拆解列。 */
function feeBreakdownLines(data: AppData, periods: Period[], opts: StatementOptions): StatementLine[] {
  if (!data.settings.units.some((u) => !u.deletedAt)) return [];
  const alloc = allocateAll(data);
  const dateOf = opts.basis === 'deposit' ? (p: { depositDate: string }) => p.depositDate : undefined;
  const cols = periods.map((p) => receiptBreakdown(alloc, data.payments, p.start, p.end, dateOf));
  return (Object.keys(BREAKDOWN_LABELS) as (keyof typeof BREAKDOWN_LABELS)[])
    .map((k) => ({ label: BREAKDOWN_LABELS[k], values: cols.map((c) => Math.round(c[k])), sub: true }))
    .filter((l) => l.values.some((v) => v !== 0));
}

export function buildStatement(data: AppData, periods: Period[], opts: StatementOptions): Statement {
  const cols = periods.map((p) => collect(data, p, opts));
  const lines = (kind: 'income' | 'expense', preferred: string[]) => {
    const labels = new Set<string>();
    cols.forEach((c) => c[kind].forEach((_, k) => labels.add(k)));
    return order(labels, preferred).map((label) => ({ label, values: cols.map((c) => c[kind].get(label) ?? 0) }));
  };
  const income: StatementLine[] = lines('income', data.settings.incomeCategories);
  const feeAt = income.findIndex((l) => l.label === FEE_INCOME_LABEL);
  if (feeAt >= 0 && (!opts.fund || data.settings.accounts.find((a) => a.id === resolveDepositAccountId(data.settings))?.fund === opts.fund)) {
    income.splice(feeAt + 1, 0, ...feeBreakdownLines(data, periods, opts));
  }
  const expense = lines('expense', [...data.settings.expenseCategories, FEE_LABEL]);
  const sum = (ls: StatementLine[]) => periods.map((_, i) => ls.reduce((s, l) => s + (l.sub ? 0 : l.values[i]), 0));
  const incomeTotals = sum(income);
  const expenseTotals = sum(expense);
  return {
    columns: periods.map((p) => p.label),
    income,
    expense,
    incomeTotals,
    expenseTotals,
    net: incomeTotals.map((v, i) => v - expenseTotals[i]),
  };
}

export const rocYear = (year: number) => year - 1911;

export function monthPeriods(month: string): Period[] {
  const year = month.slice(0, 4);
  return [
    { label: '本月', start: `${month}-01`, end: monthEnd(month) },
    { label: '本年累計', start: `${year}-01-01`, end: monthEnd(month) },
  ];
}

export function yearPeriods(year: number): Period[] {
  const months = monthRange(`${year}-01`, `${year}-12`);
  return [
    ...months.map((m) => ({ label: `${Number(m.slice(5))}月`, start: `${m}-01`, end: monthEnd(m) })),
    { label: '全年合計', start: `${year}-01-01`, end: `${year}-12-31` },
  ];
}

export interface PositionSummary {
  balances: AccountBalance[];
  inTransit: number;
  prepaid: number;
  suspense: number;
}

/** 期間結存：各帳戶期初／期末、期末在途存款與預收款（依基金別篩選）。 */
export function positionFor(data: AppData, start: string, end: string, fund: FundFilter): PositionSummary {
  const { settings } = data;
  const dayBefore = monthEnd(addMonths(start.slice(0, 7), -1));
  const ids = new Set(settings.accounts.filter((a) => !fund || a.fund === fund).map((a) => a.id));
  const includesDeposits = ids.has(resolveDepositAccountId(settings));
  return {
    balances: accountBalances(data, end, dayBefore).filter((b) => ids.has(b.accountId)),
    inTransit: includesDeposits ? inTransitAt(data.payments, end).reduce((s, p) => s + netAmount(p), 0) : 0,
    ...(includesDeposits ? advancesFor(data, end.slice(0, 7)) : { prepaid: 0, suspense: 0 }),
  };
}

export function signatureRows(slots: SignatureSlot[]): SignatureSlot[][] {
  return ([1, 2] as const).map((r) => slots.filter((s) => s.row === r && s.label.trim())).filter((r) => r.length > 0);
}

export interface SheetLine {
  subject: string;
  item: string;
  month: string;
  note: string;
  amount: number;
  fixed: boolean;
}

export interface MonthSheet {
  income: SheetLine[];
  expense: SheetLine[];
}

export const FEE_SUBJECT = '管理費收入';

/**
 * 財務收支總表（仿智生活格式）：管理費收入依收費項目拆成收入／預收款／逾期／暫收款，
 * 其他收入與支出逐筆列出；科目在 fixedCategories 中的列為固定收支。
 */
export function monthSheet(data: AppData, month: string): MonthSheet {
  const { settings } = data;
  const start = `${month}-01`;
  const end = monthEnd(month);
  const label = `${Number(month.slice(5))}月`;
  const fixed = new Set(settings.fixedCategories);
  const isFixed = (subject: string, item: string) => fixed.has(subject) || fixed.has(item);
  const income: SheetLine[] = [];
  const fee = (item: string, text: string, amount: number) =>
    amount && income.push({ subject: FEE_SUBJECT, item: text, month: label, note: '住戶', amount: Math.round(amount), fixed: isFixed(FEE_SUBJECT, item) });

  const itemOf = (p: { item: string }) => p.item || '管理費';
  if (settings.units.some((u) => !u.deletedAt)) {
    const groups = receiptBreakdownBy(allocateAll(data), data.payments, start, end, itemOf);
    for (const [item, b] of Array.from(groups).sort((a, b2) => a[0].localeCompare(b2[0], 'zh-Hant'))) {
      fee(item, `${item}收入`, b.current);
      fee(item, `${item}預收款`, b.prepaid);
      fee(item, `逾期${item}`, b.arrears);
      fee(item, `${item}暫收款`, b.credit);
      fee(item, `${item}（未對應戶別）`, b.unmatched);
    }
  } else {
    const byItem = new Map<string, number>();
    for (const p of active(data.payments)) if (p.paidDate >= start && p.paidDate <= end) byItem.set(itemOf(p), (byItem.get(itemOf(p)) ?? 0) + p.amount);
    for (const [item, amount] of byItem) fee(item, `${item}收入`, amount);
  }

  const expense: SheetLine[] = [];
  const entries = data.entries.filter((e) => e.date >= start && e.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  for (const e of entries) {
    const line = { subject: e.category || '未分類', item: e.note || e.category || '', month: label, note: e.counterparty, amount: e.amount, fixed: isFixed(e.category, e.note) };
    if (e.type === 'income') income.push(line);
    else if (e.type === 'expense') expense.push(line);
  }
  const rank = (list: string[]) => (l: SheetLine) => (l.subject === FEE_SUBJECT ? -1 : list.includes(l.subject) ? list.indexOf(l.subject) : list.length);
  const byRank = (r: (l: SheetLine) => number) => (a: SheetLine, b: SheetLine) => r(a) - r(b);
  income.sort(byRank(rank(settings.incomeCategories)));
  expense.sort(byRank(rank(settings.expenseCategories)));
  return { income, expense };
}
