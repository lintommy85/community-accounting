import { AllocationResult, normUnit } from './allocation';
import { newId } from './defaults';
import { nextVoucher } from './ledger';
import { ownerAt } from './owners';
import { AppData, LedgerEntry, Renovation, RenovationDeduction, RenovationFeeMode, RenovationRateItem, RenovationSettings, Settings } from './types';

/** 報表上罰款的收入科目。 */
export const FINE_LABEL = '罰款收入';
export const NO_RATE_PLAN_ID = 'rp_none';

/** 裝潢保證金設定（沒有設定時用預設值：無費率方案、「裝潢保證金」「裝潢保證金退款」「裝潢保證金退款手續費」）。 */
export function renovationSettings(s: Pick<Settings, 'renovation'>): RenovationSettings {
  const r = s.renovation;
  const plans = r?.plans?.length ? r.plans : [{ id: NO_RATE_PLAN_ID, name: '無費率', items: [] }];
  return {
    plans,
    depositLabel: r?.depositLabel?.trim() || '裝潢保證金',
    refundLabel: r?.refundLabel?.trim() || '裝潢保證金退款',
    feeLabel: r?.feeLabel?.trim() || '裝潢保證金退款手續費',
    feeMode: r?.feeMode === 'combined' ? 'combined' : 'separate',
  };
}

export type RenovationLabelKind = 'deposit' | 'refund' | 'fee';
const LABEL_FIELD = { deposit: 'depositLabel', refund: 'refundLabel', fee: 'feeLabel' } as const;

/** 收到的保證金列在收入，退款與手續費列在支出。 */
export const renovationLabelType = (kind: RenovationLabelKind): 'income' | 'expense' => (kind === 'deposit' ? 'income' : 'expense');

export interface DepositReceipt {
  /** 繳費 id（智生活繳費）、分錄 id（手動登錄）或建立系統前已收的紀錄 id。 */
  id: string;
  unitNo: string;
  date: string;
  amount: number;
  source: 'payment' | 'manual' | 'opening';
}

/** 各戶收到的裝潢保證金：智生活繳費中付保證金的部分、手動登錄的，以及建立系統前已收的。 */
export function depositReceipts(data: AppData, alloc: AllocationResult): Map<string, DepositReceipt[]> {
  const out = new Map<string, DepositReceipt[]>();
  const push = (key: string, r: DepositReceipt) => (out.get(key) ?? out.set(key, []).get(key)!).push(r);
  const paidDate = new Map(data.payments.map((p) => [p.id, p.paidDate]));
  for (const acc of alloc.accounts) {
    const byPayment = new Map<string, number>();
    for (const c of acc.chargePaid) if (c.kind === 'deposit') byPayment.set(c.paymentId, (byPayment.get(c.paymentId) ?? 0) + c.amount);
    for (const [id, amount] of byPayment) push(acc.key, { id, unitNo: acc.unit.unitNo, date: paidDate.get(id) ?? '', amount, source: 'payment' });
  }
  for (const e of data.entries) {
    if (e.renovationKind !== 'deposit' || !e.renovationUnit) continue;
    push(normUnit(e.renovationUnit), { id: e.id, unitNo: e.renovationUnit, date: e.date, amount: e.amount, source: 'manual' });
  }
  for (const o of data.renovationOpenings ?? []) push(normUnit(o.unitNo), { id: o.id, unitNo: o.unitNo, date: o.date, amount: o.amount, source: 'opening' });
  for (const list of out.values()) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export interface UnitDeposit {
  key: string;
  unitNo: string;
  owner: string;
  /** 還沒結算的保證金收款。 */
  open: DepositReceipt[];
  openTotal: number;
  /** 進行中（還沒結算）的裝修紀錄。 */
  renovation?: Renovation;
  settled: Renovation[];
}

/** 每戶的裝潢保證金狀態；結算時記下包含的收款，之後收到的算下一次裝修。 */
export function unitDeposits(data: AppData, alloc: AllocationResult, month: string): Map<string, UnitDeposit> {
  const receipts = depositReceipts(data, alloc);
  const used = new Set(data.renovations.flatMap((r) => r.settlement?.receiptIds ?? []));
  const keys = new Set([...receipts.keys(), ...data.renovations.map((r) => normUnit(r.unitNo))]);
  const units = new Map(data.settings.units.map((u) => [normUnit(u.unitNo), u]));
  const out = new Map<string, UnitDeposit>();
  for (const key of keys) {
    const unit = units.get(key);
    const open = (receipts.get(key) ?? []).filter((r) => !used.has(r.id));
    const mine = data.renovations.filter((r) => normUnit(r.unitNo) === key);
    out.set(key, {
      key,
      unitNo: unit?.unitNo ?? open[0]?.unitNo ?? mine[0]?.unitNo ?? key,
      owner: unit ? ownerAt(unit, month) : '',
      open,
      openTotal: open.reduce((t, r) => t + r.amount, 0),
      renovation: mine.find((r) => !r.settlement),
      settled: mine.filter((r) => r.settlement).sort((a, b) => (b.settlement!.at).localeCompare(a.settlement!.at)),
    });
  }
  return out;
}

/** 進行中的裝潢保證金（有收到還沒結算的保證金）合計與戶數，總覽用。 */
export function openDepositSummary(data: AppData, alloc: AllocationResult, month: string): { total: number; units: number } {
  const list = Array.from(unitDeposits(data, alloc, month).values()).filter((u) => u.openTotal > 0);
  return { total: list.reduce((t, u) => t + u.openTotal, 0), units: list.length };
}

/** 依費率計算扣款：單筆直接扣，每日乘上天數。 */
export function computeDeductions(items: RenovationRateItem[], days: Record<string, number>): RenovationDeduction[] {
  return items.map((i) => {
    const d = i.mode === 'daily' ? Math.max(0, Math.floor(days[i.id] ?? 0)) : undefined;
    return { name: i.name, mode: i.mode, amount: i.amount, days: d, deducted: Math.round(i.mode === 'daily' ? i.amount * (d ?? 0) : i.amount) };
  });
}

export interface SettleInput {
  unitNo: string;
  renovation?: Renovation;
  planName: string;
  items: RenovationRateItem[];
  startDate: string;
  deposit: number;
  receiptIds: string[];
  deductions: RenovationDeduction[];
  refund: number;
  fee: number;
  /** 手續費分開列一筆，或併入退款整筆呈現；沒給時用設定的預設方式。 */
  feeMode?: RenovationFeeMode;
  date: string;
  accountId: string;
}

/** 結算：分開呈現時退款與匯款手續費各建立一筆支出分錄，整筆呈現時只建立一筆退款（含手續費）；報表不顯示戶別，並記下這次結算。 */
export function settleRenovation(data: AppData, input: SettleInput, now = new Date().toISOString()): AppData {
  const cfg = renovationSettings(data.settings);
  const id = input.renovation?.id ?? newId('rn_');
  const entries: LedgerEntry[] = [];
  const base = { date: input.date, accountId: input.accountId, toAccountId: '', counterparty: '', note: '', renovationUnit: input.unitNo, renovationId: id };
  const all = () => [...data.entries, ...entries];
  const feeMode = input.feeMode ?? cfg.feeMode;
  const combined = feeMode === 'combined';
  const refundAmount = combined ? input.refund + input.fee : input.refund;
  if (refundAmount > 0) entries.push({ ...base, id: newId('e_'), type: 'expense', category: cfg.refundLabel, amount: refundAmount, voucherNo: nextVoucher(all(), input.date), renovationKind: 'refund' });
  if (!combined && input.fee > 0) entries.push({ ...base, id: newId('e_'), type: 'expense', category: cfg.feeLabel, amount: input.fee, voucherNo: nextVoucher(all(), input.date), renovationKind: 'fee' });
  const deducted = input.deductions.reduce((t, d) => t + d.deducted, 0);
  const renovation: Renovation = {
    id,
    unitNo: input.unitNo,
    planName: input.planName,
    items: input.items,
    startDate: input.startDate,
    note: input.renovation?.note ?? '',
    createdAt: input.renovation?.createdAt ?? now,
    settlement: {
      at: now,
      date: input.date,
      deposit: input.deposit,
      receiptIds: input.receiptIds,
      deductions: input.deductions,
      deducted,
      refundTotal: input.refund + input.fee,
      refund: input.refund,
      fee: input.fee,
      feeMode,
      accountId: input.accountId,
      entryIds: entries.map((e) => e.id),
    },
  };
  const addCat = (list: string[], c: string) => (list.includes(c) ? list : [...list, c]);
  return {
    ...data,
    settings: {
      ...data.settings,
      renovation: { ...cfg, feeMode },
      expenseCategories: combined ? addCat(data.settings.expenseCategories, cfg.refundLabel) : addCat(addCat(data.settings.expenseCategories, cfg.refundLabel), cfg.feeLabel),
    },
    entries: [...data.entries, ...entries],
    renovations: [...data.renovations.filter((r) => r.id !== id), renovation],
  };
}

/** 取消結算：刪除這次結算的退款、手續費分錄，裝修紀錄回到進行中。 */
export function cancelSettlement(data: AppData, renovationId: string): AppData {
  const r = data.renovations.find((x) => x.id === renovationId);
  if (!r?.settlement) return data;
  const ids = new Set(r.settlement.entryIds);
  const { settlement: _drop, ...rest } = r;
  return { ...data, entries: data.entries.filter((e) => !ids.has(e.id)), renovations: data.renovations.map((x) => (x.id === renovationId ? rest : x)) };
}

/** 修改報表名稱：連同已建立的分錄、收支科目與「固定」勾選一起改，報表同步更新；舊名稱還有其他分錄在用時保留在科目清單。 */
export function renameRenovationLabel(data: AppData, kind: RenovationLabelKind, next: string): AppData {
  const cfg = renovationSettings(data.settings);
  const name = next.trim();
  const prev = cfg[LABEL_FIELD[kind]];
  if (!name || name === prev) return data;
  const type = renovationLabelType(kind);
  const othersUse = data.entries.some((e) => e.type === type && e.category === prev && e.renovationKind !== kind);
  const swap = (list: string[]) => {
    if (!list.includes(prev)) return list;
    const out = othersUse ? [...list, name] : list.map((c) => (c === prev ? name : c));
    return out.filter((c, i) => out.indexOf(c) === i);
  };
  const s = data.settings;
  const field = type === 'income' ? 'incomeCategories' : 'expenseCategories';
  return {
    ...data,
    settings: { ...s, renovation: { ...cfg, [LABEL_FIELD[kind]]: name }, [field]: swap(s[field]), fixedCategories: swap(s.fixedCategories) },
    entries: data.entries.map((e) => (e.renovationKind === kind && e.category === prev ? { ...e, category: name } : e)),
  };
}

/** 在「基本設定 → 收支科目」改名時：被改的科目是裝潢保證金的報表名稱的話，名稱設定跟著改。 */
export function renovationAfterCategoryRename(s: Settings, type: 'income' | 'expense', prev: string, next: string): Settings['renovation'] {
  if (!s.renovation) return s.renovation;
  const cfg = renovationSettings(s);
  const kinds = (Object.keys(LABEL_FIELD) as RenovationLabelKind[]).filter((k) => renovationLabelType(k) === type && cfg[LABEL_FIELD[k]] === prev);
  if (!kinds.length) return s.renovation;
  return { ...cfg, ...Object.fromEntries(kinds.map((k) => [LABEL_FIELD[k], next])) };
}

/** 建立系統前已收的保證金：只記在這戶，不建立分錄，不影響帳戶餘額與報表。 */
export function addRenovationOpening(data: AppData, input: { unitNo: string; date: string; amount: number; accountId: string }): AppData {
  return { ...data, renovationOpenings: [...(data.renovationOpenings ?? []), { id: newId('ro_'), ...input }] };
}

/** 帳戶的期初日期；入帳日期早於它的保證金可以標成建立系統前已收。 */
export function isBeforeOpening(s: Pick<Settings, 'accounts'>, accountId: string, date: string): boolean {
  const opening = s.accounts.find((a) => a.id === accountId)?.openingDate ?? '';
  return !!opening && !!date && date < opening;
}
