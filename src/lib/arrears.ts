import { AllocationResult, allocateAll, isOpeningPayment } from './allocation';
import { monthEnd, monthOf, parsePeriods } from './dates';
import { normUnit, PRIOR_ITEM } from './dues';
import { ownerAt } from './owners';
import { AppData } from './types';

export interface ArrearsDueItem {
  item: string;
  amount: number;
}

/** 本月繳款中銷到以前月份（逾期）的一筆：哪一戶、哪筆繳款、銷了哪個月的哪個應繳項目。 */
export interface ArrearsLine {
  /** 歸類用的鍵：繳款 id｜月份｜項目。 */
  key: string;
  paymentId: string;
  unitNo: string;
  owner: string;
  paidDate: string;
  /** 被銷帳的應繳月份。 */
  month: string;
  item: string;
  amount: number;
  /** 那個月的應繳內容。 */
  dueItems: ArrearsDueItem[];
  /** 繳的是帳務起始月前的帳單（系統沒有那個月的應繳）。 */
  beforeStart: boolean;
  /** 報表科目；還沒歸類為空字串。 */
  label: string;
}

/** 建議的報表科目，例如「10月逾期汽車位清潔費」；帳單拆出的前期欠款為「10月前期欠款」。 */
export const suggestArrearsLabel = (l: Pick<ArrearsLine, 'month' | 'item'>) =>
  l.item === PRIOR_ITEM ? `${Number(l.month.slice(5))}月${PRIOR_ITEM}` : `${Number(l.month.slice(5))}月逾期${l.item}`;

/**
 * 某月份的逾期款項：本月繳款銷到以前月份的部分，依那個月的應繳項目拆開（照應繳項目的順序依序銷）；
 * 繳的是帳務起始月前帳單的整筆列出。和收支報表「補繳以前月份」的金額一致。
 */
export function arrearsLines(data: AppData, month: string, alloc: AllocationResult = allocateAll(data)): ArrearsLine[] {
  const start = `${month}-01`;
  const end = monthEnd(month);
  const labels = data.arrearsLabels ?? {};
  const out = new Map<string, ArrearsLine>();
  const push = (l: Omit<ArrearsLine, 'label'>) => {
    const prev = out.get(l.key);
    if (prev) prev.amount += l.amount;
    else out.set(l.key, { ...l, label: labels[l.key] ?? '' });
  };
  for (const acc of alloc.accounts) {
    const pays = acc.feePayments.filter((p) => !isOpeningPayment(p.id) && !p.voided && p.paidDate >= start && p.paidDate <= end);
    if (!pays.length) continue;
    const mine = new Set(pays.map((p) => p.id));
    const paid = new Map(acc.feePayments.map((p) => [p.id, p]));
    const owner = ownerAt(acc.unit, month);
    const months = [...new Set(acc.allocations.filter((a) => mine.has(a.paymentId) && a.month < month && a.amount).map((a) => a.month))];
    for (const m of months) {
      const items: ArrearsDueItem[] = [];
      for (const d of data.dues) {
        if (normUnit(d.unitNo) !== acc.key || d.month !== m || d.amount <= 0 || d.kind === 'fine' || d.kind === 'deposit') continue;
        const prev = items.find((x) => x.item === d.item);
        if (prev) prev.amount += d.amount;
        else items.push({ item: d.item, amount: d.amount });
      }
      const left = items.map((x) => x.amount);
      // 那個月的所有銷帳依繳款先後依序填進應繳項目，算出每筆繳款銷了哪些項目
      const allocs = acc.allocations
        .filter((a) => a.month === m && a.amount)
        .sort((a, b) => (paid.get(a.paymentId)?.paidDate ?? '').localeCompare(paid.get(b.paymentId)?.paidDate ?? '') || a.paymentId.localeCompare(b.paymentId));
      for (const a of allocs) {
        const p = paid.get(a.paymentId);
        const base = { paymentId: a.paymentId, unitNo: acc.unit.unitNo, owner, paidDate: p?.paidDate ?? '', month: m, dueItems: items, beforeStart: false };
        if (a.amount < 0) {
          if (mine.has(a.paymentId)) {
            const item = items[0]?.item ?? '管理費';
            push({ ...base, key: `${a.paymentId}|${m}|${item}`, item, amount: a.amount });
          }
          continue;
        }
        let rest = a.amount;
        for (let i = 0; i < items.length && rest > 0; i++) {
          const take = Math.min(rest, left[i]);
          if (take <= 0) continue;
          left[i] -= take;
          rest -= take;
          if (mine.has(a.paymentId)) push({ ...base, key: `${a.paymentId}|${m}|${items[i].item}`, item: items[i].item, amount: take });
        }
        if (rest > 0 && mine.has(a.paymentId)) {
          const item = items[items.length - 1]?.item ?? '管理費';
          push({ ...base, key: `${a.paymentId}|${m}|${item}`, item, amount: rest });
        }
      }
    }
    for (const p of pays) {
      if (!acc.beforeStart.has(p.id)) continue;
      const m = parsePeriods(p.billPeriod)[0] ?? monthOf(p.paidDate);
      if (m >= month) continue;
      push({ key: `${p.id}|before`, paymentId: p.id, unitNo: acc.unit.unitNo, owner, paidDate: p.paidDate, month: m, item: p.item || '管理費', amount: p.amount, dueItems: [], beforeStart: true });
    }
  }
  return Array.from(out.values())
    .filter((l) => l.amount)
    .sort((a, b) => a.unitNo.localeCompare(b.unitNo, 'zh-Hant', { numeric: true }) || a.month.localeCompare(b.month) || a.paidDate.localeCompare(b.paidDate) || itemOrder(a) - itemOrder(b));
}

/** 同一個月的項目照應繳的順序排列。 */
const itemOrder = (l: ArrearsLine) => {
  const i = l.dueItems.findIndex((x) => x.item === l.item);
  return i === -1 ? l.dueItems.length : i;
};

export interface ArrearsReportLine {
  label: string;
  amount: number;
  count: number;
  /** 還沒歸類（月報不能列印）。 */
  unclassified: boolean;
}

/** 月報上的逾期科目：同一科目預設合併成一筆（可設定不合併，逐筆列出）；報表不顯示戶別。 */
export function arrearsReportLines(lines: ArrearsLine[], merge: Record<string, boolean> = {}): ArrearsReportLine[] {
  const out: ArrearsReportLine[] = [];
  const merged = new Map<string, ArrearsReportLine>();
  for (const l of lines) {
    const unclassified = !l.label;
    const label = l.label || `${suggestArrearsLabel(l)}（未歸類）`;
    if (!unclassified && merge[label] === false) {
      out.push({ label, amount: l.amount, count: 1, unclassified });
      continue;
    }
    const prev = merged.get(label);
    if (prev) {
      prev.amount += l.amount;
      prev.count++;
    } else {
      const row = { label, amount: l.amount, count: 1, unclassified };
      merged.set(label, row);
      out.push(row);
    }
  }
  return out;
}
