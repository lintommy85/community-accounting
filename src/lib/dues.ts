import { parseDate, parsePeriods } from './dates';
import { newId, parseAmount } from './defaults';
import { cellText, Cell, SheetTable } from './parser';
import type { IncomingUnit } from './owners';
import { Due } from './types';

export const DEFAULT_ITEM = '管理費';
export const PRIOR_ITEM = '前期欠款';
/** 帳單項目對應：罰款，不列入應繳，繳款記在帳卡、列為罰款收入。 */
export const BILL_FINE = '__fine__';
/** 帳單項目對應：裝潢保證金，不列入應繳，繳款記在帳卡，到「裝潢保證金」結算退款。 */
export const BILL_DEPOSIT = '__deposit__';

/** 去掉智生活項目名稱前的年月，例如「11月坪數費」→「坪數費」、「115年1~12月管理費」→「管理費」、「10月未繳管理費」→「未繳管理費」。 */
export const billItemName = (item: string) =>
  item
    .replace(/^\s*(\d{2,3}\s*年\s*)?\d{1,2}\s*([-~～至到]\s*\d{1,2}\s*)?月(份)?\s*/, '')
    .replace(/^\s*\d{2,4}\s*年度?\s*(?=[^\d\s])/, '')
    .trim() || item.trim();
/** 系統沒有這戶的預繳款（例如啟用本系統前預繳）時，沖銷照帳單減少應繳；之後有預收款時，銷帳會自動改由預收款沖銷。 */
export const PREPAID_BEFORE_ITEM = '預繳沖銷（啟用前預繳）';

export const normUnit = (s: string) => s.replace(/\s+/g, '').toUpperCase();

export const dueKey = (unitNo: string, month: string, item: string) => `${normUnit(unitNo)}|${month}|${item.trim() || DEFAULT_ITEM}`;

export type DueField = 'unitNo' | 'owner' | 'billPeriod' | 'item' | 'amount';

export interface DueRow {
  unitNo: string;
  owner: string;
  month: string;
  item: string;
  amount: number;
  billAmount?: number;
  fromBill?: string;
  kind?: Due['kind'];
}

export interface DueRowIssue {
  rowNumber: number;
  reason: string;
}

/** 平均拆成 n 份（取整數，餘數放最後一份）。 */
export function splitAmount(amount: number, n: number): number[] {
  const base = Math.trunc(amount / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? amount - base * (n - 1) : base));
}

/**
 * 從帳單表格取出應繳列：期別為區間時平均拆到各月，沒有期別時用 fallbackMonth；
 * 同一檔案內相同戶別＋月份＋項目會加總；金額可為負數（減收），0 元略過。
 */
export function dueRowsFromTable(
  table: SheetTable,
  mapping: Partial<Record<DueField, string>>,
  fallbackMonth: string,
): { rows: DueRow[]; issues: DueRowIssue[] } {
  const get = (r: Record<string, Cell>, f: DueField) => (mapping[f] ? r[mapping[f]!] ?? null : null);
  const merged = new Map<string, DueRow>();
  const issues: DueRowIssue[] = [];
  for (const r of table.rows) {
    const rowNumber = Number(r.__row);
    const unitNo = cellText(get(r, 'unitNo'));
    if (!unitNo || /^(合計|總計|小計)/.test(unitNo)) continue;
    const amount = parseAmount(get(r, 'amount'));
    if (!amount) continue;
    const periodText = cellText(get(r, 'billPeriod'));
    const months = parsePeriods(periodText);
    if (!months.length && periodText) {
      issues.push({ rowNumber, reason: `期別「${periodText}」無法辨識` });
      continue;
    }
    if (!months.length && !fallbackMonth) {
      issues.push({ rowNumber, reason: '沒有期別，請指定帳單月份' });
      continue;
    }
    const list = months.length ? months : [fallbackMonth];
    const item = cellText(get(r, 'item')) || DEFAULT_ITEM;
    const owner = cellText(get(r, 'owner'));
    splitAmount(amount, list.length).forEach((a, i) => {
      const key = dueKey(unitNo, list[i], item);
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, amount: prev.amount + a, owner: prev.owner || owner } : { unitNo, owner, month: list[i], item, amount: a });
    });
  }
  return { rows: Array.from(merged.values()), issues };
}

export type DueChangeStatus = 'new' | 'changed' | 'same' | 'removed';

export interface DueChange extends DueRow {
  key: string;
  status: DueChangeStatus;
  prev?: Due;
}

const billOf = (d: { amount: number; billAmount?: number }) => d.billAmount ?? d.amount;

/**
 * 與既有應繳比對：金額相同略過、不同才更新、沒有的新增。
 * billed 為這次匯入涵蓋的「戶別|帳單月份」，之前由這些帳單匯入、這次已不在帳單上的應繳（含拆出的前期欠款、週期月份）會標示刪除。
 */
export function diffDues(existing: Due[], rows: DueRow[], billed: Set<string> = new Set()): DueChange[] {
  const byKey = new Map(existing.map((d) => [dueKey(d.unitNo, d.month, d.item), d]));
  const keys = new Set<string>();
  const changes: DueChange[] = rows.map((r) => {
    const key = dueKey(r.unitNo, r.month, r.item);
    keys.add(key);
    const prev = byKey.get(key);
    const status: DueChangeStatus = !prev ? 'new' : prev.amount === r.amount && billOf(prev) === billOf(r) && prev.kind === r.kind ? 'same' : 'changed';
    return { ...r, key, status, prev };
  });
  for (const d of existing) {
    const key = dueKey(d.unitNo, d.month, d.item);
    const fromThisBill = d.fromBill ? billed.has(`${normUnit(d.unitNo)}|${d.fromBill}`) : !!d.kind && billed.has(`${normUnit(d.unitNo)}|${d.month}`);
    if (fromThisBill && !keys.has(key)) {
      changes.push({ unitNo: d.unitNo, owner: '', month: d.month, item: d.item, amount: 0, key, status: 'removed', prev: d });
    }
  }
  return changes.sort((a, b) => a.unitNo.localeCompare(b.unitNo, 'zh-Hant', { numeric: true }) || a.month.localeCompare(b.month) || a.item.localeCompare(b.item));
}

export function applyDueChanges(existing: Due[], changes: DueChange[], now = new Date().toISOString()): Due[] {
  const updates = new Map(changes.filter((c) => c.status === 'changed').map((c) => [c.prev!.id, c]));
  const removed = new Set(changes.filter((c) => c.status === 'removed').map((c) => c.prev!.id));
  const out = existing
    .filter((d) => !removed.has(d.id))
    .map((d) => {
      const c = updates.get(d.id);
      return c ? { ...d, amount: c.amount, billAmount: c.billAmount, fromBill: c.fromBill, kind: c.kind, source: 'import' as const, updatedAt: now } : d;
    });
  for (const c of changes) {
    if (c.status !== 'new') continue;
    out.push({ id: newId('d_'), unitNo: c.unitNo, month: c.month, item: c.item, amount: c.amount, billAmount: c.billAmount, fromBill: c.fromBill, kind: c.kind, source: 'import', note: c.fromBill ? `${c.fromBill} 帳單內含` : '', updatedAt: now });
  }
  return out;
}

export type UnitRow = IncomingUnit;

/** 智生活「管理費匯入範本」：一戶一列，應繳總額與繳費開始日期之間的每一欄是一個收費項目。 */
export interface WideLayout {
  unitCol: string;
  ownerCol?: string;
  idCol?: string;
  addressCol?: string;
  startCol?: string;
  itemCols: string[];
}

export function detectWideLayout(headers: string[]): WideLayout | null {
  const clean = (h: string) => h.replace(/\s+/g, '');
  const find = (re: RegExp) => headers.find((h) => re.test(clean(h)));
  const totalIdx = headers.findIndex((h) => /應繳總額|應繳合計|應收總額/.test(clean(h)));
  const startIdx = headers.findIndex((h) => /繳費開始日期|開始日期/.test(clean(h)));
  const unitCol = find(/^戶別代碼$/) ?? find(/戶別代碼|戶號|門牌/);
  if (totalIdx < 0 || !unitCol) return null;
  const end = startIdx > totalIdx ? startIdx : headers.length;
  const itemCols = headers.slice(totalIdx + 1, end).filter((h) => h && !/^欄\d+$/.test(h));
  if (!itemCols.length) return null;
  return {
    unitCol,
    ownerCol: find(/所有權人|區權人|姓名/),
    idCol: find(/^戶別id/i),
    addressCol: find(/通訊地址|^地址$/),
    startCol: startIdx >= 0 ? headers[startIdx] : undefined,
    itemCols,
  };
}

const itemName = (header: string) => header.replace(/\(\d+\)$/, '').trim();
const isFilterRow = (unitNo: string) => /^篩選$/.test(unitNo);

export function dueRowsFromWide(
  table: SheetTable,
  layout: WideLayout,
  fallbackMonth: string,
): { rows: DueRow[]; units: UnitRow[]; issues: DueRowIssue[] } {
  const merged = new Map<string, DueRow>();
  const units = new Map<string, UnitRow>();
  const issues: DueRowIssue[] = [];
  const text = (r: Record<string, Cell>, col?: string) => (col ? cellText(r[col] ?? null) : '');
  for (const r of table.rows) {
    const unitNo = text(r, layout.unitCol);
    if (!unitNo || isFilterRow(unitNo) || /^\(如留空白/.test(unitNo)) continue;
    const owner = text(r, layout.ownerCol);
    const start = layout.startCol ? parseDate(r[layout.startCol] ?? null) : '';
    const month = start ? start.slice(0, 7) : fallbackMonth;
    if (!units.has(normUnit(unitNo))) units.set(normUnit(unitNo), { unitNo, owner, zsId: text(r, layout.idCol), address: text(r, layout.addressCol), month });
    const amounts = layout.itemCols.map((c) => [itemName(c), parseAmount(r[c] ?? null)] as const).filter(([, a]) => a);
    if (!amounts.length) continue;
    if (!month) {
      issues.push({ rowNumber: Number(r.__row), reason: '沒有繳費開始日期，請指定帳單月份' });
      continue;
    }
    for (const [item, amount] of amounts) {
      const key = dueKey(unitNo, month, item);
      const prev = merged.get(key);
      merged.set(key, prev ? { ...prev, amount: prev.amount + amount } : { unitNo, owner, month, item, amount });
    }
  }
  return { rows: Array.from(merged.values()), units: Array.from(units.values()), issues };
}
