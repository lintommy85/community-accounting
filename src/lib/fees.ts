import { detectHeaderRow, Grid, gridToTable, guessMappingWith, SheetTable } from './parser';
import { addMonths } from './dates';
import { FeePlan, Settings, Unit, UnitExtra } from './types';

export const CYCLES: { months: number; label: string }[] = [
  { months: 1, label: '月繳' },
  { months: 2, label: '雙月繳' },
  { months: 3, label: '季繳' },
  { months: 6, label: '半年繳' },
  { months: 12, label: '年繳' },
];

export const cycleLabel = (u: Pick<Unit, 'cycle' | 'cycleStart'>) => {
  const n = u.cycle ?? 1;
  const name = CYCLES.find((c) => c.months === n)?.label ?? `每 ${n} 個月`;
  return n > 1 ? `${name}（${u.cycleStart ?? 1} 月起）` : name;
};

/** 某月份是否為這戶繳費週期的第一個月（帳單月份）。 */
export function isCycleStart(u: Pick<Unit, 'cycle' | 'cycleStart'>, month: string): boolean {
  const n = u.cycle ?? 1;
  if (n <= 1) return true;
  return (((Number(month.slice(5)) - (u.cycleStart ?? 1)) % n) + n) % n === 0;
}

/** 帳單月份起算的週期月份，例如季繳 11 月帳單 → 11、12、1 月。 */
export const cycleMonths = (month: string, n: number) => Array.from({ length: Math.max(1, n) }, (_, i) => addMonths(month, i));

export const MGMT_ITEM = '管理費';

/** 這戶主方案的繳費項目名稱：套用方案時就是方案名稱（例如「坪數費」），個別金額為「管理費」。 */
export const mainItemName = (u: Pick<Unit, 'planId'>, plans: FeePlan[]) => (u.planId && plans.find((p) => p.id === u.planId)?.name) || MGMT_ITEM;

/** 主方案的繳費項目名稱：「管理費」及所有被戶別當主方案套用的方案名稱，彼此視為同一項（主要費用）。 */
export function mainItemNames(settings: Pick<Settings, 'feePlans' | 'units'>): Set<string> {
  const ids = new Set(settings.units.filter((u) => !u.deletedAt && u.planId).map((u) => u.planId));
  return new Set([MGMT_ITEM, ...settings.feePlans.filter((p) => ids.has(p.id)).map((p) => p.name)]);
}

/** 加收的繳費項目名稱：套用方案時就是方案名稱。 */
export const extraItem = (e: UnitExtra, plans: FeePlan[]) => (e.planId ? plans.find((p) => p.id === e.planId)?.name : e.item) ?? '';

const extraAmount = (e: UnitExtra, u: Unit, plans: FeePlan[]) => {
  const plan = e.planId ? plans.find((p) => p.id === e.planId) : undefined;
  return plan ? planFee(plan, u) * (e.qty || 1) : e.amount ?? 0;
};

/**
 * 每戶每月的基準（依繳費項目）：主方案用方案名稱（個別金額為「管理費」），加收依方案名稱（或自訂項目）。
 * 只在匯入每月應繳報表、入帳報表時拿來比對。
 */
export function unitBaselines(u: Unit, plans: FeePlan[]): Map<string, number> {
  const out = new Map<string, number>();
  if (u.monthlyFee) out.set(mainItemName(u, plans), u.monthlyFee);
  for (const e of u.extras ?? []) {
    const item = extraItem(e, plans);
    const amount = extraAmount(e, u, plans);
    if (item && amount) out.set(item, (out.get(item) ?? 0) + amount);
  }
  return out;
}

export const unitBaseline = (u: Unit, plans: FeePlan[]) => Array.from(unitBaselines(u, plans).values()).reduce((s, v) => s + v, 0);

/** 基準費率裡的繳費項目：管理費＋所有方案名稱，智生活帳單項目要對應到其中之一。 */
export function feeItemNames(settings: Pick<Settings, 'feePlans' | 'units'>): string[] {
  const names = [MGMT_ITEM, ...settings.feePlans.map((p) => p.name)];
  for (const u of settings.units) for (const e of u.extras ?? []) if (e.item) names.push(e.item);
  return Array.from(new Set(names.filter(Boolean)));
}

/**
 * 依帳單金額更新某戶某項目的每月基準：
 * 管理費套用依坪數方案時改坪數、固定方案金額相同就保留，否則改個別金額；加收是方案倍數時改數量，否則改自訂金額；0 表示移除。
 */
export function setUnitItemBaseline(u: Unit, item: string, monthly: number, plans: FeePlan[]): Unit {
  if (item === MGMT_ITEM || item === mainItemName(u, plans)) {
    const plan = plans.find((p) => p.id === u.planId);
    if (plan?.basis === 'area' && plan.amount) {
      const area = Math.round((monthly / plan.amount) * 100) / 100;
      if (planFee(plan, { area }) === monthly) return { ...u, area, monthlyFee: monthly };
    }
    if (plan && plan.basis !== 'area' && plan.amount === monthly) return { ...u, monthlyFee: monthly };
    return { ...u, planId: undefined, monthlyFee: monthly };
  }
  const others = (u.extras ?? []).filter((e) => extraItem(e, plans) !== item);
  if (!monthly) return { ...u, extras: others };
  const plan = plans.find((p) => p.name === item);
  const unitFee = plan ? planFee(plan, u) : 0;
  const next: UnitExtra = plan && unitFee && monthly % unitFee === 0 ? { planId: plan.id, qty: monthly / unitFee } : { item, amount: monthly, qty: 1 };
  return { ...u, extras: [...others, next] };
}

/** 勾選的戶別加上（或更新數量）一個加收方案。 */
export function assignExtra(units: Unit[], ids: Set<string>, planId: string, qty: number, plans: FeePlan[] = []): Unit[] {
  const name = plans.find((p) => p.id === planId)?.name;
  return units.map((u) => (ids.has(u.id) ? { ...u, extras: [...(u.extras ?? []).filter((e) => e.planId !== planId && !(name && e.item === name)), { planId, qty }] } : u));
}

export function removeExtra(units: Unit[], ids: Set<string>, planId: string): Unit[] {
  return units.map((u) => (ids.has(u.id) && u.extras?.some((e) => e.planId === planId) ? { ...u, extras: u.extras.filter((e) => e.planId !== planId) } : u));
}

/** 設定勾選戶別的繳費週期與起始月份。 */
export function assignCycle(units: Unit[], ids: Set<string>, cycle: number, start: number): Unit[] {
  return units.map((u) => (ids.has(u.id) ? { ...u, cycle: cycle > 1 ? cycle : undefined, cycleStart: cycle > 1 ? start : undefined } : u));
}

export const activeUnits = (units: Unit[]) => units.filter((u) => !u.deletedAt);
export const deletedUnits = (units: Unit[]) => units.filter((u) => u.deletedAt);

export const sortUnits = (units: Unit[]) => units.slice().sort((a, b) => a.unitNo.localeCompare(b.unitNo, 'zh-Hant', { numeric: true }));

/** 方案套用到某戶的月費：固定金額，或每坪單價 × 坪數（四捨五入到元）。 */
export function planFee(plan: FeePlan, unit: Pick<Unit, 'area'>): number {
  return plan.basis === 'area' ? Math.round(plan.amount * (unit.area ?? 0)) : plan.amount;
}

/** 把勾選的戶別套用到某個費率方案（一戶只會屬於一個方案），月費跟著方案計算。 */
export function assignPlan(units: Unit[], ids: Set<string>, plan: FeePlan): Unit[] {
  return units.map((u) => (ids.has(u.id) ? { ...u, planId: plan.id, monthlyFee: planFee(plan, u) } : u));
}

/** 修改戶別坪數時，依坪數計費的方案會重新計算月費。 */
export function setUnitArea(units: Unit[], plans: FeePlan[], id: string, area: number | undefined): Unit[] {
  return units.map((u) => {
    if (u.id !== id) return u;
    const plan = plans.find((p) => p.id === u.planId);
    const next = { ...u, area };
    return plan?.basis === 'area' ? { ...next, monthlyFee: planFee(plan, next) } : next;
  });
}

/** 勾選的門牌改用個別金額（脫離方案）。 */
export function assignAmount(units: Unit[], ids: Set<string>, amount: number): Unit[] {
  return units.map((u) => (ids.has(u.id) ? { ...u, planId: undefined, monthlyFee: amount } : u));
}

/** 修改方案金額時，同步更新所有套用該方案的門牌。 */
export function updatePlan(settings: Settings, plan: FeePlan): Pick<Settings, 'feePlans' | 'units'> {
  return {
    feePlans: settings.feePlans.map((p) => (p.id === plan.id ? plan : p)),
    units: settings.units.map((u) => (u.planId === plan.id ? { ...u, monthlyFee: planFee(plan, u) } : u)),
  };
}

/** 刪除方案：原本套用的門牌保留目前金額，改為個別金額。 */
export function removePlan(settings: Settings, planId: string): Pick<Settings, 'feePlans' | 'units'> {
  return {
    feePlans: settings.feePlans.filter((p) => p.id !== planId),
    units: settings.units.map((u) => {
      const next = u.planId === planId ? { ...u, planId: undefined } : u;
      return next.extras?.some((e) => e.planId === planId) ? { ...next, extras: next.extras.filter((e) => e.planId !== planId) } : next;
    }),
  };
}

export type BillField = 'unitNo' | 'owner' | 'billPeriod' | 'item' | 'amount';

export const BILL_FIELD_LABELS: Record<BillField, string> = {
  unitNo: '戶別代碼',
  owner: '區權人／住戶',
  billPeriod: '帳單期別',
  item: '收費項目',
  amount: '應繳金額',
};

export const BILL_REQUIRED: BillField[] = ['unitNo', 'amount'];

export const BILL_ALIASES: Record<BillField, string[]> = {
  unitNo: ['戶別代碼', '戶號', '門牌', '戶別', '住戶編號', '房號', '門號', '單位'],
  owner: ['所有權人姓名', '所有權人', '區權人', '住戶姓名', '姓名', '住戶', '繳款人'],
  billPeriod: ['帳單期別', '期別', '帳單月份', '帳單期間', '計費期間', '收費期間', '費用月份', '月份'],
  item: ['收費項目', '費用項目', '項目', '帳單名稱', '費用名稱'],
  amount: ['應繳金額', '帳單金額', '應收金額', '應繳總額', '繳費金額', '管理費', '金額'],
};

const BILL_EXCLUDE: Partial<Record<BillField, string[]>> = {
  amount: ['實繳', '已繳', '未繳', '手續費', '欠', '餘額', '折扣'],
  owner: ['編號', '戶號'],
  unitNo: ['姓名'],
};

export type BillMapping = Partial<Record<BillField, string>>;

export function billTable(sheetName: string, grid: Grid, headerRow = detectHeaderRow(grid, BILL_ALIASES)): SheetTable {
  return gridToTable(sheetName, grid, headerRow);
}

export const guessBillMapping = (headers: string[], saved: BillMapping = {}) => guessMappingWith(headers, BILL_ALIASES, BILL_EXCLUDE, saved);
