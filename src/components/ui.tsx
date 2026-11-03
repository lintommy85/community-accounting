import { KeyboardEvent, ReactNode } from 'react';
import { formatMoney } from '../lib/defaults';
import { addMonths, todayStr } from '../lib/dates';

export function Money({ value, strong }: { value: number; strong?: boolean }) {
  const cls = `money${value < 0 ? ' neg' : ''}`;
  return strong ? <strong className={cls}>{formatMoney(value)}</strong> : <span className={cls}>{formatMoney(value)}</span>;
}

export function Section({ title, actions, children, className }: { title: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className ? `card ${className}` : 'card'}>
      <header className="card-head">
        <h2>{title}</h2>
        {actions && <div className="actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

export function Stat({ label, value, hint, tone, onClick, title }: { label: string; value: number; hint?: string; tone?: 'warn' | 'ok'; onClick?: () => void; title?: string }) {
  return (
    <div className={`stat ${tone ?? ''}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} title={onClick ? title ?? '查看帳戶變動紀錄' : undefined}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{formatMoney(value)}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function MonthInput({ value, onChange }: { value: string; onChange: (m: string) => void }) {
  return (
    <span className="month-input">
      <button type="button" onClick={() => onChange(addMonths(value, -1))} aria-label="上個月">‹</button>
      <input type="month" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button type="button" onClick={() => onChange(addMonths(value, 1))} aria-label="下個月">›</button>
    </span>
  );
}

export const thisMonth = () => todayStr().slice(0, 7);
export const lastMonth = () => addMonths(thisMonth(), -1);

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

/**
 * 是否為「送出」用的 Enter：中文輸入法（注音、倉頡、拼音…）選字時按 Enter 是確認選字，
 * 這時 isComposing 為 true（Safari 則回報 keyCode 229），不能當成送出。
 */
export function isEnterKey(e: KeyboardEvent<HTMLElement>): boolean {
  return e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229;
}
