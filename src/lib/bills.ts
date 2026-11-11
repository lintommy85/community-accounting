import { allocateAll, dueFor } from './allocation';
import { addMonths, monthEnd } from './dates';
import { BILL_DEPOSIT, BILL_FINE, billItemName, DueRow, normUnit, PREPAID_BEFORE_ITEM, PRIOR_ITEM, splitAmount } from './dues';
import { activeUnits, cycleMonths, feeItemNames, isCycleStart, mainItemName, mainItemNames, setUnitItemBaseline, unitBaselines } from './fees';
import { AppData, Due, Settings, Unit } from './types';

/** 帳單項目對應：帳單內含逾期（例如「10月未繳管理費」「前期未繳」），不列為應繳，與系統欠款比對。 */
export const BILL_ARREARS = '__arrears__';
/** 帳單項目對應：照帳單金額列為應繳，不與基準比對（例如年繳沖銷、預繳沖銷、委員減免）。 */
export const BILL_ASIS = '__asis__';
/** 帳單項目對應：預繳沖銷（例如年繳沖銷），這個月的應繳由系統已收的預繳款銷帳，不減少應繳。 */
export const BILL_PREPAID = '__prepaid__';
/** 帳單內含逾期在應繳中的紀錄名稱（金額 0，只保留帳單金額）。 */
export const ARREARS_ITEM = '帳單內含逾期';
export const PREPAID_ITEM = '預繳沖銷';
export { PREPAID_BEFORE_ITEM };

export { BILL_DEPOSIT, BILL_FINE, billItemName };

/** 項目名稱寫的月份區間涵蓋幾個月，例如「1~12月管理費」→ 12、「11-1月」→ 3；沒有區間回傳 0。 */
export function itemMonthSpan(item: string): number {
  const m = item.match(/(\d{1,2})\s*[-~～至到]\s*(\d{1,2})\s*月/);
  if (!m) return 0;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a < 1 || a > 12 || b < 1 || b > 12) return 0;
  return ((b - a + 12) % 12) + 1;
}

/** 帳單項目對應目標的說明文字。 */
export const billTargetLabel = (t: string) =>
  t === BILL_ARREARS ? '逾期（帳單內含，不列應繳）'
    : t === BILL_PREPAID ? '沖銷（從這戶的預收款扣除）'
      : t === BILL_ASIS ? '照帳單（減免等，不比對基準）'
        : t === BILL_FINE ? '罰款（不列應繳，記在帳卡）'
          : t === BILL_DEPOSIT ? '裝潢保證金（不列應繳，記在帳卡）'
            : `繳費項目：${t}`;

/** 不列入應繳、繳款另外記在帳卡的對應（罰款、裝潢保證金）。 */
export const isChargeTarget = (t: string | undefined) => t === BILL_FINE || t === BILL_DEPOSIT;

/** 逾期類的帳單項目名稱，例如「逾期汽車清潔費」「10月逾期」「未繳管理費」「前期未繳」：匯入時直接對應到「逾期」。 */
export const isArrearsName = (name: string) => /逾期|未繳|欠繳|欠款|前期/.test(name);

/** 還沒對應的帳單項目的建議：名稱相同的繳費項目、逾期、照帳單；猜不到回傳空字串。 */
export function suggestBillItem(name: string, feeItems: string[]): string {
  if (feeItems.includes(name)) return name;
  if (isArrearsName(name)) return BILL_ARREARS;
  if (/保證金|裝潢押金|裝修押金/.test(name)) return BILL_DEPOSIT;
  if (/罰款|罰金|違約金|違規/.test(name)) return BILL_FINE;
  if (/沖銷|預繳|預收|扣抵/.test(name)) return BILL_PREPAID;
  if (/減免|折讓|減收|退/.test(name)) return BILL_ASIS;
  const loose = (s: string) => s.replace(/位|費|清潔/g, '');
  return feeItems.find((f) => loose(f) && loose(f) === loose(name)) ?? '';
}

/** 帳單項目目前對應到哪裡：已儲存的對應優先；否則名稱和繳費項目相同時自動對應，名稱是逾期類的直接對應到「逾期」。 */
export function resolveBillItem(name: string, settings: Settings): string | undefined {
  const saved = settings.billItemMap?.[name];
  if (saved) return saved;
  if (feeItemNames(settings).includes(name)) return name;
  return isArrearsName(name) ? BILL_ARREARS : undefined;
}

/**
 * 匯入時要不要把帳務起始月往前改：只看帳單月份與一般的每月應繳。
 * 帳單拆出的「前期欠款」（系統啟用前的欠款）、季繳年繳拆出的月份、罰款與裝潢保證金不算，它們不受起始月影響。
 */
export function earlierStartMonth(startSet: string, billMonths: string[], dues: Due[]): string {
  if (!startSet) return '';
  const months = [...billMonths, ...dues.filter((d) => !d.fromBill && d.kind !== 'fine' && d.kind !== 'deposit').map((d) => d.month)];
  const earliest = months.reduce((m, x) => (!m || x < m ? x : m), '');
  return earliest && earliest < startSet ? earliest : '';
}

export type BillFlag = 'noBase' | 'unset' | 'offCycle' | 'span' | 'below' | 'lessArrears' | 'prior';

export interface BillSplit {
  unitNo: string;
  owner: string;
  month: string;
  cycle: number;
  /** 智生活帳單金額合計（含逾期、沖銷）。 */
  bill: number;
  /** 依基準的本期應繳（已套用「更新基準」的選擇）。 */
  base: number;
  /** 沿用之前匯入時的基準（之後調整費率不影響已匯入的月份）。 */
  frozen: boolean;
  /** 帳單內含逾期：逾期項目＋繳費項目超過基準的部分。 */
  carried: number;
  /** 系統在帳單月份之前尚未繳清的欠款。 */
  arrears: number;
  /** 帳單內含、系統卻沒有的欠款，新增為上個月的「前期欠款」。 */
  prior: number;
  /** 預繳沖銷由系統預收款銷帳的金額。 */
  prepaid: number;
  /** 預繳沖銷但系統沒有預收款、照帳單減少應繳的金額。 */
  prepaidBefore: number;
  /** 沖銷前這戶可用的預收款。 */
  prepaidBalance: number;
  /** 帳單沒有沖銷項目，但這戶有多繳／預繳的預收款：匯入後自動拿來銷本期應繳的金額（等同沖銷）。 */
  autoPrepaid: number;
  /** 自動銷帳前這戶的預收款（還沒銷到任何月份的部分）。 */
  autoBalance: number;
  flags: BillFlag[];
}

/** 某戶某繳費項目的帳單金額與基準不同：要選擇是否更新基準。 */
export interface ItemDiff {
  key: string;
  unitNo: string;
  owner: string;
  month: string;
  item: string;
  /** 基準（× 週期月數）。 */
  base: number;
  bill: number;
  cycle: number;
}

export type DiffDecision = 'update' | 'keep';

/** 月繳戶的帳單看起來涵蓋好幾個月（金額是基準的整數倍，或項目寫了月份區間）：要選擇拆成幾個月或只算這個月。 */
export interface SpanCandidate {
  key: string;
  unitNo: string;
  owner: string;
  month: string;
  months: number;
  bill: number;
  /** 每月基準（繳費項目合計）。 */
  monthly: number;
  reason: 'amount' | 'name';
}

export type SpanDecision = 'split' | 'single';

export interface BillPlan {
  /** 帳單上還沒對應到基準費率的項目（去掉月份前綴後的名稱）；有的話不能匯入。 */
  unmapped: string[];
  diffs: ItemDiff[];
  rows: DueRow[];
  splits: BillSplit[];
  billed: Set<string>;
  /** 選擇「更新基準」後的各戶每月基準：戶別 key → 項目 → 每月金額。 */
  baselineUpdates: Map<string, Map<string, number>>;
  /** 看起來跨好幾個月的帳單，選好之前這戶這張帳單不會匯入。 */
  spans: SpanCandidate[];
  /** 選「拆成 N 個月」的戶別：匯入後改成這個繳費週期（從帳單月份起）。 */
  cycleUpdates: Map<string, { cycle: number; start: number }>;
}

/** 帳單月份之前的系統欠款（只看帳單月份前已繳的款項，不含由這個月以後帳單拆出的應繳）。 */
export function arrearsBefore(data: AppData, month: string): Map<string, number> {
  const result = allocateAll({
    ...data,
    dues: data.dues.filter((d) => d.month < month && !(d.fromBill && d.fromBill >= month)),
    payments: data.payments.filter((p) => p.paidDate < `${month}-01`),
  });
  const out = new Map<string, number>();
  for (const acc of result.accounts) {
    let owing = 0;
    for (const m of acc.dueByMonth.keys()) if (m < month) owing += Math.max(0, dueFor(acc, m) - (acc.paidByMonth.get(m) ?? 0));
    out.set(acc.key, owing);
  }
  return out;
}

/** 已匯入過的帳單月份：沿用當時各繳費項目的基準（含季繳／年繳拆出的月份）與週期月數。 */
export function frozenBase(dues: Due[], key: string, month: string): { items: Map<string, number>; cycle: number } | null {
  const mine = dues.filter((d) => normUnit(d.unitNo) === key && d.kind === 'fee');
  const first = mine.filter((d) => d.month === month && !d.fromBill);
  if (!first.length) return null;
  const rest = mine.filter((d) => d.fromBill === month);
  const items = new Map<string, number>();
  for (const d of [...first, ...rest]) if (d.amount) items.set(d.item, (items.get(d.item) ?? 0) + d.amount);
  return { items, cycle: 1 + new Set(rest.map((d) => d.month)).size };
}

/**
 * 匯入每月應繳報表：
 * 1. 每個帳單項目（去掉月份前綴）都要對應到基準費率的繳費項目、逾期或照帳單，否則不能匯入。
 * 2. 繳費項目逐戶逐項與基準比對（已匯入過的月份沿用當時的基準）；不同的列出來，選擇「更新基準」或「不更新」。
 * 3. 本期應繳＝基準（更新後）；逾期項目與超過基準的部分是帳單內含逾期，不重複列為應繳，
 *    先對應系統既有的欠款，多出來的才新增為上個月的「前期欠款」。照帳單的項目原金額列入。
 */
export function planBillImport(
  data: AppData,
  rows: DueRow[],
  opts: { rebase?: boolean; decisions?: Map<string, DiffDecision>; spanDecisions?: Map<string, SpanDecision> } = {},
): BillPlan {
  const { settings } = data;
  const plans = settings.feePlans;
  const empty = (): BillPlan => ({ unmapped: [], diffs: [], rows: [], splits: [], billed: new Set(), baselineUpdates: new Map(), spans: [], cycleUpdates: new Map() });
  const target = new Map<string, string | undefined>();
  for (const r of rows) {
    const name = billItemName(r.item);
    if (!target.has(name)) target.set(name, resolveBillItem(name, settings));
  }
  const unmapped = Array.from(target.entries()).filter(([, t]) => !t).map(([n]) => n);
  if (unmapped.length) return { ...empty(), unmapped };

  const units = new Map(activeUnits(settings.units).map((u) => [normUnit(u.unitNo), u]));
  const mains = mainItemNames(settings);
  const groups = new Map<string, DueRow[]>();
  for (const r of rows) {
    const k = `${normUnit(r.unitNo)}|${r.month}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
  }
  let current: ReturnType<typeof allocateAll> | null = null;
  // 這戶在帳單月底前可用的預收款（含期初預收款），扣掉其他月份的沖銷已經用掉的部分
  const prepaidAvailable = (key: string, month: string) => {
    current ??= allocateAll(data);
    const acc = current.byKey.get(key);
    if (!acc) return 0;
    const end = monthEnd(month);
    const free = acc.free.filter((f) => f.paidDate <= end).reduce((t, f) => t + f.amount, 0);
    const used = Array.from(acc.offsetUsed).filter(([m]) => m !== month).reduce((t, [, v]) => t + v, 0);
    return Math.max(0, free - used);
  };
  const arrearsCache = new Map<string, Map<string, number>>();
  const arrearsOf = (month: string, key: string) => {
    if (!arrearsCache.has(month)) arrearsCache.set(month, arrearsBefore(data, month));
    return arrearsCache.get(month)!.get(key) ?? 0;
  };

  const plan = empty();
  for (const [k, list] of groups) {
    const { unitNo, owner, month } = list[0];
    const key = normUnit(unitNo);
    const unit = units.get(key);
    const frozen = opts.rebase ? null : frozenBase(data.dues, key, month);
    let cycle = frozen?.cycle ?? unit?.cycle ?? 1;
    const split: BillSplit = { unitNo, owner, month, cycle, bill: list.filter((r) => !isChargeTarget(target.get(billItemName(r.item)))).reduce((t, r) => t + r.amount, 0), base: 0, frozen: !!frozen, carried: 0, arrears: 0, prior: 0, prepaid: 0, prepaidBefore: 0, prepaidBalance: 0, autoPrepaid: 0, autoBalance: 0, flags: [] };
    plan.splits.push(split);
    if (!unit) {
      split.flags.push('noBase');
      continue;
    }
    // 罰款、裝潢保證金不列入應繳，只記帳單金額；整張帳單只有這些時，不比對基準也不動這個月的應繳
    const charges = list.filter((r) => isChargeTarget(target.get(billItemName(r.item))));
    for (const r of charges) {
      const kind = target.get(billItemName(r.item)) === BILL_FINE ? 'fine' : 'deposit';
      plan.rows.push({ unitNo, owner, month, item: billItemName(r.item), amount: 0, billAmount: r.amount, kind });
    }
    if (charges.length === list.length) continue;
    if (!frozen && !isCycleStart(unit, month)) {
      split.flags.push('offCycle');
      continue;
    }
    // 這戶還沒設定基準（每月基準 0）：不用帳單金額建立基準，這次不匯入，請先套用方案或輸入個別金額
    if (!frozen && !Array.from(unitBaselines(unit, plans).values()).some((v) => v)) {
      split.flags.push('unset');
      continue;
    }
    if (!frozen && cycle === 1) {
      // 月繳戶的帳單金額剛好是基準的 2、3、6、12 倍，或項目寫了月份區間：可能是一次開好幾個月的帳單
      const monthly = Array.from(unitBaselines(unit, plans).values()).reduce((t, v) => t + v, 0);
      const feeTotal = list.filter((r) => { const t = target.get(billItemName(r.item)); return t !== BILL_ARREARS && t !== BILL_PREPAID && t !== BILL_ASIS && !isChargeTarget(t); }).reduce((t, r) => t + r.amount, 0);
      const byName = Math.max(0, ...list.map((r) => itemMonthSpan(r.item)));
      const byAmount = monthly > 0 && feeTotal > monthly && feeTotal % monthly === 0 ? feeTotal / monthly : 0;
      const n = [byName, byAmount].find((x) => [2, 3, 6, 12].includes(x)) ?? 0;
      if (n) {
        const sk = `${key}|${month}`;
        const choice = opts.spanDecisions?.get(sk);
        plan.spans.push({ key: sk, unitNo, owner, month, months: n, bill: feeTotal, monthly, reason: byName === n ? 'name' : 'amount' });
        if (!choice) {
          split.flags.push('span');
          continue;
        }
        if (choice === 'split') {
          cycle = n;
          split.cycle = n;
          plan.cycleUpdates.set(key, { cycle: n, start: Number(month.slice(5)) });
        }
      }
    }

    const fee = new Map<string, number>();
    const asis = new Map<string, number>();
    let arrearsLines = 0;
    let prepaidLines = 0;
    for (const r of list) {
      const name = billItemName(r.item);
      const t = target.get(name)!;
      if (isChargeTarget(t)) continue;
      if (t === BILL_ARREARS) arrearsLines += r.amount;
      else if (t === BILL_PREPAID) prepaidLines += r.amount;
      else if (t === BILL_ASIS) asis.set(name, (asis.get(name) ?? 0) + r.amount);
      else {
        // 對應到「管理費」或任何主方案名稱，都是這戶的主要費用（用這戶主方案的名稱）
        const item = mains.has(t) ? mainItemName(unit, plans) : t;
        fee.set(item, (fee.get(item) ?? 0) + r.amount);
      }
    }
    const months = cycleMonths(month, cycle);
    const base = frozen?.items ?? new Map(Array.from(unitBaselines(unit, plans)).map(([i, v]) => [i, v * months.length]));
    const effective = new Map<string, number>();
    for (const item of new Set([...fee.keys(), ...base.keys()])) {
      const b = fee.get(item) ?? 0;
      const B = base.get(item) ?? 0;
      let use = B;
      if (b !== B) {
        const dk = `${key}|${month}|${item}`;
        plan.diffs.push({ key: dk, unitNo, owner, month, item, base: B, bill: b, cycle });
        if (opts.decisions?.get(dk) === 'update') {
          use = b;
          const upd = plan.baselineUpdates.get(key) ?? plan.baselineUpdates.set(key, new Map()).get(key)!;
          upd.set(item, Math.round(b / months.length));
        }
      }
      if (use) effective.set(item, use);
    }

    plan.billed.add(k);
    const feeBill = Array.from(fee.values()).reduce((t, v) => t + v, 0);
    split.base = Array.from(effective.values()).reduce((t, v) => t + v, 0);
    // 帳單內含的逾期不會超過帳單合計（例如年繳沖銷後帳單為 0，就沒有逾期）
    split.carried = Math.max(0, Math.min(arrearsLines + Math.max(0, feeBill - split.base), split.bill));
    split.arrears = arrearsOf(month, key);
    if (feeBill < split.base) split.flags.push('below');
    if (split.carried > split.arrears) {
      split.prior = split.carried - split.arrears;
      split.flags.push('prior');
      plan.rows.push({ unitNo, owner, month: addMonths(month, -1), item: PRIOR_ITEM, amount: split.prior, fromBill: month });
    } else if (split.carried < split.arrears) {
      split.flags.push('lessArrears');
    }

    for (const [item, total] of effective) {
      splitAmount(total, months.length).forEach((a, i) => {
        if (i === 0) plan.rows.push({ unitNo, owner, month, item, amount: a, billAmount: fee.get(item) ?? 0, kind: 'fee' });
        else if (a) plan.rows.push({ unitNo, owner, month: months[i], item, amount: a, fromBill: month, kind: 'fee' });
      });
    }
    for (const [item, b] of fee) if (!effective.has(item)) plan.rows.push({ unitNo, owner, month, item, amount: 0, billAmount: b, kind: 'fee' });
    for (const [item, a] of asis) plan.rows.push({ unitNo, owner, month, item, amount: a, billAmount: a, kind: 'asis' });
    if (arrearsLines) plan.rows.push({ unitNo, owner, month, item: ARREARS_ITEM, amount: 0, billAmount: arrearsLines, kind: 'arrears' });
    if (prepaidLines) {
      // 沖銷是負數：有預收款（含期初預收款）的部分由預收款銷帳（應繳不變），沒有的部分照帳單減少應繳；都不超過本期應繳
      const offset = Math.min(-prepaidLines, split.base);
      split.prepaidBalance = prepaidAvailable(key, month);
      split.prepaid = Math.max(0, Math.min(offset, split.prepaidBalance));
      split.prepaidBefore = Math.max(0, offset - split.prepaid);
      if (split.prepaid) plan.rows.push({ unitNo, owner, month, item: PREPAID_ITEM, amount: 0, billAmount: -split.prepaid, kind: 'prepaid' });
      if (split.prepaidBefore) plan.rows.push({ unitNo, owner, month, item: PREPAID_BEFORE_ITEM, amount: -split.prepaidBefore, billAmount: -split.prepaidBefore, kind: 'asis' });
    }
    // 多繳、預繳還沒銷到的預收款（不含等帳單匯入的暫收款）：匯入後會依序銷本期應繳，等同沖銷
    current ??= allocateAll(data);
    const acc = current.byKey.get(key);
    if (acc) {
      const credit = Array.from(acc.creditByPayment).filter(([id, v]) => v > 0 && !acc.pendingCredit.has(id)).reduce((t, [, v]) => t + v, 0);
      const left = Math.max(0, credit - split.prepaid);
      split.autoBalance = left;
      split.autoPrepaid = Math.min(left, Math.max(0, split.base - split.prepaid - split.prepaidBefore));
    }
  }
  return plan;
}

/** 選「拆成 N 個月」的戶別改成對應的繳費週期（從帳單月份起）。 */
export const applyCycleUpdates = (units: Unit[], updates: BillPlan['cycleUpdates']): Unit[] =>
  updates.size ? units.map((u) => { const c = updates.get(normUnit(u.unitNo)); return c && !u.deletedAt ? { ...u, cycle: c.cycle, cycleStart: c.start } : u; }) : units;

/** 套用「更新基準」的選擇到戶別設定（只在匯入時才會改基準）。 */
export function applyBaselineUpdates(settings: Settings, updates: Map<string, Map<string, number>>): Unit[] {
  if (!updates.size) return settings.units;
  return settings.units.map((u) => {
    const upd = updates.get(normUnit(u.unitNo));
    if (!upd || u.deletedAt) return u;
    let next = u;
    for (const [item, monthly] of upd) next = setUnitItemBaseline(next, item, monthly, settings.feePlans);
    return next;
  });
}
