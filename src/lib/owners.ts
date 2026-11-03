import { normUnit } from './dues';
import { OwnerPeriod, Unit } from './types';

/** 比對所有權人時忽略空白（含全形空白）。 */
export const sameOwner = (a: string, b: string) => a.replace(/\s+/g, '') === b.replace(/\s+/g, '');

/** 所有權人紀錄（依起始月份排序）；舊資料只有 owner 時視為從最早開始。 */
export function ownerHistory(u: Pick<Unit, 'owner' | 'owners'>): OwnerPeriod[] {
  if (u.owners?.length) return [...u.owners].sort((a, b) => a.from.localeCompare(b.from));
  return u.owner ? [{ from: '', owner: u.owner }] : [];
}

/** 某月份的所有權人：起始月份不晚於該月的最後一筆；比最早紀錄還早的月份用最早那一筆。 */
export function ownerAt(u: Pick<Unit, 'owner' | 'owners'>, month: string): string {
  const list = ownerHistory(u);
  if (!list.length) return u.owner;
  let cur = list[0];
  for (const p of list) if (!p.from || p.from <= month) cur = p;
  return cur.owner;
}

/** 搜尋用：所有曾經的所有權人。 */
export const ownerNames = (u: Pick<Unit, 'owner' | 'owners'>) => Array.from(new Set([u.owner, ...ownerHistory(u).map((p) => p.owner)].filter(Boolean)));

export const ownerMatches = (u: Pick<Unit, 'owner' | 'owners'>, kw: string) => ownerNames(u).some((n) => n.toUpperCase().includes(kw));

function withHistory(u: Unit, list: OwnerPeriod[]): Unit {
  const sorted = [...list].sort((a, b) => a.from.localeCompare(b.from));
  // 相鄰兩段是同一人就合併（保留較早的起始月份）
  const merged = sorted.filter((p, i) => i === 0 || !sameOwner(p.owner, sorted[i - 1].owner));
  return { ...u, owners: merged, owner: merged[merged.length - 1]?.owner ?? '' };
}

/**
 * 從某月份起變更所有權人：只影響這個月份與之後（直到下一筆紀錄），之前的月份不變。
 * 該月份原本沒有所有權人（空白）時直接補上；沒有任何紀錄時這就是最早的一筆。
 */
export function setOwnerFrom(u: Unit, month: string, owner: string, source: OwnerPeriod['source'], at = new Date().toISOString()): Unit {
  const name = owner.trim();
  const list = ownerHistory(u);
  if (!list.length) return withHistory(u, [{ from: month, owner: name, source, at }]);
  if (sameOwner(ownerAt(u, month), name)) return u;
  const governing = [...list].reverse().find((p) => !p.from || p.from <= month) ?? list[0];
  if (!governing.owner) return withHistory(u, list.map((p) => (p === governing ? { ...p, owner: name, source, at } : p)));
  return withHistory(u, [...list.filter((p) => p.from !== month), { from: month, owner: name, source, at }]);
}

/** 修改某一段的所有權人名稱（修正錯字，不新增變更）。 */
export const renameOwnerPeriod = (u: Unit, from: string, owner: string) =>
  withHistory(u, ownerHistory(u).map((p) => (p.from === from ? { ...p, owner: owner.trim(), source: 'manual' as const, at: new Date().toISOString() } : p)));

/** 刪除一筆變更（前一段延續下去）；最早一筆不能刪。 */
export function removeOwnerPeriod(u: Unit, from: string): Unit {
  const list = ownerHistory(u);
  if (list.length <= 1 || list[0].from === from) return u;
  return withHistory(u, list.filter((p) => p.from !== from));
}

/** 所有權人紀錄的文字，例如「2026-01 起 王小明；2026-11 起 李大華」。 */
export const ownerHistoryText = (u: Pick<Unit, 'owner' | 'owners'>) =>
  ownerHistory(u).map((p) => `${p.from ? `${p.from} 起` : '最早'} ${p.owner || '（空白）'}`).join('；');

/** 範本上的一個戶別：所有權人與帳單月份。 */
export interface IncomingUnit {
  unitNo: string;
  owner: string;
  zsId: string;
  address: string;
  /** 這列帳單的月份（繳費開始日期）；所有權人變更從這個月份起算。 */
  month: string;
}

export type IncomingStatus = 'new' | 'existing' | 'excluded';

export interface OwnerDiff {
  key: string;
  unitNo: string;
  month: string;
  /** 系統在該月份的所有權人。 */
  current: string;
  incoming: string;
}

export interface UnitImportPlan {
  rows: { row: IncomingUnit; key: string; status: IncomingStatus; exclude: boolean }[];
  /** 所有權人和系統不同（要選擇是否從帳單月份起變更）。 */
  ownerDiffs: OwnerDiff[];
  /** 系統沒有所有權人、直接補上的戶數。 */
  fills: number;
  added: number;
  restored: number;
  excludedNow: number;
}

/**
 * 匯入範本的戶別：預設全部匯入，已排除的戶別維持排除；excludes 可逐戶改為排除或取消排除。
 * 匯入的戶別逐戶比對該月份的所有權人。
 */
export function planUnitImport(existing: Unit[], incoming: IncomingUnit[], excludes: Map<string, boolean> = new Map()): UnitImportPlan {
  const index = new Map(existing.map((u) => [normUnit(u.unitNo), u]));
  const plan: UnitImportPlan = { rows: [], ownerDiffs: [], fills: 0, added: 0, restored: 0, excludedNow: 0 };
  const seen = new Set<string>();
  for (const row of incoming) {
    const key = normUnit(row.unitNo);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const u = index.get(key);
    const status: IncomingStatus = !u ? 'new' : u.deletedAt ? 'excluded' : 'existing';
    const exclude = excludes.get(key) ?? status === 'excluded';
    plan.rows.push({ row, key, status, exclude });
    if (exclude) {
      if (status === 'existing') plan.excludedNow++;
      continue;
    }
    if (status === 'new') {
      plan.added++;
      continue;
    }
    if (status === 'excluded') plan.restored++;
    if (!row.owner) continue;
    const current = ownerAt(u!, row.month);
    if (!current) plan.fills++;
    else if (!sameOwner(current, row.owner)) plan.ownerDiffs.push({ key, unitNo: u!.unitNo, month: row.month, current, incoming: row.owner.trim() });
  }
  return plan;
}

/** 排除的戶別 key（含原本已排除、這次沒取消的）：這些戶別的應繳不匯入。 */
export const excludedKeys = (existing: Unit[], plan: UnitImportPlan) =>
  new Set([...existing.filter((u) => u.deletedAt).map((u) => normUnit(u.unitNo)).filter((k) => !plan.rows.some((r) => r.key === k && !r.exclude)), ...plan.rows.filter((r) => r.exclude).map((r) => r.key)]);

/** 套用範本的戶別：新增、排除／取消排除、補齊資料，所有權人依選擇從帳單月份起變更（不回溯）。 */
export function applyUnitImport(existing: Unit[], plan: UnitImportPlan, changeOwner: Set<string>, newId: () => string, at = new Date().toISOString()): Unit[] {
  const out = existing.slice();
  const index = new Map(out.map((u, i) => [normUnit(u.unitNo), i]));
  for (const { row, key, status, exclude } of plan.rows) {
    const i = index.get(key);
    if (status === 'new') {
      const owners = row.owner ? [{ from: row.month, owner: row.owner, source: 'import' as const, at }] : undefined;
      out.push({ id: newId(), unitNo: row.unitNo, owner: row.owner, owners, monthlyFee: 0, note: exclude ? '匯入時排除' : '', zsId: row.zsId || undefined, address: row.address || undefined, deletedAt: exclude ? at : undefined });
      index.set(key, out.length - 1);
      continue;
    }
    let u = out[i!];
    if (exclude) {
      if (!u.deletedAt) out[i!] = { ...u, deletedAt: at };
      continue;
    }
    if (u.deletedAt) u = { ...u, deletedAt: undefined };
    u = { ...u, zsId: u.zsId || row.zsId || undefined, address: u.address || row.address || undefined };
    if (row.owner) {
      const current = ownerAt(u, row.month);
      if (!current || changeOwner.has(key)) u = setOwnerFrom(u, row.month, row.owner, 'import', at);
    }
    out[i!] = u;
  }
  return out;
}
