import { monthEnd } from './dates';
import { newId } from './defaults';
import { LedgerEntry, PettyCashEntry } from './types';

export const PETTY_CATEGORY = '零用金撥補';

export const pettyOfMonth = (entries: PettyCashEntry[], month: string) =>
  entries.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));

export const pettyTotal = (entries: PettyCashEntry[], month: string) => pettyOfMonth(entries, month).reduce((s, e) => s + e.amount, 0);

export const replenishmentOf = (entries: LedgerEntry[], month: string) => entries.find((e) => e.pettyMonth === month);

/**
 * 建立或更新某月的「零用金撥補」支出：金額為該月零用金使用總額，從指定銀行帳戶支出。
 * 已存在時只更新日期、帳戶與金額，傳票號碼不變。
 */
export function upsertReplenishment(
  entries: LedgerEntry[],
  month: string,
  opts: { date?: string; accountId: string; amount: number; voucherNo: string },
): LedgerEntry[] {
  const prev = replenishmentOf(entries, month);
  const base = {
    date: opts.date || monthEnd(month),
    accountId: opts.accountId,
    amount: opts.amount,
    note: `${month} 零用金使用總額`,
  };
  if (prev) return entries.map((e) => (e.id === prev.id ? { ...e, ...base } : e));
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
 * 零用金餘額：以零用金總額為起點，每筆支出扣除、撥補入帳時加回；
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
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'expense' ? -1 : 1));
  let balance = opening;
  const lines = events.map((ev) => {
    balance += ev.in - ev.out;
    return { ...ev, balance };
  });
  return { fund, opening, lines, closing: balance };
}
