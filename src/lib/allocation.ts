import { addMonths, monthEnd, monthOf, monthRange, parsePeriods } from './dates';
import { unitBaseline } from './fees';
import { ownerAt } from './owners';
import { BILL_DEPOSIT, BILL_FINE, billItemName, normUnit, PREPAID_BEFORE_ITEM, PRIOR_ITEM } from './dues';
import { AppData, ChargeKind, LedgerEntry, Payment, Settings, Unit } from './types';

export { normUnit } from './dues';

/** 期初預收款在銷帳中當成一筆起始月前一天的繳款，id 以此開頭（不在繳費紀錄中）。 */
export const OPENING_PREFIX = 'opening:';
export const isOpeningPayment = (id: string) => id.startsWith(OPENING_PREFIX);

/** 期初預收款的虛擬繳款：起始月前一天繳入，依序銷起始月以後的應繳。 */
export function openingPayment(unit: Unit, startMonth: string): Payment | null {
  if (!unit.openingPrepaid || unit.openingPrepaid <= 0) return null;
  return {
    id: `${OPENING_PREFIX}${unit.id}`, batchId: 'opening', unitNo: unit.unitNo, payerName: '', billPeriod: '', item: '期初預收款',
    paidDate: startMonth ? monthEnd(addMonths(startMonth, -1)) : '0000-01-01', channel: '期初預收款', amount: unit.openingPrepaid, fee: 0,
    reportDepositDate: '', depositDate: '', depositConfirmed: true, txnNo: '', status: '', note: '帳務起始月前已預繳', voided: false,
  };
}

/** 繳的是帳務起始月前的帳單（不銷帳）時的說明文字。 */
export const BEFORE_START_TEXT = '起始月前的帳單，不銷帳';

export type AllocationSource = 'manual' | 'period' | 'offset' | 'auto';

export interface Allocation {
  paymentId: string;
  month: string;
  amount: number;
  source: AllocationSource;
}

export interface UnitAccount {
  unit: Unit;
  key: string;
  dueByMonth: Map<string, number>;
  /** 每月智生活帳單金額（含帳單內含的逾期），用於匯入繳費時比對多繳／少繳。 */
  billByMonth: Map<string, number>;
  /** 季繳、年繳帳單涵蓋的其他月份（依帳單月份）。 */
  cycleByBill: Map<string, string[]>;
  feePayments: Payment[];
  allocations: Allocation[];
  paidByMonth: Map<string, number>;
  creditByPayment: Map<string, number>;
  credit: number;
  /** 帳單上的預繳沖銷金額（依月份）：這些月份的應繳指定從預收款扣除。 */
  offsets: Map<string, number>;
  /** 實際從預收款扣除的沖銷金額（依月份）。 */
  offsetUsed: Map<string, number>;
  /** 匯入時沒有預收款、照帳單減少應繳的沖銷金額（依月份）。 */
  prepaidBefore: Map<string, number>;
  /** 上面這些沖銷之後有了預收款（例如補輸入期初預收款），自動改由預收款沖銷的金額（依月份）。 */
  prepaidBeforeUsed: Map<string, number>;
  /** 依期別銷帳後還沒用掉的款項（預收款，含期初預收款），沖銷就從這裡扣。 */
  free: { paidDate: string; amount: number }[];
  /** 銷不完、而且期別還沒有應繳（等帳單匯入）的款項：列為暫收款；其餘銷不完的是多繳，列為預收款。 */
  pendingCredit: Set<string>;
  /** 期別都在帳務起始月之前、那些月份也沒有應繳的款項：繳的是起始月前的帳單，不銷帳，也不列預收或暫收。 */
  beforeStart: Set<string>;
  /** 帳單上的罰款、裝潢保證金（不列入應繳，只記在帳卡）。 */
  charges: ChargeLine[];
  /** 繳款中付罰款、裝潢保證金的部分。 */
  chargePaid: ChargePayment[];
}

export interface ChargeLine {
  month: string;
  kind: ChargeKind;
  item: string;
  amount: number;
}

export interface ChargePayment {
  paymentId: string;
  month: string;
  kind: ChargeKind;
  amount: number;
}

export interface ChargeAmounts {
  fine: number;
  deposit: number;
}

/** 繳款中付罰款、裝潢保證金的說明文字，例如「罰款 500、裝潢保證金 10,000」；sep 為前面已有其他文字時加頓號。 */
export function chargeText(c: ChargeAmounts, sep = false): string {
  const parts = [c.fine ? `罰款 ${c.fine.toLocaleString('zh-TW')}` : '', c.deposit ? `裝潢保證金 ${c.deposit.toLocaleString('zh-TW')}` : ''].filter(Boolean).join('、');
  return parts ? `${sep ? '、' : ''}${parts}` : '';
}

/** 某筆繳款中付罰款、裝潢保證金的金額。 */
export function chargeAmounts(acc: UnitAccount, paymentId: string): ChargeAmounts {
  const out = { fine: 0, deposit: 0 };
  for (const c of acc.chargePaid) if (c.paymentId === paymentId) out[c.kind] += c.amount;
  return out;
}

export interface ChargeRow {
  month: string;
  kind: ChargeKind;
  item: string;
  /** 帳單金額；沒有帳單（例如手動登錄或入帳報表項目就是保證金）時為 null。 */
  billed: number | null;
  paid: number;
  dates: string[];
}

/** 帳卡上的罰款與裝潢保證金：每張帳單的金額、已繳與繳款日，加上沒有帳單的繳款與手動登錄的保證金。 */
export function unitChargeRows(acc: UnitAccount, entries: LedgerEntry[]): ChargeRow[] {
  const payDate = new Map(acc.feePayments.map((p) => [p.id, p.paidDate]));
  const rows: ChargeRow[] = [];
  const used = new Set<ChargePayment>();
  for (const c of acc.charges) {
    const paidLines = acc.chargePaid.filter((p) => p.month === c.month && p.kind === c.kind && !used.has(p));
    let need = c.amount;
    const mine: ChargePayment[] = [];
    for (const p of paidLines) {
      if (need <= 0) break;
      mine.push(p);
      used.add(p);
      need -= p.amount;
    }
    rows.push({ month: c.month, kind: c.kind, item: c.item, billed: c.amount, paid: mine.reduce((t, p) => t + p.amount, 0), dates: [...new Set(mine.map((p) => payDate.get(p.paymentId) ?? ''))].filter(Boolean) });
  }
  for (const p of acc.chargePaid) {
    if (used.has(p)) continue;
    rows.push({ month: p.month, kind: p.kind, item: p.kind === 'fine' ? '罰款' : '裝潢保證金', billed: null, paid: p.amount, dates: [payDate.get(p.paymentId) ?? ''].filter(Boolean) });
  }
  const key = normUnit(acc.unit.unitNo);
  for (const e of entries) {
    if (e.renovationKind !== 'deposit' || !e.renovationUnit || normUnit(e.renovationUnit) !== key) continue;
    rows.push({ month: e.date.slice(0, 7), kind: 'deposit', item: '裝潢保證金（手動登錄）', billed: null, paid: e.amount, dates: [e.date] });
  }
  return rows.sort((a, b) => a.month.localeCompare(b.month));
}

/** 繳費項目本身對應到罰款或裝潢保證金時（例如入帳報表的項目就是「裝潢保證金」），整筆都是這個款項。 */
export function chargeKindOfItem(item: string, settings: Pick<Settings, 'billItemMap'>): ChargeKind | undefined {
  const t = settings.billItemMap?.[billItemName(item || '')];
  return t === BILL_FINE ? 'fine' : t === BILL_DEPOSIT ? 'deposit' : undefined;
}

export interface AllocationResult {
  startMonth: string;
  /** 設定的帳務起始月（沒有設定時同 startMonth）：期別在這之前、又沒有應繳的款項不銷帳。 */
  trackFrom: string;
  accounts: UnitAccount[];
  byKey: Map<string, UnitAccount>;
  unmatched: Payment[];
  byPayment: Map<string, Allocation[]>;
  /** 每筆繳款中付罰款、裝潢保證金的金額。 */
  chargesByPayment: Map<string, ChargeAmounts>;
}

/** 起始月：設定值優先，否則取最早的應繳或繳費月份。 */
export function billingStart(data: AppData): string {
  // 帳單拆出的前期欠款可能早於起始月，仍要列入銷帳
  const prior = data.dues.reduce((m, d) => (d.fromBill && (!m || d.month < m) ? d.month : m), '');
  const set = data.settings.billingStartMonth;
  if (set) return prior && prior < set ? prior : set;
  let min = '';
  for (const d of data.dues) if (!min || d.month < min) min = d.month;
  for (const p of data.payments) {
    if (p.voided) continue;
    const m = monthOf(p.paidDate);
    if (!min || m < min) min = m;
  }
  return min || monthOf(new Date().toISOString());
}

/** 某戶某月的應繳合計（只來自手動輸入或匯入的應繳紀錄）。 */
export function dueFor(acc: UnitAccount, month: string): number {
  return acc.dueByMonth.get(month) ?? 0;
}

/**
 * 逐月銷帳（應繳只來自「每月應繳」紀錄，不會自動依月費產生）：
 * 1. 手動指定的銷帳照指定月份。
 * 2. 有期別的款項先銷期別內有應繳的月份，多出的金額併入第 3 步。
 * 3. 其餘款項依繳費日先後，從最早未繳清的應繳月份往後銷。
 * 4. 負數款項（退款、減收）先沖抵還沒銷到的款項，再從最近已銷的月份往回沖。
 * 銷不完的金額：期別的應繳還沒匯入的是暫收款，其餘是多繳、列為預收款；之後月份的應繳建立時會自動銷帳。
 * 帳單上的預繳沖銷會在依期別之後、依序銷舊欠之前，指定從預收款扣除。
 */
export function allocateAll(data: AppData): AllocationResult {
  const { settings } = data;
  const startMonth = billingStart(data);
  const trackFrom = settings.billingStartMonth || startMonth;
  const byKey = new Map<string, UnitAccount>();
  for (const unit of settings.units) {
    if (unit.deletedAt) continue;
    const key = normUnit(unit.unitNo);
    if (!key || byKey.has(key)) continue;
    const opening = openingPayment(unit, startMonth);
    byKey.set(key, { unit, key, dueByMonth: new Map(), billByMonth: new Map(), cycleByBill: new Map(), feePayments: opening ? [opening] : [], allocations: [], paidByMonth: new Map(), creditByPayment: new Map(), credit: 0, offsets: new Map(), offsetUsed: new Map(), prepaidBefore: new Map(), prepaidBeforeUsed: new Map(), free: [], pendingCredit: new Set(), beforeStart: new Set(), charges: [], chargePaid: [] });
  }
  for (const d of data.dues) {
    const acc = byKey.get(normUnit(d.unitNo));
    if (!acc) continue;
    if (d.kind === 'fine' || d.kind === 'deposit') {
      // 罰款、保證金不受帳務起始月限制，也不列入應繳；帳單金額照樣算進這個月的帳單（比對繳款金額用）
      acc.charges.push({ month: d.month, kind: d.kind, item: d.item, amount: d.billAmount ?? 0 });
      acc.billByMonth.set(d.month, (acc.billByMonth.get(d.month) ?? 0) + (d.billAmount ?? 0));
      continue;
    }
    if (d.month < startMonth) continue;
    acc.dueByMonth.set(d.month, (acc.dueByMonth.get(d.month) ?? 0) + d.amount);
    if (d.kind === 'prepaid') acc.offsets.set(d.month, (acc.offsets.get(d.month) ?? 0) - (d.billAmount ?? 0));
    if (d.item === PREPAID_BEFORE_ITEM && d.amount < 0) acc.prepaidBefore.set(d.month, (acc.prepaidBefore.get(d.month) ?? 0) - d.amount);
    if (!d.fromBill) acc.billByMonth.set(d.month, (acc.billByMonth.get(d.month) ?? 0) + (d.billAmount ?? d.amount));
    else if (d.item !== PRIOR_ITEM) {
      const list = acc.cycleByBill.get(d.fromBill) ?? acc.cycleByBill.set(d.fromBill, []).get(d.fromBill)!;
      if (!list.includes(d.month)) list.push(d.month);
    }
  }
  const unmatched: Payment[] = [];
  for (const p of data.payments) {
    if (p.voided) continue;
    const acc = byKey.get(normUnit(p.unitNo));
    if (!acc) unmatched.push(p);
    else acc.feePayments.push(p);
  }

  const chargeOf = (p: Payment) => chargeKindOfItem(p.item, settings);
  for (const acc of byKey.values()) allocateUnit(acc, trackFrom, chargeOf);

  const accounts = Array.from(byKey.values()).sort((a, b) => a.unit.unitNo.localeCompare(b.unit.unitNo, 'zh-Hant', { numeric: true }));
  const byPayment = new Map<string, Allocation[]>();
  for (const acc of accounts) for (const a of acc.allocations) (byPayment.get(a.paymentId) ?? byPayment.set(a.paymentId, []).get(a.paymentId)!).push(a);
  const chargesByPayment = new Map<string, ChargeAmounts>();
  for (const acc of accounts) {
    for (const c of acc.chargePaid) {
      const v = chargesByPayment.get(c.paymentId) ?? chargesByPayment.set(c.paymentId, { fine: 0, deposit: 0 }).get(c.paymentId)!;
      v[c.kind] += c.amount;
    }
  }
  return { startMonth, trackFrom, accounts, byKey, unmatched, byPayment, chargesByPayment };
}

/** 期別都在起始月之前、而且那些月份沒有應繳（帳單拆出的前期欠款除外）：繳的是起始月前的帳單。 */
function paysBeforeStart(acc: UnitAccount, p: Payment, trackFrom: string): boolean {
  const periods = parsePeriods(p.billPeriod);
  return periods.length > 0 && periods.every((m) => m < trackFrom && !acc.dueByMonth.has(m));
}

function allocateUnit(acc: UnitAccount, trackFrom: string, chargeOf: (p: Payment) => ChargeKind | undefined = () => undefined) {
  const payments = acc.feePayments.sort((a, b) => a.paidDate.localeCompare(b.paidDate) || a.id.localeCompare(b.id));
  const add = (p: Payment, month: string, amount: number, source: AllocationSource) => {
    if (!amount) return;
    acc.allocations.push({ paymentId: p.id, month, amount, source });
    acc.paidByMonth.set(month, (acc.paidByMonth.get(month) ?? 0) + amount);
  };
  const gap = (m: string) => Math.max(0, dueFor(acc, m) - (acc.paidByMonth.get(m) ?? 0));
  const queue: { p: Payment; remaining: number }[] = [];
  const refunds: Payment[] = [];
  // 罰款、裝潢保證金：繳款先銷期別內的應繳，再付這期帳單上的罰款、保證金；其餘款項銷完應繳後再付還沒繳的
  const chargeOwed = (m: string, kind: ChargeKind) =>
    acc.charges.filter((c) => c.month === m && c.kind === kind).reduce((t, c) => t + c.amount, 0) -
    acc.chargePaid.filter((c) => c.month === m && c.kind === kind).reduce((t, c) => t + c.amount, 0);
  const payCharges = (p: Payment, months: string[], remaining: number) => {
    for (const m of [...new Set(months)].sort()) {
      for (const kind of ['fine', 'deposit'] as const) {
        const a = Math.min(remaining, Math.max(0, chargeOwed(m, kind)));
        if (a > 0) {
          acc.chargePaid.push({ paymentId: p.id, month: m, kind, amount: a });
          remaining -= a;
        }
      }
    }
    return remaining;
  };

  for (const p of payments) {
    const whole = p.amount > 0 && !p.allocations && !isOpeningPayment(p.id) ? chargeOf(p) : undefined;
    if (whole) {
      acc.chargePaid.push({ paymentId: p.id, month: parsePeriods(p.billPeriod)[0] ?? monthOf(p.paidDate), kind: whole, amount: p.amount });
      continue;
    }
    if (p.allocations) {
      for (const a of p.allocations) add(p, a.month, a.amount, 'manual');
      const rest = p.amount - p.allocations.reduce((s, a) => s + a.amount, 0);
      if (rest) acc.creditByPayment.set(p.id, rest);
      continue;
    }
    if (paysBeforeStart(acc, p, trackFrom)) {
      acc.beforeStart.add(p.id);
      continue;
    }
    if (p.amount < 0) {
      refunds.push(p);
      continue;
    }
    let remaining = p.amount;
    // 季繳、年繳的帳單：期別只寫帳單月份時，整個週期都算本期
    const periods = parsePeriods(p.billPeriod);
    for (const m of Array.from(new Set(periods.flatMap((x) => [x, ...(acc.cycleByBill.get(x) ?? []).sort()])))) {
      const a = Math.min(gap(m), remaining);
      add(p, m, a, 'period');
      remaining -= a;
    }
    if (remaining > 0 && acc.charges.length) remaining = payCharges(p, periods, remaining);
    if (remaining > 0) queue.push({ p, remaining });
  }

  // 帳單上的預繳沖銷：指定從這戶的預收款扣除（只用該月底前繳的款項），優先於依序銷舊欠
  acc.free = queue.map((q) => ({ paidDate: q.p.paidDate, amount: q.remaining }));
  // 沖銷只用該月底前繳的款項；改回由預收款沖銷時只用該月之前就繳的（當月繳的是繳這期帳單）
  const useFree = (m: string, amount: number, until = monthEnd(m)) => {
    let need = amount;
    for (const q of queue) {
      if (need <= 0) break;
      if (q.remaining <= 0 || q.p.paidDate > until) continue;
      const a = Math.min(q.remaining, need);
      add(q.p, m, a, 'offset');
      acc.offsetUsed.set(m, (acc.offsetUsed.get(m) ?? 0) + a);
      q.remaining -= a;
      need -= a;
    }
  };
  const freeBefore = (m: string) => queue.reduce((t, q) => t + (q.p.paidDate < `${m}-01` ? q.remaining : 0), 0);
  for (const m of Array.from(new Set([...acc.offsets.keys(), ...acc.prepaidBefore.keys()])).sort()) {
    useFree(m, Math.min(acc.offsets.get(m) ?? 0, gap(m)));
    // 匯入時沒有預收款而減少應繳的沖銷：現在有預收款（例如補輸入期初預收款）就改由預收款沖銷，應繳恢復原額
    const back = Math.min(acc.prepaidBefore.get(m) ?? 0, freeBefore(m));
    if (back > 0) {
      acc.dueByMonth.set(m, (acc.dueByMonth.get(m) ?? 0) + back);
      acc.prepaidBeforeUsed.set(m, back);
      useFree(m, back, monthEnd(addMonths(m, -1)));
    }
  }
  const dueMonths = Array.from(acc.dueByMonth.keys()).filter((m) => dueFor(acc, m) > 0).sort();

  for (const q of queue) {
    for (const m of dueMonths) {
      if (q.remaining <= 0) break;
      const a = Math.min(gap(m), q.remaining);
      add(q.p, m, a, 'auto');
      q.remaining -= a;
    }
    if (q.remaining > 0 && acc.charges.length && !isOpeningPayment(q.p.id)) q.remaining = payCharges(q.p, acc.charges.map((c) => c.month), q.remaining);
    if (q.remaining > 0) acc.creditByPayment.set(q.p.id, (acc.creditByPayment.get(q.p.id) ?? 0) + q.remaining);
  }

  for (const r of refunds) {
    let remaining = -r.amount;
    const credit = Array.from(acc.creditByPayment.values()).reduce((s, v) => s + v, 0);
    const fromCredit = Math.min(Math.max(0, credit), remaining);
    if (fromCredit) acc.creditByPayment.set(r.id, -fromCredit);
    remaining -= fromCredit;
    const periods = parsePeriods(r.billPeriod);
    const months = (periods.length ? periods : Array.from(acc.paidByMonth.keys())).sort().reverse();
    for (const m of months) {
      if (remaining <= 0) break;
      const a = Math.min(Math.max(0, acc.paidByMonth.get(m) ?? 0), remaining);
      add(r, m, -a, periods.length ? 'period' : 'auto');
      remaining -= a;
    }
    if (remaining > 0) acc.creditByPayment.set(r.id, (acc.creditByPayment.get(r.id) ?? 0) - remaining);
  }

  acc.allocations.sort((a, b) => a.month.localeCompare(b.month));
  acc.credit = Array.from(acc.creditByPayment.values()).reduce((s, v) => s + v, 0);
  for (const [id, v] of acc.creditByPayment) {
    const p = payments.find((x) => x.id === id);
    if (v > 0 && p && !isOpeningPayment(id)) {
      const periods = parsePeriods(p.billPeriod);
      if ((periods.length ? periods : [monthOf(p.paidDate)]).some((m) => !acc.dueByMonth.has(m))) acc.pendingCredit.add(id);
    }
  }
}

export interface UnitSummary {
  account: UnitAccount;
  due: number;
  paid: number;
  owing: number;
  owingMonths: string[];
  prepaid: number;
  received: number;
  lastPaidDate: string;
  paidThrough: string;
}

/** 單戶在期間內的應繳／已銷帳／未繳，以及期末之後的預繳與實際繳款合計。 */
export function summarizeUnit(acc: UnitAccount, from: string, to: string): UnitSummary {
  let due = 0;
  let paid = 0;
  let owing = 0;
  const owingMonths: string[] = [];
  for (const m of monthRange(from, to)) {
    const d = dueFor(acc, m);
    const p = acc.paidByMonth.get(m) ?? 0;
    due += d;
    paid += p;
    if (p < d) {
      owing += d - p;
      owingMonths.push(m);
    }
  }
  const end = monthEnd(to);
  const prepaid = acc.allocations.filter((a) => a.month > to).reduce((s, a) => s + a.amount, 0) + acc.credit;
  const real = acc.feePayments.filter((p) => !isOpeningPayment(p.id));
  const received = real.filter((p) => p.paidDate >= `${from}-01` && p.paidDate <= end).reduce((s, p) => s + p.amount, 0);
  const lastPaidDate = real.reduce((m, p) => (p.amount > 0 && p.paidDate > m ? p.paidDate : m), '');
  let paidThrough = '';
  for (const m of Array.from(acc.dueByMonth.keys()).sort()) {
    if ((acc.paidByMonth.get(m) ?? 0) < dueFor(acc, m)) break;
    paidThrough = m;
  }
  return { account: acc, due, paid, owing, owingMonths, prepaid, received, lastPaidDate, paidThrough };
}

export interface AdvanceBalances {
  /** 預收款：截至月底已繳、銷帳月份在該月之後，或多繳還沒銷到的金額（含期初預收款）。 */
  prepaid: number;
  /** 暫收款：截至月底已繳，但期別的每月應繳還沒匯入、尚無應繳可以銷帳的金額。 */
  suspense: number;
}

/** 單戶在某月底的預收款與暫收款；skip 的款項（例如撥款尚未核對）不計。 */
export function unitAdvances(acc: UnitAccount, month: string, skip: Set<string> = new Set()): AdvanceBalances {
  const end = monthEnd(month);
  const paidBy = new Map(acc.feePayments.map((p) => [p.id, p.paidDate]));
  const counted = (id: string) => !skip.has(id) && (paidBy.get(id) ?? '') <= end;
  let prepaid = 0;
  let suspense = 0;
  for (const a of acc.allocations) if (a.month > month && counted(a.paymentId)) prepaid += a.amount;
  // 多繳、期初預收款還沒銷到的部分是預收款；期別還沒有應繳（等帳單匯入）的才是暫收款
  for (const [id, v] of acc.creditByPayment) {
    if (!counted(id)) continue;
    if (acc.pendingCredit.has(id)) suspense += v;
    else prepaid += v;
  }
  return { prepaid, suspense };
}

export function advancesFromAllocations(result: AllocationResult, payments: Payment[], month: string, opts: { confirmedOnly?: boolean } = {}): AdvanceBalances {
  const skip = new Set(opts.confirmedOnly ? payments.filter((p) => !p.depositConfirmed).map((p) => p.id) : []);
  let prepaid = 0;
  let suspense = 0;
  for (const acc of result.accounts) {
    const a = unitAdvances(acc, month, skip);
    prepaid += a.prepaid;
    suspense += a.suspense;
  }
  return { prepaid: Math.round(prepaid), suspense: Math.round(suspense) };
}

/** 依戶別從繳費紀錄找出尚未建立的戶別。 */
export function unitNosFromPayments(payments: Payment[], existing: Unit[]): string[] {
  const known = new Set(existing.map((u) => normUnit(u.unitNo)));
  const out = new Map<string, string>();
  for (const p of payments) {
    const k = normUnit(p.unitNo);
    if (k && !known.has(k) && !out.has(k)) out.set(k, p.unitNo.trim());
  }
  return Array.from(out.values()).sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
}

export interface ReceiptBreakdown {
  current: number;
  prepaid: number;
  arrears: number;
  credit: number;
  unmatched: number;
}

/**
 * 期間內收到的管理費（全額列入當期收入），依銷帳月份拆成：
 * 當期銷帳、預收（銷以後月份或多繳）、補繳（銷以前月份，含帳務起始月前的帳單）、暫收（期別的應繳還沒匯入）、未對應戶別。
 */
export function receiptBreakdown(
  result: AllocationResult,
  payments: Payment[],
  start: string,
  end: string,
  dateOf: (p: Payment) => string = (p) => p.paidDate,
): ReceiptBreakdown {
  const out: ReceiptBreakdown = { current: 0, prepaid: 0, arrears: 0, credit: 0, unmatched: 0 };
  for (const b of receiptBreakdownBy(result, payments, start, end, () => '', dateOf).values()) {
    for (const k of Object.keys(out) as (keyof ReceiptBreakdown)[]) out[k] += b[k];
  }
  return out;
}

/** 同 receiptBreakdown，但依 keyOf（例如收費項目）分組。 */
export function receiptBreakdownBy(
  result: AllocationResult,
  payments: Payment[],
  start: string,
  end: string,
  keyOf: (p: Payment) => string,
  dateOf: (p: Payment) => string = (p) => p.paidDate,
): Map<string, ReceiptBreakdown> {
  const groups = new Map<string, ReceiptBreakdown>();
  const startMonth = start.slice(0, 7);
  const endMonth = end.slice(0, 7);
  for (const p of payments) {
    const d = dateOf(p);
    if (p.voided || d < start || d > end) continue;
    const key = keyOf(p);
    const out = groups.get(key) ?? groups.set(key, { current: 0, prepaid: 0, arrears: 0, credit: 0, unmatched: 0 }).get(key)!;
    const acc = result.byKey.get(normUnit(p.unitNo));
    if (!acc) {
      out.unmatched += p.amount;
      continue;
    }
    if (acc.beforeStart.has(p.id)) {
      // 起始月前的帳單：期別早於報表期間才算補繳以前月份，當月繳當月的帳單算當期
      const periods = parsePeriods(p.billPeriod);
      if (periods.length && periods.every((m) => m < startMonth)) out.arrears += p.amount;
      else out.current += p.amount;
      continue;
    }
    for (const a of result.byPayment.get(p.id) ?? []) {
      if (a.month < startMonth) out.arrears += a.amount;
      else if (a.month > endMonth) out.prepaid += a.amount;
      else out.current += a.amount;
    }
    const credit = acc.creditByPayment.get(p.id) ?? 0;
    if (acc.pendingCredit.has(p.id)) out.credit += credit;
    else out.prepaid += credit;
  }
  return groups;
}

export interface MonthWriteOff {
  month: string;
  units: number;
  due: number;
  /** 應收中智生活帳單本身要繳的部分（應收扣掉帳單上的預繳沖銷）與戶數；每戶只算在一行，帳單還有要繳的就算在這裡。 */
  billDue: number;
  billUnits: number;
  /** 帳單上的預繳沖銷（含期初預收款），由預收款銷帳；帳單已扣掉，但仍算在應收裡。 */
  offset: number;
  offsetUnits: number;
  /** 有預繳沖銷、但帳單還有要繳而算在帳單本月應繳的戶數。 */
  offsetShared: number;
  /** 帳單上的預繳沖銷沒有預收款可以扣、照帳單減少應繳的金額與戶數：算在應收，也算在已銷帳。 */
  billOffset: number;
  billOffsetUnits: number;
  /** 照帳單扣除沖銷、但戶數已算在前面兩行的戶數。 */
  billOffsetShared: number;
  writtenOff: number;
  fromPrepaid: number;
  fromCurrent: number;
  fromLater: number;
  owing: number;
  owingUnits: number;
}

export interface UnitWriteOff {
  unitNo: string;
  owner: string;
  due: number;
  /** 帳單上的預繳沖銷由預收款銷帳的金額。 */
  offset: number;
  /** 帳單上的預繳沖銷沒有預收款可以扣、照帳單減少應繳的金額（不含在 due 裡）。 */
  billOffset: number;
  writtenOff: number;
  fromPrepaid: number;
  fromCurrent: number;
  fromLater: number;
  owing: number;
}

/** 某月份各戶的管理費銷帳：應繳、已銷（依款項繳費時間分來源）、未繳；沒有應繳也沒有銷帳的戶略過。 */
export function monthWriteOffByUnit(result: AllocationResult, payments: Payment[], month: string): UnitWriteOff[] {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const paidDate = new Map(payments.map((p) => [p.id, p.paidDate]));
  const rows: UnitWriteOff[] = [];
  for (const acc of result.accounts) {
    const row: UnitWriteOff = { unitNo: acc.unit.unitNo, owner: ownerAt(acc.unit, month), due: dueFor(acc, month), offset: Math.min(dueFor(acc, month), acc.offsetUsed.get(month) ?? 0), billOffset: Math.max(0, (acc.prepaidBefore.get(month) ?? 0) - (acc.prepaidBeforeUsed.get(month) ?? 0)), writtenOff: 0, fromPrepaid: 0, fromCurrent: 0, fromLater: 0, owing: 0 };
    for (const a of acc.allocations) {
      if (a.month !== month) continue;
      row.writtenOff += a.amount;
      const d = paidDate.get(a.paymentId) ?? '';
      if (d < start) row.fromPrepaid += a.amount;
      else if (d > end) row.fromLater += a.amount;
      else row.fromCurrent += a.amount;
    }
    row.owing = Math.max(0, row.due - row.writtenOff);
    if (row.due || row.writtenOff || row.billOffset) rows.push(row);
  }
  return rows;
}

/** 某月份的管理費銷帳彙總；應收依智生活帳單列出，帳單上沒有預收款、照帳單扣除的沖銷同時算在應收與已銷帳。 */
export function monthWriteOff(result: AllocationResult, payments: Payment[], month: string): MonthWriteOff {
  const out: MonthWriteOff = { month, units: 0, due: 0, billDue: 0, billUnits: 0, offset: 0, offsetUnits: 0, offsetShared: 0, billOffset: 0, billOffsetUnits: 0, billOffsetShared: 0, writtenOff: 0, fromPrepaid: 0, fromCurrent: 0, fromLater: 0, owing: 0, owingUnits: 0 };
  for (const r of monthWriteOffByUnit(result, payments, month)) {
    if (r.due || r.billOffset) out.units++;
    out.due += r.due + r.billOffset;
    const billing = r.due - r.offset > 0;
    if (billing) out.billUnits++;
    out.billDue += r.due - r.offset;
    if (r.offset > 0) {
      if (billing) out.offsetShared++;
      else out.offsetUnits++;
    }
    out.offset += r.offset;
    if (r.billOffset) {
      if (billing || r.offset > 0) out.billOffsetShared++;
      else out.billOffsetUnits++;
    }
    out.billOffset += r.billOffset;
    out.writtenOff += r.writtenOff + r.billOffset;
    out.fromPrepaid += r.fromPrepaid;
    out.fromCurrent += r.fromCurrent;
    out.fromLater += r.fromLater;
    out.owing += r.owing;
    if (r.owing) out.owingUnits++;
  }
  return out;
}

/** 帳卡要顯示的月份：從最早的應繳／銷帳月份到最晚（至少到本月）。 */
export function cardMonths(acc: UnitAccount, current: string): string[] {
  const all = [...acc.dueByMonth.keys(), ...acc.allocations.map((a) => a.month)].sort();
  if (!all.length) return [];
  const last = all[all.length - 1] > current ? all[all.length - 1] : current;
  return monthRange(all[0], last);
}

export interface AmountCheck {
  payment: Payment;
  account: UnitAccount;
  months: string[];
  /** 這筆繳費還應該繳多少：帳單金額扣掉同期其他繳費（已匯入的與這次較早的）。 */
  expected: number;
  diff: number;
  /** 這期的帳單金額（或依基準估算）。 */
  bill: number;
  /** 同一戶同期別的其他繳費：已匯入的筆數加上這次較早的筆數與金額。 */
  others: { count: number; amount: number };
  /** 這些月份還沒匯入每月應繳，帳單金額是依基準估算。 */
  estimated?: boolean;
  /** 金額剛好等於上個月（例如費率調整前）尚未繳清的帳單：要手動選擇銷上個月還是這個月。 */
  prev?: { month: string; bill: number };
}

/**
 * 匯入時檢查：同一戶同期別（帳單期別；沒有期別時為繳費月份）的新款項合計與帳單金額不同時，標出多繳或少繳的那幾筆。
 * 帳單金額是本期應繳＋帳單內含逾期，先扣掉已匯入的繳費（含預收款銷到這期的部分）；沒有建立應繳時以戶別基準比較；兩者都沒有就無法判斷，略過。
 * 分好幾筆繳、合計剛好等於帳單的不用確認；合計不同時，只標出讓合計超過帳單的那幾筆，或少繳時的最後一筆。
 * 金額等於上個月未繳清的帳單時（跨月在途、費率調整前的帳），一併標出讓使用者選擇要銷哪個月。
 */
export function findAmountMismatches(data: AppData, paymentIds: Set<string>): AmountCheck[] {
  const result = allocateAll({ ...data, payments: data.payments.filter((p) => !paymentIds.has(p.id)) });
  const monthsOf = (p: Payment) => {
    const periods = parsePeriods(p.billPeriod);
    return periods.length ? periods : [monthOf(p.paidDate)];
  };
  const groupKey = (p: Payment) => `${normUnit(p.unitNo)}|${monthsOf(p).join(',')}`;
  const groups = new Map<string, Payment[]>();
  for (const p of data.payments) {
    if (!paymentIds.has(p.id) || p.voided || p.allocations || p.amount <= 0 || chargeKindOfItem(p.item, data.settings)) continue;
    (groups.get(groupKey(p)) ?? groups.set(groupKey(p), []).get(groupKey(p))!).push(p);
  }
  const out: AmountCheck[] = [];
  for (const [key, list] of groups) {
    const account = result.byKey.get(normUnit(list[0].unitNo));
    if (!account) continue;
    const months = monthsOf(list[0]);
    // 起始月前的帳單不銷帳，也不用比對金額
    if (months.every((m) => m < result.trackFrom && !account.dueByMonth.has(m)) && parsePeriods(list[0].billPeriod).length) continue;
    // 有匯入帳單就用帳單金額（年繳沖銷後可能是 0）；沒有帳單才用基準估算
    const billed = months.some((m) => account.billByMonth.has(m));
    const bill = billed ? months.reduce((s, m) => s + (account.billByMonth.get(m) ?? 0), 0) : unitBaseline(account.unit, data.settings.feePlans) * months.length;
    if (!billed && !bill) continue;
    const already = months.reduce((s, m) => s + (account.paidByMonth.get(m) ?? 0), 0) + account.chargePaid.filter((c) => months.includes(c.month)).reduce((s, c) => s + c.amount, 0);
    const existing = data.payments.filter((x) => !paymentIds.has(x.id) && !x.voided && groupKey(x) === key).length;
    const remaining = Math.max(0, bill - already);
    list.sort((a, b) => a.paidDate.localeCompare(b.paidDate) || a.id.localeCompare(b.id));
    if (list.reduce((t, p) => t + p.amount, 0) === remaining) continue;
    let before = 0;
    list.forEach((p, i) => {
      const expected = Math.max(0, remaining - before);
      const over = before + p.amount > remaining;
      if ((over || i === list.length - 1) && p.amount !== expected) {
        const pm = addMonths(months[0], -1);
        const prevBill = account.billByMonth.get(pm) ?? 0;
        const prevOpen = Math.max(0, dueFor(account, pm) - (account.paidByMonth.get(pm) ?? 0));
        const prev = prevBill && prevOpen && (p.amount === prevBill || p.amount === prevOpen) ? { month: pm, bill: prevBill } : undefined;
        out.push({ payment: p, account, months, expected, diff: p.amount - expected, bill, others: { count: existing + i, amount: already + before }, estimated: !billed, prev });
      }
      before += p.amount;
    });
  }
  return out.sort((a, b) => a.account.unit.unitNo.localeCompare(b.account.unit.unitNo, 'zh-Hant', { numeric: true }) || a.payment.paidDate.localeCompare(b.payment.paidDate));
}

export interface PrepaidRow {
  unitNo: string;
  owner: string;
  /** 上月底預收款。 */
  opening: number;
  /** 本月新增：本月繳費中預繳以後月份或多繳的部分。 */
  added: number;
  /** 本月沖銷：以前繳的預收款銷到本月的金額。 */
  used: number;
  closing: number;
}

export interface PrepaidUse {
  unitNo: string;
  owner: string;
  payment: Payment;
  source: AllocationSource;
  amount: number;
}

/** 某月份的預收款增減（逐戶）與本月沖銷明細：上月底＋本月新增－本月沖銷＝月底。 */
export function prepaidLedger(result: AllocationResult, month: string): { rows: PrepaidRow[]; uses: PrepaidUse[] } {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const prev = addMonths(month, -1);
  const rows: PrepaidRow[] = [];
  const uses: PrepaidUse[] = [];
  for (const acc of result.accounts) {
    const owner = ownerAt(acc.unit, month);
    const byId = new Map(acc.feePayments.map((p) => [p.id, p]));
    const opening = unitAdvances(acc, prev).prepaid;
    const closing = unitAdvances(acc, month).prepaid;
    let added = 0;
    for (const p of acc.feePayments) {
      if (p.paidDate < start || p.paidDate > end) continue;
      added += acc.allocations.filter((a) => a.paymentId === p.id && a.month > month).reduce((t, a) => t + a.amount, 0);
      if (!acc.pendingCredit.has(p.id)) added += acc.creditByPayment.get(p.id) ?? 0;
    }
    for (const a of acc.allocations) {
      const p = byId.get(a.paymentId);
      if (a.month === month && p && p.paidDate < start) uses.push({ unitNo: acc.unit.unitNo, owner, payment: p, source: a.source, amount: a.amount });
    }
    if (opening || added || closing) rows.push({ unitNo: acc.unit.unitNo, owner, opening, added, used: opening + added - closing, closing });
  }
  return { rows, uses };
}

export interface PaidLine {
  payment: Payment;
  owner: string;
  allocations: Allocation[];
  credit: number;
  /** 銷不完的部分是暫收款（應繳還沒匯入）；否則是多繳，列為預收款。 */
  pending: boolean;
  /** 繳的是帳務起始月前的帳單，不銷帳。 */
  beforeStart: boolean;
  /** 這筆繳款中付罰款、裝潢保證金的金額。 */
  charges: ChargeAmounts;
}

/** 某月份的繳費紀錄（已繳清單）：每筆繳費與它銷到哪些月份。 */
export function paidListForMonth(result: AllocationResult, payments: Payment[], month: string): PaidLine[] {
  return payments
    .filter((p) => !p.voided && p.paidDate.startsWith(month))
    .map((p) => {
      const acc = result.byKey.get(normUnit(p.unitNo));
      return { payment: p, owner: (acc && ownerAt(acc.unit, month)) || p.payerName, allocations: result.byPayment.get(p.id) ?? [], credit: acc?.creditByPayment.get(p.id) ?? 0, pending: !acc || acc.pendingCredit.has(p.id), beforeStart: !!acc?.beforeStart.has(p.id), charges: result.chargesByPayment.get(p.id) ?? { fine: 0, deposit: 0 } };
    })
    .sort((a, b) => a.payment.unitNo.localeCompare(b.payment.unitNo, 'zh-Hant', { numeric: true }) || a.payment.paidDate.localeCompare(b.payment.paidDate));
}

export interface UnpaidLine {
  unitNo: string;
  owner: string;
  month: string;
  due: number;
  paid: number;
  owing: number;
}

/** 截至某月份（含）每戶每個月尚未繳清的應繳，逐月分開列出，不合併。 */
export function unpaidByMonth(result: AllocationResult, uptoMonth: string): UnpaidLine[] {
  const out: UnpaidLine[] = [];
  for (const acc of result.accounts) {
    for (const month of Array.from(acc.dueByMonth.keys()).sort()) {
      if (month > uptoMonth) continue;
      const due = dueFor(acc, month);
      const paid = acc.paidByMonth.get(month) ?? 0;
      if (paid < due) out.push({ unitNo: acc.unit.unitNo, owner: ownerAt(acc.unit, month), month, due, paid, owing: due - paid });
    }
  }
  return out;
}
