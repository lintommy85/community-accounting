const pad = (n: number) => String(n).padStart(2, '0');

export function ymd(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function todayStr(): string {
  const d = new Date();
  return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function normYear(y: number): number {
  return y < 1911 ? y + 1911 : y;
}

export function excelSerialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  const dt = new Date(ms);
  return ymd(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function parseDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return ymd(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === 'number') {
    if (value > 20000 && value < 80000) return excelSerialToDate(value);
    const s = String(Math.trunc(value));
    if (/^\d{8}$/.test(s)) return parseDate(s);
    if (/^\d{7}$/.test(s)) return parseDate(s);
    return '';
  }
  const s = String(value).trim().replace(/\s+/g, ' ');
  if (!s) return '';
  let m = s.match(/^(\d{2,4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (m) {
    const out = ymd(normYear(Number(m[1])), Number(m[2]), Number(m[3]));
    return isValidDate(out) ? out : '';
  }
  m = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (m && s.length >= 8 && /^\d{8}/.test(s)) {
    const out = ymd(Number(m[1]), Number(m[2]), Number(m[3]));
    return isValidDate(out) ? out : '';
  }
  m = s.match(/^(\d{3})(\d{2})(\d{2})$/);
  if (m) {
    const out = ymd(normYear(Number(m[1])), Number(m[2]), Number(m[3]));
    return isValidDate(out) ? out : '';
  }
  return '';
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return ymd(y, m, last);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}

export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = from;
  let guard = 0;
  while (cur <= to && guard++ < 600) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}

/** 解析帳單期別，回傳涵蓋的月份（YYYY-MM），支援民國年與區間，例如「115/10~115/12」。 */
export function parsePeriods(value: string): string[] {
  const s = (value || '').trim();
  if (!s) return [];
  const re = /(\d{2,4})\s*[-/.年]\s*(\d{1,2})\s*月?/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const y = normYear(Number(m[1]));
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) found.push(`${y}-${pad(mo)}`);
  }
  if (found.length === 0) {
    const compact = s.match(/^(\d{3,4})(\d{2})$/);
    if (compact) {
      const mo = Number(compact[2]);
      if (mo >= 1 && mo <= 12) return [`${normYear(Number(compact[1]))}-${pad(mo)}`];
    }
    return [];
  }
  const isRange = /[~～至到]|\s-\s/.test(s) && found.length === 2;
  if (isRange && found[0] <= found[1]) return monthRange(found[0], found[1]);
  return Array.from(new Set(found));
}
