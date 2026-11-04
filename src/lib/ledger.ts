import { addMonths, monthEnd, monthOf, parsePeriods } from './dates';
import { ParsedRow } from './parser';
import { allocateAll, monthWriteOff, normUnit, MonthWriteOff, PaidLine, paidListForMonth, unpaidByMonth, UnpaidLine, advancesFromAllocations, AdvanceBalances, receiptBreakdown, ReceiptBreakdown } from './allocation';
import { resolveDepositAccountId } from './defaults';
import { AppData, LedgerEntry, Payment } from './types';

export function hashKey(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

/** 撥入銀行的金額：優先採用報表的「入帳金額」，沒有時以繳費金額扣除手續費。 */
export function netAmount(p: Payment): number {
  return p.depositAmount ?? p.amount - p.fee;
}

/** 撥款對帳與報表依報表上的「繳費方式」原文分組。 */
export const channelLabel = (p: Payment) => p.channel.trim() || '未註明';

export type RowStatus = 'added' | 'duplicate' | 'updated' | 'skipped';

export interface MergeResult {
  payments: Payment[];
  added: number;
  duplicates: number;
  updated: number;
  /** 每一列（rowNumber）的結果：新增、已匯入、已匯入但有更新、使用者選擇不新增。 */
  status: Map<number, RowStatus>;
}

/**
 * 將解析後的列合併進既有繳費紀錄；入帳日一律採用報表上的入帳／撥款日，沒有的視為尚未入帳。
 * 有交易序號時以「序號＋門牌＋項目＋期別」辨識同一筆，重複匯入時金額、手續費、日期、繳費方式有變動才更新；
 * 沒有序號時以全部欄位辨識，重複匯入同一份報表不會重複入帳。之後的報表補上入帳日時會自動更新。
 * skip 的列（使用者選擇不新增）不會新增，但仍計入同樣內容的出現次數，之後重新匯入時辨識結果不變。
 */
export function mergeRows(existing: Payment[], rows: ParsedRow[], batchId: string, skip: Set<number> = new Set()): MergeResult {
  const byId = new Map(existing.map((p) => [p.id, p]));
  const occurrences = new Map<string, number>();
  const out = existing.slice();
  const indexOf = new Map(existing.map((p, i) => [p.id, i]));
  let added = 0;
  let duplicates = 0;
  let updated = 0;
  const status = new Map<number, RowStatus>();
  for (const r of rows) {
    const base = r.txnNo
      ? ['t', r.txnNo, normUnit(r.unitNo), r.item, r.billPeriod].join('|')
      : [r.txnNo, r.unitNo, r.paidDate, r.amount, r.channel, r.billPeriod, r.item].join('|');
    const occ = (occurrences.get(base) ?? 0) + 1;
    occurrences.set(base, occ);
    const id = 'p_' + hashKey(`${base}#${occ}`);
    const prev = byId.get(id);
    if (prev) {
      duplicates++;
      status.set(r.rowNumber, 'duplicate');
      const depositAmount = r.depositAmount ?? undefined;
      const coreChanged =
        prev.amount !== r.amount || prev.fee !== r.fee || prev.paidDate !== r.paidDate || prev.channel !== r.channel || prev.depositAmount !== depositAmount;
      const depositChanged = !!r.reportDepositDate && r.reportDepositDate !== prev.reportDepositDate;
      if (coreChanged) {
        out[indexOf.get(id)!] = {
          ...prev,
          amount: r.amount,
          fee: r.fee,
          paidDate: r.paidDate,
          channel: r.channel,
          depositAmount,
          reportDepositDate: r.reportDepositDate,
          depositDate: r.reportDepositDate,
          depositConfirmed: false,
          status: r.status,
        };
        updated++;
        status.set(r.rowNumber, 'updated');
      } else if (depositChanged && !prev.depositConfirmed) {
        out[indexOf.get(id)!] = { ...prev, reportDepositDate: r.reportDepositDate, depositDate: r.reportDepositDate };
        updated++;
        status.set(r.rowNumber, 'updated');
      }
      continue;
    }
    if (skip.has(r.rowNumber)) {
      status.set(r.rowNumber, 'skipped');
      continue;
    }
    const p: Payment = {
      id,
      batchId,
      unitNo: r.unitNo,
      payerName: r.payerName,
      billPeriod: r.billPeriod,
      item: r.item,
      paidDate: r.paidDate,
      channel: r.channel,
      amount: r.amount,
      fee: r.fee,
      ...(r.depositAmount !== null ? { depositAmount: r.depositAmount } : {}),
      reportDepositDate: r.reportDepositDate,
      depositDate: r.reportDepositDate,
      depositConfirmed: false,
      txnNo: r.txnNo,
      status: r.status,
      note: r.note,
      voided: false,
    };
    byId.set(id, p);
    indexOf.set(id, out.length);
    out.push(p);
    added++;
    status.set(r.rowNumber, 'added');
  }
  return { payments: out, added, duplicates, updated, status };
}

export const active = (ps: Payment[]) => ps.filter((p) => !p.voided);

export interface Totals {
  count: number;
  gross: number;
  fee: number;
  net: number;
}

function totals(ps: Payment[]): Totals {
  let gross = 0;
  let net = 0;
  let fee = 0;
  for (const p of ps) {
    gross += p.amount;
    fee += p.fee;
    net += netAmount(p);
  }
  return { count: ps.length, gross, fee, net };
}

/** 截至某日仍未撥入銀行的款項（在途存款）：入帳日在該日之後，或報表尚未提供入帳日。 */
export function inTransitAt(payments: Payment[], asOf: string): Payment[] {
  return active(payments).filter((p) => p.paidDate <= asOf && (!p.depositDate || p.depositDate > asOf));
}

/** 繳費當月月底前沒有入帳（入帳日在下個月以後，或報表尚無入帳日）＝繳費月份的在途存款。 */
export const isMonthEndInTransit = (p: Payment) => !p.depositDate || p.depositDate > monthEnd(monthOf(p.paidDate));

/** 報表尚未提供入帳日的款項。 */
export const awaitingDeposit = (payments: Payment[]) => active(payments).filter((p) => !p.depositDate);

export interface DepositGroup {
  key: string;
  depositDate: string;
  channelName: string;
  payments: Payment[];
  totals: Totals;
  confirmed: boolean;
  partlyConfirmed: boolean;
}

export function depositGroups(payments: Payment[], month?: string): DepositGroup[] {
  const map = new Map<string, Payment[]>();
  for (const p of active(payments)) {
    if (!p.depositDate || (month && monthOf(p.depositDate) !== month)) continue;
    const key = `${p.depositDate}|${channelLabel(p)}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(p);
  }
  return Array.from(map.entries())
    .map(([key, ps]) => {
      const confirmedCount = ps.filter((p) => p.depositConfirmed).length;
      return {
        key,
        depositDate: ps[0].depositDate,
        channelName: channelLabel(ps[0]),
        payments: ps,
        totals: totals(ps),
        confirmed: confirmedCount === ps.length,
        partlyConfirmed: confirmedCount > 0 && confirmedCount < ps.length,
      };
    })
    .sort((a, b) => a.depositDate.localeCompare(b.depositDate) || a.channelName.localeCompare(b.channelName));
}

/** 預收款與暫收款：已建立戶別時依逐月銷帳結果計算，否則依帳單期別平均分攤估算預收。 */
export function advancesFor(data: AppData, month: string): AdvanceBalances {
  if (data.settings.units.some((u) => !u.deletedAt)) return advancesFromAllocations(allocateAll(data), data.payments, month);
  return { prepaid: prepaidAt(data.payments, month), suspense: 0 };
}

/** 預收款（未建立戶別時的估算）：已繳費、但帳單期別在本月之後的部分。 */
export function prepaidAt(payments: Payment[], month: string): number {
  const end = monthEnd(month);
  let sum = 0;
  for (const p of active(payments)) {
    if (p.paidDate > end) continue;
    const periods = parsePeriods(p.billPeriod);
    if (periods.length === 0) continue;
    const share = p.amount / periods.length;
    sum += share * periods.filter((m) => m > month).length;
  }
  return Math.round(sum);
}

export interface AccountBalance {
  accountId: string;
  name: string;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
}

function entryFlows(e: LedgerEntry, accountId: string): number {
  if (e.type === 'income' && e.accountId === accountId) return e.amount;
  if (e.type === 'expense' && e.accountId === accountId) return -e.amount;
  if (e.type === 'transfer') {
    if (e.accountId === accountId) return -e.amount;
    if (e.toAccountId === accountId) return e.amount;
  }
  return 0;
}

/** 計算各帳戶在 (from, to] 期間的餘額變動；起始餘額取帳戶設定的期初數。 */
export function accountBalances(data: AppData, upTo: string, from?: string): AccountBalance[] {
  const { settings } = data;
  const depositId = resolveDepositAccountId(settings);
  return settings.accounts.map((acc) => {
    const start = acc.openingDate || '0000-00-00';
    const flowFor = (lo: string, hi: string) => {
      let inflow = 0;
      let outflow = 0;
      for (const e of data.entries) {
        if (e.date <= lo || e.date > hi || e.date < start) continue;
        const f = entryFlows(e, acc.id);
        if (f > 0) inflow += f;
        else outflow -= f;
      }
      if (acc.id === depositId) {
        for (const p of active(data.payments)) {
          if (!p.depositDate || p.depositDate <= lo || p.depositDate > hi || p.depositDate < start) continue;
          inflow += netAmount(p);
        }
      }
      return { inflow, outflow };
    };
    const lo = from ?? '0000-00-00';
    const before = flowFor('0000-00-00', lo);
    const opening = acc.openingBalance + (from ? before.inflow - before.outflow : 0);
    const period = flowFor(from ? lo : '0000-00-00', upTo);
    return {
      accountId: acc.id,
      name: acc.name,
      opening,
      inflow: period.inflow,
      outflow: period.outflow,
      closing: opening + period.inflow - period.outflow,
    };
  });
}

export interface MonthReport {
  month: string;
  start: string;
  end: string;
  openingInTransit: Totals;
  received: Totals;
  deposited: Totals;
  depositedFromPrior: Totals;
  closingInTransit: Totals;
  byItem: { item: string; amount: number }[];
  prepaid: number;
  suspense: number;
  receipt: ReceiptBreakdown | null;
  writeOff: MonthWriteOff | null;
  paidList: PaidLine[];
  unpaidList: UnpaidLine[];
  income: { category: string; amount: number }[];
  expense: { category: string; amount: number }[];
  balances: AccountBalance[];
  checkDiff: number;
}

export function monthReport(data: AppData, month: string): MonthReport {
  const { settings } = data;
  const ps = active(data.payments);
  const prevEnd = monthEnd(addMonths(month, -1));
  const start = `${month}-01`;
  const end = monthEnd(month);
  const openingList = inTransitAt(ps, prevEnd);
  const receivedList = ps.filter((p) => p.paidDate >= start && p.paidDate <= end);
  const depositedList = ps.filter((p) => p.depositDate && p.depositDate >= start && p.depositDate <= end && p.paidDate <= end);
  const fromPrior = depositedList.filter((p) => p.paidDate <= prevEnd);
  const closingList = inTransitAt(ps, end);
  const alloc = settings.units.some((u) => !u.deletedAt) ? allocateAll(data) : null;


  const itemMap = new Map<string, number>();
  for (const p of receivedList) itemMap.set(p.item || '管理費', (itemMap.get(p.item || '管理費') ?? 0) + p.amount);

  const sumBy = (type: LedgerEntry['type']) => {
    const m = new Map<string, number>();
    for (const e of data.entries) {
      if (e.type !== type || e.date < start || e.date > end) continue;
      m.set(e.category || '未分類', (m.get(e.category || '未分類') ?? 0) + e.amount);
    }
    return Array.from(m, ([category, amount]) => ({ category, amount }));
  };

  const opening = totals(openingList);
  const received = totals(receivedList);
  const deposited = totals(depositedList);
  const closing = totals(closingList);

  return {
    month,
    start,
    end,
    openingInTransit: opening,
    received,
    deposited,
    depositedFromPrior: totals(fromPrior),
    closingInTransit: closing,
    byItem: Array.from(itemMap, ([item, amount]) => ({ item, amount })),
    ...advancesFor(data, month),
    receipt: alloc ? receiptBreakdown(alloc, data.payments, start, end) : null,
    writeOff: alloc ? monthWriteOff(alloc, data.payments, month) : null,
    paidList: alloc ? paidListForMonth(alloc, data.payments, month) : [],
    unpaidList: alloc ? unpaidByMonth(alloc, month) : [],
    income: sumBy('income'),
    expense: sumBy('expense'),
    balances: accountBalances(data, end, prevEnd),
    checkDiff: Math.round(opening.gross + received.gross - deposited.gross - closing.gross),
  };
}

export type RegisterKind = 'deposit' | 'income' | 'expense' | 'transferIn' | 'transferOut';

export interface RegisterLine {
  date: string;
  kind: RegisterKind;
  description: string;
  ref: string;
  inflow: number;
  outflow: number;
  balance: number;
}

export interface AccountRegister {
  accountId: string;
  name: string;
  accountNo: string;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  lines: RegisterLine[];
}

const KIND_ORDER: Record<RegisterKind, number> = { deposit: 0, income: 1, transferIn: 2, expense: 3, transferOut: 4 };

/**
 * 帳戶變動紀錄：某月份每個帳戶的期初、逐筆變動（智生活撥款依入帳日合併）與累計餘額、期末。
 * 期初日期之前的變動已包含在期初餘額中，不重複列出。
 */
export function accountRegisters(data: AppData, month: string): AccountRegister[] {
  const { settings } = data;
  const start = `${month}-01`;
  const end = monthEnd(month);
  const prevEnd = monthEnd(addMonths(month, -1));
  const depositId = resolveDepositAccountId(settings);
  const openings = new Map(accountBalances(data, prevEnd).map((b) => [b.accountId, b.closing]));
  const name = (id: string) => settings.accounts.find((a) => a.id === id)?.name ?? '';

  return settings.accounts.map((acc) => {
    const from = acc.openingDate && acc.openingDate > start ? acc.openingDate : start;
    const raw: Omit<RegisterLine, 'balance'>[] = [];
    if (acc.id === depositId) {
      const groups = new Map<string, Payment[]>();
      for (const p of active(data.payments)) {
        if (!p.depositDate || p.depositDate < from || p.depositDate > end) continue;
        const key = `${p.depositDate}|${p.batchId === 'manual' ? 'manual' : 'report'}`;
        (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
      }
      for (const [key, ps] of groups) {
        const manual = key.endsWith('manual');
        const amount = ps.reduce((s, p) => s + netAmount(p), 0);
        raw.push({
          date: ps[0].depositDate,
          kind: 'deposit',
          description: manual ? `管理費入帳（手動登錄 ${ps.length} 筆）` : `智生活管理費撥款（${ps.length} 筆）`,
          ref: '',
          inflow: amount > 0 ? amount : 0,
          outflow: amount < 0 ? -amount : 0,
        });
      }
    }
    for (const e of data.entries) {
      if (e.date < from || e.date > end) continue;
      const memo = [e.category, e.counterparty, e.note].filter(Boolean).join('　');
      if (e.type === 'income' && e.accountId === acc.id) raw.push({ date: e.date, kind: 'income', description: memo, ref: e.voucherNo, inflow: e.amount, outflow: 0 });
      else if (e.type === 'expense' && e.accountId === acc.id) raw.push({ date: e.date, kind: 'expense', description: memo, ref: e.voucherNo, inflow: 0, outflow: e.amount });
      else if (e.type === 'transfer' && e.toAccountId === acc.id) raw.push({ date: e.date, kind: 'transferIn', description: `由「${name(e.accountId)}」轉入　${memo}`, ref: e.voucherNo, inflow: e.amount, outflow: 0 });
      else if (e.type === 'transfer' && e.accountId === acc.id) raw.push({ date: e.date, kind: 'transferOut', description: `轉出至「${name(e.toAccountId)}」　${memo}`, ref: e.voucherNo, inflow: 0, outflow: e.amount });
    }
    raw.sort((a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.ref.localeCompare(b.ref));
    const opening = openings.get(acc.id) ?? acc.openingBalance;
    let balance = opening;
    const lines = raw.map((l) => {
      balance += l.inflow - l.outflow;
      return { ...l, balance };
    });
    const inflow = lines.reduce((s, l) => s + l.inflow, 0);
    const outflow = lines.reduce((s, l) => s + l.outflow, 0);
    return { accountId: acc.id, name: acc.name, accountNo: acc.accountNo, opening, inflow, outflow, closing: opening + inflow - outflow, lines };
  });
}
