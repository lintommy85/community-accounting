import { addMonths, monthEnd, todayStr, ymd } from './dates';
import { newId, presetFilings } from './defaults';
import { AppData, AssetItem, Contract, ContractCycle, Filing, ReminderMonths, Settings, TrackRecord } from './types';

export const CYCLE_LABEL: Record<ContractCycle, string> = { month: '每月', quarter: '每季', half: '每半年', year: '每年' };
const PER_YEAR: Record<ContractCycle, number> = { month: 12, quarter: 4, half: 2, year: 1 };
export const ASSET_KIND_LABEL: Record<AssetItem['kind'], string> = { equipment: '設備', certificate: '證書' };

/** 合約、設備與證書預設在到期前幾個月提醒。 */
export const DATE_WARN_MONTHS = 3;
/** 政府申報預設在期限前幾個月提醒。 */
export const FILING_WARN_MONTHS = 6;
export const MAX_REMINDER_MONTHS = 24;

const months = (v: unknown, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= MAX_REMINDER_MONTHS ? n : fallback;
};

/** 「基本設定 → 到期提醒」：合約、設備與證書、政府申報各自在到期前幾個月開始提醒。 */
export function reminderMonths(s: Pick<Settings, 'reminders'>): ReminderMonths {
  const r = s.reminders ?? {};
  return { contracts: months(r.contracts, DATE_WARN_MONTHS), assets: months(r.assets, DATE_WARN_MONTHS), filings: months(r.filings, FILING_WARN_MONTHS) };
}

/** 合約一年的金額。 */
export const annualAmount = (c: Pick<Contract, 'amount' | 'cycle'>) => c.amount * PER_YEAR[c.cycle];

export { presetFilings };

export type DueState = 'ok' | 'soon' | 'overdue' | 'unset';

export interface DueInfo {
  state: DueState;
  /** 到期日或申報期限的最後一天。 */
  deadline: string;
  /** 距離到期還有幾天（過期為負數）。 */
  days: number;
}

const dayDiff = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);

/** 日期往前或往後 n 個月，日子超過那個月的天數時用月底。 */
export function shiftDate(date: string, n: number): string {
  const month = addMonths(date.slice(0, 7), n);
  const last = Number(monthEnd(month).slice(8));
  const [y, m] = month.split('-').map(Number);
  return ymd(y, m, Math.min(Number(date.slice(8, 10)), last));
}

/** 到期日的狀態：過了到期日為 overdue，到期前 warnMonths 個月內為 soon。 */
export function dateDue(expiry: string, today = todayStr(), warnMonths = DATE_WARN_MONTHS): DueInfo {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return { state: 'unset', deadline: '', days: 0 };
  const days = dayDiff(today, expiry);
  const state: DueState = today > expiry ? 'overdue' : today >= shiftDate(expiry, -warnMonths) ? 'soon' : 'ok';
  return { state, deadline: expiry, days };
}

const isMonth = (s: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const monthIndex = (s: string) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;

/** 最近一次申報算是哪一年的申報：取期限月份離申報月份最近的那一年（提早或逾期申報都算那一次）。 */
export function coveredYear(lastMonth: string, dueMonth: number): number {
  const y = Number(lastMonth.slice(0, 4));
  const at = monthIndex(lastMonth);
  return [y - 1, y, y + 1].reduce((best, c) => (Math.abs(c * 12 + dueMonth - 1 - at) < Math.abs(best * 12 + dueMonth - 1 - at) ? c : best), y);
}

/** 下一次申報的期限月份：有最近一次申報時往後推 everyYears 年；還沒填時取今天以後最近的期限月份。 */
export function nextFilingMonth(f: Pick<Filing, 'everyYears' | 'dueMonth' | 'lastMonth'>, today = todayStr()): string {
  const due = Math.min(12, Math.max(1, Math.round(f.dueMonth) || 12));
  const every = Math.max(1, Math.round(f.everyYears) || 1);
  const pad = String(due).padStart(2, '0');
  if (isMonth(f.lastMonth)) return `${coveredYear(f.lastMonth, due) + every}-${pad}`;
  const y = Number(today.slice(0, 4));
  return `${Number(today.slice(5, 7)) <= due ? y : y + 1}-${pad}`;
}

/** 政府申報的狀態：期限月底過了為 overdue，期限前半年內為 soon，直到更新最近一次申報月份。 */
export function filingDue(f: Pick<Filing, 'everyYears' | 'dueMonth' | 'lastMonth'>, today = todayStr(), warnMonths = FILING_WARN_MONTHS): DueInfo & { month: string } {
  const month = nextFilingMonth(f, today);
  const deadline = monthEnd(month);
  const days = dayDiff(today, deadline);
  const state: DueState = today > deadline ? 'overdue' : today.slice(0, 7) > addMonths(month, -warnMonths) ? 'soon' : 'ok';
  return { state, deadline, days, month };
}

export const needsAttention = (d: { state: DueState }) => d.state === 'soon' || d.state === 'overdue';

/** 合約要不要高亮提醒：勾選到期不續約的不提醒。 */
export const contractAlert = (c: Pick<Contract, 'noRenew'>, due: DueInfo) => !c.noRenew && needsAttention(due);

/** 狀態文字：已過期幾天、還剩幾天。 */
export function dueText(d: DueInfo): string {
  if (d.state === 'unset') return '未設定';
  if (d.days < 0) return `已過期 ${-d.days} 天`;
  if (d.days === 0) return '今天到期';
  return `剩 ${d.days} 天`;
}

/** 新增一筆修改紀錄（新的在前面）。 */
export function withRecord<T extends { history: TrackRecord[] }>(item: T, value: string, detail: string, at = new Date().toISOString()): T {
  return { ...item, history: [{ id: newId('tr_'), at, value, detail }, ...item.history] };
}

export const contractDetail = (c: Contract) => `${c.vendor || '未填廠商'}｜${CYCLE_LABEL[c.cycle]} ${c.amount.toLocaleString('zh-TW')} 元${c.startDate ? `｜${c.startDate} 起` : ''}`;
export const filingDetail = (f: Filing) => `每 ${f.everyYears} 年，${f.dueMonth} 月底前`;

/** 側欄與總覽用：要提醒的合約、設備證書、政府申報筆數。 */
export function registryAlerts(data: Pick<AppData, 'contracts' | 'assets' | 'filings' | 'settings'>, today = todayStr()) {
  const m = reminderMonths(data.settings);
  return {
    contracts: (data.contracts ?? []).filter((c) => contractAlert(c, dateDue(c.endDate, today, m.contracts))).length,
    assets: (data.assets ?? []).filter((a) => needsAttention(dateDue(a.expiry, today, m.assets))).length,
    filings: (data.filings ?? []).filter((f) => needsAttention(filingDue(f, today, m.filings))).length,
  };
}
