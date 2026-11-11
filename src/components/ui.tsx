import { KeyboardEvent, ReactNode } from 'react';
import { formatMoney } from '../lib/defaults';
import { addMonths, todayStr } from '../lib/dates';
import { Icon, IconName } from './icons';

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

export function Stat({ label, value, hint, tone, onClick, title, icon, color }: {
  label: string; value: number; hint?: string; tone?: 'warn' | 'ok'; onClick?: () => void; title?: string; icon?: IconName; color?: 'green' | 'blue' | 'purple' | 'yellow' | 'red' | 'gray';
}) {
  return (
    <div className={`stat ${tone ?? ''}${color ? ` c-${color}` : ''}${onClick ? ' clickable' : ''}`} onClick={onClick} role={onClick ? 'button' : undefined} title={onClick ? title ?? '查看帳戶變動紀錄' : undefined}>
      <div className="stat-label">{icon && <span className={`stat-icon ${color ?? 'green'}`}><Icon name={icon} /></span>}{label}</div>
      <div className="stat-value">{formatMoney(value)}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

/** 檔案選擇區：虛線框加圖示，點一下選檔案，或把檔案拖進來。 */
export function FileDrop({ title, hint, accept, onFile }: { title: string; hint?: string; accept: string; onFile: (file: File | undefined) => void }) {
  return (
    <label className="drop">
      <input type="file" accept={accept} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <span className="drop-icon"><Icon name="upload" /></span>
      <span className="drop-text">
        <strong>{title}</strong>
        {hint && <small>{hint}</small>}
      </span>
    </label>
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
