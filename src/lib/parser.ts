import { FIELD_ALIASES, parseAmount, REQUIRED_FIELDS } from './defaults';
import { parseDate } from './dates';
import { ColumnMapping, FieldKey } from './types';

export type Cell = string | number | boolean | Date | null;
export type Grid = Cell[][];

export interface SheetTable {
  sheetName: string;
  headerRow: number;
  headers: string[];
  rows: Record<string, Cell>[];
}

export interface ParsedRow {
  rowNumber: number;
  unitNo: string;
  payerName: string;
  billPeriod: string;
  item: string;
  paidDate: string;
  channel: string;
  amount: number;
  fee: number;
  reportDepositDate: string;
  depositAmount: number | null;
  txnNo: string;
  status: string;
  note: string;
}

/** 報表上方的摘要資訊（智生活入帳報表：預計入帳日、撥款帳號、撥款金額…）。 */
export interface SheetMeta {
  depositDate: string;
  payoutAccount: string;
  payoutAmount: number | null;
  count: number | null;
}

/** 讀取標題列上方「名稱｜值」形式的摘要列。 */
export function sheetMeta(grid: Grid, headerRow: number): SheetMeta {
  const meta: SheetMeta = { depositDate: '', payoutAccount: '', payoutAmount: null, count: null };
  for (const row of grid.slice(0, headerRow)) {
    const label = cellText(row?.[0] ?? null).replace(/\s+/g, '');
    const value = row?.[1] ?? null;
    if (!label || value === null || value === '') continue;
    if (/預計入帳日|入帳日|撥款日/.test(label)) meta.depositDate ||= parseDate(value);
    else if (/撥款帳號|入帳帳號/.test(label)) meta.payoutAccount = cellText(value);
    else if (/撥款金額|入帳金額/.test(label)) meta.payoutAmount = parseAmount(value);
    else if (/入帳筆數|筆數/.test(label)) meta.count = parseAmount(value);
  }
  return meta;
}

/** 期別名稱去掉期間後剩下的文字當作項目，例如「115年10月管理費」→「管理費」。 */
export function itemFromPeriodName(text: string): string {
  return text
    .replace(/(\d{2,4})\s*[-/.年]\s*(\d{1,2})\s*月?/g, '')
    .replace(/^[\s~～至到\-－]+|[\s~～至到\-－]+$/g, '')
    .trim();
}

export interface RowIssue {
  rowNumber: number;
  reason: string;
}

const EXCLUDE: Partial<Record<FieldKey, string[]>> = {
  amount: ['應繳', '應收', '手續費', '未繳', '欠', '餘額', '折扣', '入帳', '撥款'],
  depositDate: ['金額'],
  paidDate: ['撥款', '入帳', '到期', '截止', '建立'],
  payerName: ['編號', '戶號'],
};

const norm = (s: unknown) => String(s ?? '').replace(/\s+/g, '').toLowerCase();

export type AliasMap = Record<string, string[]>;

export function cellText(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) return c.toISOString().slice(0, 10);
  return String(c).trim();
}

function scoreHeaderRow(row: Cell[], aliasMap: AliasMap): number {
  const texts = row.map(norm).filter(Boolean);
  let score = 0;
  for (const aliases of Object.values(aliasMap)) {
    if (texts.some((t) => aliases.some((a) => t.includes(norm(a))))) score++;
  }
  return score;
}

/** 在工作表前 30 列中找出最像標題列的那一列。 */
export function detectHeaderRow(grid: Grid, aliasMap: AliasMap = FIELD_ALIASES): number {
  let best = 0;
  let bestScore = -1;
  const limit = Math.min(grid.length, 30);
  for (let i = 0; i < limit; i++) {
    const s = scoreHeaderRow(grid[i] ?? [], aliasMap);
    if (s > bestScore) {
      best = i;
      bestScore = s;
    }
  }
  return best;
}

export function gridToTable(sheetName: string, grid: Grid, headerRow = detectHeaderRow(grid)): SheetTable {
  return buildTable(sheetName, grid, headerRow);
}

function buildTable(sheetName: string, grid: Grid, headerRow: number): SheetTable {
  const rawHeaders = (grid[headerRow] ?? []).map(cellText);
  const seen = new Map<string, number>();
  const headers = rawHeaders.map((h, i) => {
    const base = h || `欄${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}(${n})` : base;
  });
  const rows: Record<string, Cell>[] = [];
  for (let r = headerRow + 1; r < grid.length; r++) {
    const line = grid[r] ?? [];
    if (line.every((c) => cellText(c) === '')) continue;
    const obj: Record<string, Cell> = { __row: r + 1 };
    headers.forEach((h, i) => {
      obj[h] = line[i] ?? null;
    });
    rows.push(obj);
  }
  return { sheetName, headerRow, headers, rows };
}

/** 依別名自動對應欄位；已存在的對應若仍在標題中則保留。 */
export function guessMapping(headers: string[], saved: ColumnMapping = {}): ColumnMapping {
  return guessMappingWith(headers, FIELD_ALIASES, EXCLUDE, saved) as ColumnMapping;
}

export function guessMappingWith<K extends string>(
  headers: string[],
  aliasMap: Record<K, string[]>,
  exclude: Partial<Record<K, string[]>> = {},
  saved: Partial<Record<K, string>> = {},
): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  const used = new Set<string>();
  for (const [field, header] of Object.entries(saved) as [K, string][]) {
    if (header && headers.includes(header) && field in aliasMap) {
      out[field] = header;
      used.add(header);
    }
  }
  const fields = Object.keys(aliasMap) as K[];
  for (const pass of ['exact', 'contains'] as const) {
    for (const field of fields) {
      if (out[field]) continue;
      for (const alias of aliasMap[field]) {
        const hit = headers.find((h) => {
          if (used.has(h)) return false;
          if (exclude[field]?.some((x) => h.includes(x))) return false;
          return pass === 'exact' ? norm(h) === norm(alias) : norm(h).includes(norm(alias));
        });
        if (hit) {
          out[field] = hit;
          used.add(hit);
          break;
        }
      }
    }
  }
  return out;
}

export function missingRequired(mapping: ColumnMapping): FieldKey[] {
  return REQUIRED_FIELDS.filter((f) => !mapping[f]);
}

export function extractRows(
  table: SheetTable,
  mapping: ColumnMapping,
  excludeStatusKeywords: string[],
  defaults: { depositDate?: string } = {},
): { rows: ParsedRow[]; issues: RowIssue[] } {
  const rows: ParsedRow[] = [];
  const issues: RowIssue[] = [];
  const get = (r: Record<string, Cell>, f: FieldKey): Cell => (mapping[f] ? (r[mapping[f]!] ?? null) : null);
  for (const r of table.rows) {
    const rowNumber = Number(r.__row);
    const status = cellText(get(r, 'status'));
    const firstCell = cellText(r[table.headers[0]]);
    if (/^(合計|總計|小計|total)/i.test(firstCell)) continue;
    if (status && excludeStatusKeywords.some((k) => k && status.includes(k))) {
      issues.push({ rowNumber, reason: `狀態「${status}」已排除` });
      continue;
    }
    const paidDate = parseDate(get(r, 'paidDate'));
    const amount = parseAmount(get(r, 'amount'));
    if (!paidDate && !amount) continue;
    if (!paidDate) {
      issues.push({ rowNumber, reason: '繳費日期無法辨識' });
      continue;
    }
    if (!amount) {
      issues.push({ rowNumber, reason: '金額為 0 或無法辨識' });
      continue;
    }
    const billPeriod = cellText(get(r, 'billPeriod'));
    const depositCell = get(r, 'depositAmount');
    rows.push({
      rowNumber,
      unitNo: cellText(get(r, 'unitNo')),
      payerName: cellText(get(r, 'payerName')),
      billPeriod,
      item: cellText(get(r, 'item')) || itemFromPeriodName(billPeriod),
      paidDate,
      channel: cellText(get(r, 'channel')),
      amount,
      fee: Math.abs(parseAmount(get(r, 'fee'))),
      reportDepositDate: parseDate(get(r, 'depositDate')) || defaults.depositDate || '',
      depositAmount: depositCell === null || cellText(depositCell) === '' ? null : parseAmount(depositCell),
      txnNo: cellText(get(r, 'txnNo')),
      status,
      note: cellText(get(r, 'note')),
    });
  }
  return { rows, issues };
}

/** 將 CSV 位元組解碼成字串；UTF-8 失敗時改用 Big5（台灣舊系統常見）。 */
export function decodeText(bytes: Uint8Array): string {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return s.replace(/^﻿/, '');
  } catch {
    return new TextDecoder('big5').decode(bytes);
  }
}
