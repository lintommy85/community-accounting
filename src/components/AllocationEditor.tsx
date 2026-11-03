import { useState } from 'react';
import { dueFor, UnitAccount } from '../lib/allocation';
import { monthOf, monthRange } from '../lib/dates';
import { formatMoney } from '../lib/defaults';
import { Payment } from '../lib/types';
import { useStore } from '../store';

/** 手動調整單筆繳款要銷哪幾個月。 */
export default function AllocationEditor({ payment, account, startMonth, onClose }: { payment: Payment; account: UnitAccount; startMonth: string; onClose: () => void }) {
  const { update } = useStore();
  const mine = account.allocations.filter((a) => a.paymentId === payment.id);
  const otherPaid = (m: string) =>
    account.allocations.filter((a) => a.month === m && a.paymentId !== payment.id).reduce((s, a) => s + a.amount, 0);
  const candidates = [...account.dueByMonth.keys(), ...mine.map((a) => a.month), monthOf(payment.paidDate)].filter((m) => m >= startMonth || mine.some((a) => a.month === m)).sort();
  const months = candidates.length ? monthRange(candidates[0], candidates[candidates.length - 1]) : [monthOf(payment.paidDate)];
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const a of mine) init[a.month] = String((Number(init[a.month]) || 0) + a.amount);
    return init;
  });
  const total = Object.values(values).reduce((s, v) => s + (Number(v) || 0), 0);
  const over = payment.amount >= 0 ? total > payment.amount : total < payment.amount;

  function autoFill() {
    if (payment.amount <= 0) return;
    let remaining = payment.amount;
    const next: Record<string, string> = {};
    for (const m of months) {
      const gap = Math.max(0, dueFor(account, m) - otherPaid(m));
      const a = Math.min(gap, remaining);
      if (a > 0) next[m] = String(a);
      remaining -= a;
      if (remaining <= 0) break;
    }
    setValues(next);
  }

  function save(allocations: Payment['allocations'], action: string) {
    update(
      (d) => ({ ...d, payments: d.payments.map((p) => (p.id === payment.id ? { ...p, allocations } : p)) }),
      action,
      `${payment.unitNo} ${payment.paidDate} ${payment.amount}${allocations ? '：' + allocations.map((a) => `${a.month}=${a.amount}`).join('、') : ''}`,
    );
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h2>調整銷帳：{payment.unitNo} {payment.paidDate} 繳 {formatMoney(payment.amount)} 元</h2>
        <p className="hint">輸入這筆款項要銷哪幾個月、各銷多少（退款或減收可輸入負數）。只列出有應繳的月份；未分配的金額會列為暫收款。{payment.allocations ? '目前為手動銷帳。' : '目前為系統自動銷帳。'}</p>
        <div className="table-wrap short">
          <table>
            <thead><tr><th>月份</th><th className="num">應繳</th><th className="num">其他款項已銷</th><th className="num">本筆銷帳</th></tr></thead>
            <tbody>
              {months.map((m) => {
                const due = dueFor(account, m);
                const other = otherPaid(m);
                const v = Number(values[m]) || 0;
                const cls = due && other + v >= due ? 'paid' : v ? 'partial' : '';
                return (
                  <tr key={m} className={cls ? `alloc-${cls}` : ''}>
                    <td>{m}</td>
                    <td className="num">{formatMoney(due)}</td>
                    <td className="num">{other ? formatMoney(other) : ''}</td>
                    <td className="num">
                       <input type="number" className="short-num" value={values[m] ?? ''} onChange={(e) => setValues({ ...values, [m]: e.target.value })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={over ? 'err' : 'hint'}>
          已分配 {formatMoney(total)} ／ 繳款 {formatMoney(payment.amount)}　{over ? '超過繳款金額' : `未分配（暫收） ${formatMoney(payment.amount - total)}`}
        </p>
        <div className="form-row modal-actions">
          <button onClick={autoFill}>依月費自動填入</button>
          <button onClick={() => setValues({})}>清空</button>
          {payment.allocations && <button onClick={() => save(undefined, '恢復自動銷帳')}>恢復自動銷帳</button>}
          <span style={{ flex: 1 }} />
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            disabled={over}
            onClick={() =>
              save(
                months.filter((m) => Number(values[m])).map((m) => ({ month: m, amount: Number(values[m]) })),
                '手動銷帳',
              )
            }
          >
            儲存
          </button>
        </div>
      </div>
    </div>
  );
}
