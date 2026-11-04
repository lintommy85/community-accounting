import { useMemo, useState } from 'react';
import { allocateAll, AmountCheck, dueFor, normUnit } from '../lib/allocation';
import { formatMoney } from '../lib/defaults';
import { ownerAt } from '../lib/owners';
import { AppData, MonthAmount } from '../lib/types';

export interface ReviewDecision {
  allocations?: MonthAmount[];
  note: string;
}

type Mode = 'auto' | 'manual';
interface Draft {
  mode: Mode;
  values: Record<string, string>;
  reason: string;
  /** 金額等於上個月帳單時，使用者選擇銷上個月或這個月。 */
  pick?: 'prev' | 'this';
  /** 目前套用的快速選項（按鈕會反白）；自行修改金額後清除。 */
  preset?: 'auto' | 'period' | 'clear' | 'prev';
}

const REASONS = ['多繳，預繳下期', '補繳逾期管理費', '部分繳費，餘額待繳', '減收／折讓', '退款'];

/** 匯入時繳費金額與當期應繳不同：逐筆確認要銷哪幾個月（可選逾期月份），並可自行填寫說明。 */
export default function ImportReview({
  checks,
  dryData,
  onCancel,
  onDone,
}: {
  checks: AmountCheck[];
  dryData: AppData;
  onCancel: () => void;
  onDone: (decisions: Map<string, ReviewDecision>) => void;
}) {
  const alloc = useMemo(() => allocateAll(dryData), [dryData]);
  const autoValues = (paymentId: string) => {
    const v: Record<string, string> = {};
    for (const a of alloc.byPayment.get(paymentId) ?? []) v[a.month] = String((Number(v[a.month]) || 0) + a.amount);
    return v;
  };
  const [idx, setIdx] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() =>
    Object.fromEntries(checks.map((c) => [c.payment.id, { mode: 'auto' as Mode, values: autoValues(c.payment.id), reason: '', preset: 'auto' as const }])),
  );

  const c = checks[idx];
  const p = c.payment;
  const draft = drafts[p.id];
  const acc = alloc.byKey.get(normUnit(p.unitNo))!;
  const mine = alloc.byPayment.get(p.id) ?? [];
  const otherPaid = (m: string) => (acc.paidByMonth.get(m) ?? 0) - mine.filter((a) => a.month === m).reduce((s, a) => s + a.amount, 0);
  const gap = (m: string) => Math.max(0, dueFor(acc, m) - otherPaid(m));
  const first = c.months[0];
  const last = c.months[c.months.length - 1];
  const months = Array.from(
    new Set([
      ...Array.from(acc.dueByMonth.keys()).filter((m) => gap(m) > 0 || m >= first),
      ...c.months,
      ...Object.keys(draft.values),
    ]),
  ).sort();
  const total = Object.values(draft.values).reduce((s, v) => s + (Number(v) || 0), 0);
  const over = total > p.amount;
  const setDraft = (patch: Partial<Draft>) => setDrafts({ ...drafts, [p.id]: { ...draft, ...patch } });
  const setValue = (m: string, v: string) => setDraft({ mode: 'manual', values: { ...draft.values, [m]: v }, preset: undefined });

  function fillMonths(list: string[], preset: Draft['preset'], pick?: Draft['pick']) {
    let remaining = p.amount;
    const values: Record<string, string> = {};
    for (const m of list) {
      const a = Math.min(gap(m), remaining);
      if (a > 0) values[m] = String(a);
      remaining -= a;
    }
    setDraft({ mode: 'manual', values, preset, ...(pick ? { pick } : {}) });
  }
  const onlyThisPeriod = () => fillMonths(c.months, 'period', c.prev ? 'this' : undefined);

  function decisions(all: Record<string, Draft>): Map<string, ReviewDecision> {
    const out = new Map<string, ReviewDecision>();
    for (const ch of checks) {
      const d = all[ch.payment.id];
      const allocations =
        d.mode === 'manual'
          ? Object.entries(d.values)
              .filter(([, v]) => Number(v))
              .map(([month, v]) => ({ month, amount: Number(v) }))
              .sort((a, b) => a.month.localeCompare(b.month))
          : undefined;
      out.set(ch.payment.id, { allocations, note: d.reason.trim() });
    }
    return out;
  }

  const unpicked = checks.filter((ch) => ch.prev && !drafts[ch.payment.id].pick);
  const invalid = checks.filter((ch) => Object.values(drafts[ch.payment.id].values).reduce((s, v) => s + (Number(v) || 0), 0) > ch.payment.amount);

  return (
    <div className="modal-backdrop">
      <div className="modal wide review-modal">
        <div className="page-head">
          <h2>匯入確認：金額與帳單金額不同（{idx + 1}／{checks.length}）</h2>
        </div>
        <table className="kv">
          <tbody>
            <tr><th>戶別</th><td>{acc.unit.unitNo}　{ownerAt(acc.unit, c.months[0])}</td></tr>
            <tr><th>繳費</th><td>{p.paidDate}　{p.channel}　期別 {p.billPeriod || '（無）'}　<strong>{formatMoney(p.amount)}</strong> 元</td></tr>
            <tr>
              <th>帳單金額</th>
              <td>
                {c.months.join('、')} {c.estimated ? `尚未匯入每月應繳，依基準估算 ${formatMoney(c.bill)} 元` : `帳單共 ${formatMoney(c.bill)} 元（含帳單內含逾期）`}
                {c.others.amount > 0 || c.others.count > 0 ? `，這期已銷 ${formatMoney(c.others.amount)} 元${c.others.count ? `（同期另有 ${c.others.count} 筆繳費）` : ''}，這筆還應繳 ${formatMoney(c.expected)} 元` : ''}
                <span className={`tag ${c.diff > 0 ? 'ok' : 'warn'}`}>{c.diff > 0 ? `多繳 ${formatMoney(c.diff)}` : `少繳 ${formatMoney(-c.diff)}`}</span>
              </td>
            </tr>
          </tbody>
        </table>

        {c.months[0] < alloc.startMonth && (
          <p className="banner err">{c.months[0]} 早於帳務起始月 {alloc.startMonth}，這個月份的應繳不會銷帳。請先取消匯入，把帳務起始月往前改（匯入頁會提示），再重新匯入。</p>
        )}
        {c.prev && (
          <div className={`banner block ${draft.pick ? 'ok' : 'warn'}`}>
            <strong>這筆金額 {formatMoney(p.amount)} 元和上個月（{c.prev.month}）尚未繳清的帳單相同，可能是跨月才入帳、或費率調整前的帳。請選擇要銷哪個月：</strong>
            <div className="form-row">
              <button className={draft.pick === 'prev' ? 'primary' : ''} onClick={() => fillMonths([c.prev!.month, ...c.months], 'prev', 'prev')}>銷上個月 {c.prev.month}（{formatMoney(c.prev.bill)}）</button>
              <button className={draft.pick === 'this' ? 'primary' : ''} onClick={onlyThisPeriod}>銷這個月 {c.months.join('、')}（{formatMoney(c.expected)}）</button>
            </div>
          </div>
        )}

        <div className="form-row">
          <button className={draft.preset === 'auto' ? 'primary' : ''} onClick={() => setDraft({ mode: 'auto', values: autoValues(p.id), preset: 'auto' })}>系統自動（先銷逾期）</button>
          <button className={draft.preset === 'period' ? 'primary' : ''} onClick={onlyThisPeriod}>只銷本期</button>
          <button className={draft.preset === 'clear' ? 'primary' : ''} onClick={() => setDraft({ mode: 'manual', values: {}, preset: 'clear' })}>清空，自行勾選</button>
        </div>

        <div className="table-wrap short">
          <table>
            <thead><tr><th>月份</th><th></th><th className="num">應繳</th><th className="num">其他款項已銷</th><th className="num">尚欠</th><th className="num">本筆銷帳</th></tr></thead>
            <tbody>
              {months.map((m) => {
                const due = dueFor(acc, m);
                const tag = m < first ? (gap(m) > 0 ? '逾期' : '') : m > last ? '預繳' : '本期';
                const checked = Number(draft.values[m]) !== 0 && draft.values[m] !== undefined && draft.values[m] !== '';
                return (
                  <tr key={m} className={checked ? 'selected' : ''}>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (!e.target.checked) return setValue(m, '');
                            const used = total - (Number(draft.values[m]) || 0);
                            setValue(m, String(Math.max(0, Math.min(gap(m), p.amount - used))));
                          }}
                        />
                        {m}
                      </label>
                    </td>
                    <td>{tag && <span className={`tag ${tag === '逾期' ? 'warn' : tag === '本期' ? 'ok' : ''}`}>{tag}</span>}</td>
                    <td className="num">{formatMoney(due)}</td>
                    <td className="num">{otherPaid(m) ? formatMoney(otherPaid(m)) : ''}</td>
                    <td className="num">{gap(m) ? formatMoney(gap(m)) : ''}</td>
                    <td className="num"><input type="number" className="short-num" value={draft.values[m] ?? ''} onChange={(e) => setValue(m, e.target.value)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className={over ? 'err' : 'hint'}>
          已分配 {formatMoney(total)}／繳款 {formatMoney(p.amount)}
          {over ? '超過繳款金額' : p.amount - total ? `未分配 ${formatMoney(p.amount - total)} 元列為這戶的預收款（期別應繳還沒匯入時為暫收款），之後有應繳時自動銷帳` : '全額銷帳'}
          {draft.mode === 'auto' ? '（系統自動）' : '（手動指定）'}
        </p>
        <label>
          說明（可自行填寫，會記在這筆繳費的備註）
          <input list="review-reasons" value={draft.reason} placeholder="例如：多繳，預繳下期" onChange={(e) => setDraft({ reason: e.target.value })} />
          <datalist id="review-reasons">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
        </label>

        <div className="form-row modal-actions">
          <button onClick={onCancel}>取消匯入</button>
          <span style={{ flex: 1 }} />
          <button disabled={idx === 0} onClick={() => setIdx(idx - 1)}>上一筆</button>
          {idx < checks.length - 1 && <button onClick={() => setIdx(idx + 1)}>下一筆</button>}
          <button className="primary" disabled={invalid.length > 0 || unpicked.length > 0} onClick={() => onDone(decisions(drafts))}>
            {idx < checks.length - 1 ? `其餘依目前設定，完成匯入` : '完成匯入'}
          </button>
        </div>
        {invalid.length > 0 && <p className="err">有 {invalid.length} 筆分配金額超過繳款金額，請調整後再匯入。</p>}
        {unpicked.length > 0 && (
          <p className="err">
            有 {unpicked.length} 筆金額和上個月帳單相同，請先選擇要銷上個月還是這個月：
            {unpicked.map((ch) => <button key={ch.payment.id} className="link" onClick={() => setIdx(checks.indexOf(ch))}>{ch.account.unit.unitNo}</button>)}
          </p>
        )}
      </div>
    </div>
  );
}
