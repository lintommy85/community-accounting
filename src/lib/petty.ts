import { addMonths, monthEnd, todayStr } from './dates';
import { newId } from './defaults';
import { LedgerEntry, PettyCashEntry } from './types';

export const PETTY_CATEGORY = '零用金撥補';

/** 消費日期；舊資料沒有時同輸入日期。 */
export const spentDateOf = (e: PettyCashEntry) => e.spentDate || e.date;

/** 某月的零用金支出：依輸入日期列入月份，同一天再依消費日期排序。 */
export const pettyOfMonth = (entries: PettyCashEntry[], month: string) =>
  entries.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date) || spentDateOf(a).localeCompare(spentDateOf(b)));

export const pettyTotal = (entries: PettyCashEntry[], month: string) => pettyOfMonth(entries, month).reduce((s, e) => s + e.amount, 0);

export const replenishmentOf = (entries: LedgerEntry[], month: string) => entries.find((e) => e.pettyMonth === month);

/** 某月零用金撥補可以列入的月報：第一個是預設的下個月，第二個是本月。撥補依撥補日期列入那個月的收支報表與月報。 */
export const replenishReportMonths = (month: string): [string, string] => [addMonths(month, 1), month];

/** 撥補日期的預設值：列入本月的月報時為月底；列入其他月份時，今天在那個月就用今天，否則為那個月 1 日。 */
export function defaultReplenishDate(month: string, reportMonth: string, today = todayStr()): string {
  if (reportMonth === month) return monthEnd(month);
  return today.startsWith(reportMonth) ? today : `${reportMonth}-01`;
}

/**
 * 建立或更新某月的「零用金撥補」支出：金額為該月零用金使用總額，從指定銀行帳戶支出，列入撥補日期所在月份的報表。
 * 已存在時只更新日期、帳戶與金額，傳票號碼不變；撥補日期改到別的年度時改用 voucherNo（新年度的傳票號碼）。
 */
export function upsertReplenishment(
  entries: LedgerEntry[],
  month: string,
  opts: { date: string; accountId: string; amount: number; voucherNo: string },
): LedgerEntry[] {
  const prev = replenishmentOf(entries, month);
  const base = {
    date: opts.date,
    accountId: opts.accountId,
    amount: opts.amount,
    note: `${month} 零用金使用總額`,
  };
  if (prev) {
    const voucherNo = prev.date.slice(0, 4) === opts.date.slice(0, 4) ? prev.voucherNo : opts.voucherNo;
    return entries.map((e) => (e.id === prev.id ? { ...e, ...base, voucherNo } : e));
  }
  return [
    ...entries,
    { id: newId('e_'), type: 'expense', category: PETTY_CATEGORY, toAccountId: '', counterparty: '', voucherNo: opts.voucherNo, pettyMonth: month, ...base },
  ];
}

export interface PettyLine {
  date: string;
  kind: 'expense' | 'replenish';
  expense?: PettyCashEntry;
  replenishment?: LedgerEntry;
  out: number;
  in: number;
  balance: number;
}

export interface PettyLedger {
  fund: number;
  opening: number;
  lines: PettyLine[];
  closing: number;
}

/**
 * 零用金餘額：以零用金總額為起點，每筆支出（依輸入日期）扣除、撥補入帳時加回；
 * 某月的期初餘額接續之前所有月份的支出與撥補。同一天先列支出再列撥補。
 */
export function pettyLedger(petty: PettyCashEntry[], entries: LedgerEntry[], fund: number, month: string): PettyLedger {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const replenishments = entries.filter((e) => e.pettyMonth);
  const before =
    replenishments.filter((e) => e.date < start).reduce((s, e) => s + e.amount, 0) - petty.filter((e) => e.date < start).reduce((s, e) => s + e.amount, 0);
  const opening = fund + before;
  const events: Omit<PettyLine, 'balance'>[] = [
    ...petty.filter((e) => e.date >= start && e.date <= end).map((e) => ({ date: e.date, kind: 'expense' as const, expense: e, out: e.amount, in: 0 })),
    ...replenishments.filter((e) => e.date >= start && e.date <= end).map((e) => ({ date: e.date, kind: 'replenish' as const, replenishment: e, out: 0, in: e.amount })),
  ];
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? (a.expense && b.expense ? spentDateOf(a.expense).localeCompare(spentDateOf(b.expense)) : 0) : a.kind === 'expense' ? -1 : 1));
  let balance = opening;
  const lines = events.map((ev) => {
    balance += ev.in - ev.out;
    return { ...ev, balance };
  });
  return { fund, opening, lines, closing: balance };
}
