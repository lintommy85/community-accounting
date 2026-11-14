import { AllocationResult, dueFor, isOpeningPayment } from './allocation';
import { BILL_ARREARS, BILL_ASIS, BILL_DEPOSIT, BILL_FINE, BILL_PREPAID } from './bills';
import { addMonths, monthEnd } from './dates';
import { normUnit } from './dues';
import { activeUnits, feeItemNames, unitBaseline } from './fees';
import { AppData, Payment, Settings } from './types';

/** 月報兩個區塊的預設欄位名稱；pp 開頭是預收款項變動，ar 開頭是應收（未繳）管理費變動。 */
export const REPORT_LABEL_DEFAULTS = {
  ppTitle: '預收款項變動',
  ppRow: '預收款',
  ppOpening: '月初預收款',
  ppUsed: '本月沖銷',
  ppAdded: '本期新增預收',
  ppClosing: '目前預收金額',
  arTitle: '應收（未繳）管理費變動',
  arPrior: '前期未繳',
  arTransitIn: '截至本月入帳的在途款項',
  arBaseline: '本月應收（基準費率加總）',
  arPrepaidUsed: '本月預收款沖銷',
  arWrittenOff: '本月已銷帳',
  arUnapplied: '本月繳款中的預收、暫收',
  arTransitOut: '截至目前的在途款',
  arResult: '本月應收（未繳）管理費累計',
} as const;

export type ReportLabelKey = keyof typeof REPORT_LABEL_DEFAULTS;

/** 月報欄位名稱：基本設定改過的用改過的，空白用預設名稱。 */
export function reportLabels(settings: Settings): Record<ReportLabelKey, string> {
  const custom = settings.reportFields?.labels ?? {};
  const out = { ...REPORT_LABEL_DEFAULTS } as Record<ReportLabelKey, string>;
  for (const k of Object.keys(out) as ReportLabelKey[]) if (custom[k]?.trim()) out[k] = custom[k].trim();
  return out;
}

/** 可以選為「可選的帳單項目」的帳單項目：帳單項目對應裡的項目，不含沖銷類（已算在本月預收款沖銷）與逾期類（已算在前期未繳）。 */
export function optionalItemChoices(settings: Settings): string[] {
  const map = settings.billItemMap ?? {};
  const names = [...Object.keys(map), ...feeItemNames(settings).filter((f) => !(f in map))];
  return names.filter((n) => map[n] !== BILL_PREPAID && map[n] !== BILL_ARREARS);
}

/** 可選的帳單項目在某月所有帳單上的金額合計（取絕對值）；只算目前有帳卡的戶別。 */
export function optionalItemAmount(data: AppData, result: AllocationResult, bill: string, month: string): number {
  const target = data.settings.billItemMap?.[bill] ?? bill;
  if (target === BILL_PREPAID || target === BILL_ARREARS) return 0;
  const special = target === BILL_ASIS || target === BILL_FINE || target === BILL_DEPOSIT;
  const sum = data.dues
    .filter((d) => d.month === month && result.byKey.has(normUnit(d.unitNo)))
    .filter((d) => (special ? d.item === bill && (d.kind === 'asis' || d.kind === 'fine' || d.kind === 'deposit') : d.item === target && (!d.kind || d.kind === 'fee')))
    .reduce((t, d) => t + (d.billAmount ?? d.amount), 0);
  return Math.abs(Math.round(sum));
}

/** 某月底時所有戶別帳卡的欠費合計：截至該月的應繳，扣掉該月底以前繳的款項銷到的金額（之後才補繳的仍算欠費）。 */
export function owingAt(result: AllocationResult, month: string): { amount: number; units: number } {
  const end = monthEnd(month);
  let amount = 0;
  let units = 0;
  for (const acc of result.accounts) {
    const paidDate = new Map(acc.feePayments.map((p) => [p.id, p.paidDate]));
    const paid = new Map<string, number>();
    for (const a of acc.allocations) if (a.month <= month && (paidDate.get(a.paymentId) ?? '') <= end) paid.set(a.month, (paid.get(a.month) ?? 0) + a.amount);
    let owing = 0;
    for (const m of acc.dueByMonth.keys()) if (m <= month) owing += Math.max(0, dueFor(acc, m) - (paid.get(m) ?? 0));
    if (owing > 0) {
      amount += owing;
      units++;
    }
  }
  return { amount: Math.round(amount), units };
}

export interface ReceivableLine {
  key: ReportLabelKey | 'item';
  label: string;
  /** 1 加、-1 減、0 是第一行（前期未繳）或結果。 */
  sign: 1 | -1 | 0;
  amount: number;
}

export interface ReceivableRollForward {
  lines: ReceivableLine[];
  result: number;
  /** 本月應收（基準費率加總）。 */
  baseline: number;
  /** 帳卡上本月的應收合計，用來說明和基準費率加總的差額。 */
  due: number;
  /** 月底時所有戶別帳卡的欠費合計與戶數，用來核對結果。 */
  owing: number;
  owingUnits: number;
}

/**
 * 應收（未繳）管理費變動：
 * 前期未繳＋截至本月入帳的在途款項＋本月應收（基準費率加總）－本月預收款沖銷－本月已銷帳＋本月繳款中的預收、暫收－可選的帳單項目－截至目前的在途款＝本月應收（未繳）管理費累計。
 * 金額都只算管理費（不含罰款、裝潢保證金）：本月已銷帳是本月入帳的款項；在途款項是入帳和繳費不在同一個月的款項；
 * 本月繳款中沒有銷到本月以前應繳的部分（預繳以後月份、多繳、暫收、未對應門牌、起始月前的帳單）加回來。
 * 可選的帳單項目補足基準費率加總和帳卡應收的差額時，結果等於月底時帳卡的欠費合計。
 */
export function receivableRollForward(data: AppData, result: AllocationResult, month: string): ReceivableRollForward {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const inMonth = (d: string) => !!d && d >= start && d <= end;
  const feeOf = (p: Payment) => {
    const c = result.chargesByPayment.get(p.id);
    return p.amount - (c?.fine ?? 0) - (c?.deposit ?? 0);
  };
  let writtenOff = 0;
  let transitIn = 0;
  let transitOut = 0;
  let paidInMonth = 0;
  for (const p of data.payments) {
    if (p.voided) continue;
    const fee = feeOf(p);
    const paid = inMonth(p.paidDate);
    const deposited = inMonth(p.depositDate);
    if (deposited) writtenOff += fee;
    if (deposited && !paid) transitIn += fee;
    if (paid && !deposited) transitOut += fee;
    if (paid) paidInMonth += fee;
  }
  let applied = 0;
  let prepaidUsed = 0;
  let due = 0;
  for (const acc of result.accounts) {
    due += dueFor(acc, month);
    const paidDate = new Map(acc.feePayments.map((p) => [p.id, p.paidDate]));
    for (const a of acc.allocations) {
      const d = paidDate.get(a.paymentId) ?? '';
      if (a.month === month && d < start) prepaidUsed += a.amount;
      else if (a.month <= month && inMonth(d) && !isOpeningPayment(a.paymentId)) applied += a.amount;
    }
  }
  const { settings } = data;
  const L = reportLabels(settings);
  const prior = owingAt(result, addMonths(month, -1)).amount;
  const baseline = activeUnits(settings.units).reduce((t, u) => t + unitBaseline(u, settings.feePlans), 0);
  const unapplied = Math.round(paidInMonth - applied);
  const lines: ReceivableLine[] = [
    { key: 'arPrior', label: L.arPrior, sign: 0, amount: prior },
    { key: 'arTransitIn', label: L.arTransitIn, sign: 1, amount: Math.round(transitIn) },
    { key: 'arBaseline', label: L.arBaseline, sign: 1, amount: Math.round(baseline) },
    { key: 'arPrepaidUsed', label: L.arPrepaidUsed, sign: -1, amount: Math.round(prepaidUsed) },
    { key: 'arWrittenOff', label: L.arWrittenOff, sign: -1, amount: Math.round(writtenOff) },
    ...(unapplied ? [{ key: 'arUnapplied' as const, label: L.arUnapplied, sign: 1 as const, amount: unapplied }] : []),
    ...(settings.reportFields?.items ?? []).map((it) => ({ key: 'item' as const, label: it.label?.trim() || it.bill, sign: -1 as const, amount: optionalItemAmount(data, result, it.bill, month) })),
    { key: 'arTransitOut', label: L.arTransitOut, sign: -1, amount: Math.round(transitOut) },
  ];
  const total = lines.reduce((t, l) => t + (l.sign === -1 ? -l.amount : l.amount), 0);
  const owing = owingAt(result, month);
  return {
    lines: [...lines, { key: 'arResult', label: L.arResult, sign: 0, amount: total }],
    result: total,
    baseline: Math.round(baseline),
    due: Math.round(due),
    owing: owing.amount,
    owingUnits: owing.units,
  };
}
