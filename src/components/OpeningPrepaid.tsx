import { useMemo, useState } from 'react';
import { allocateAll, isOpeningPayment, normUnit } from '../lib/allocation';
import { activeUnits, cycleLabel, sortUnits, unitBaseline } from '../lib/fees';
import { ownerMatches } from '../lib/owners';
import { Unit } from '../lib/types';
import { useStore } from '../store';
import { Money, Section, thisMonth } from './ui';

type Filter = 'all' | 'offset' | 'set';

/** 期初預收款：帳務起始月之前已預繳（年繳、半年繳…）、尚未沖銷的金額，從起始月起依序銷帳。 */
export default function OpeningPrepaid() {
  const { data, update } = useStore();
  const s = data.settings;
  const alloc = useMemo(() => allocateAll(data), [data]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const now = thisMonth();
  const units = sortUnits(activeUnits(s.units));
  // 帳單有預繳沖銷、但目前沒有預收款可以扣（照帳單減少應繳）的戶別
  const offsetKeys = new Set(alloc.accounts.filter((a) => Array.from(a.prepaidBefore).some(([m, v]) => v > (a.prepaidBeforeUsed.get(m) ?? 0))).map((a) => a.key));
  const usedOf = (u: Unit) =>
    (alloc.byKey.get(normUnit(u.unitNo))?.allocations ?? []).filter((a) => isOpeningPayment(a.paymentId) && a.month <= now).reduce((t, a) => t + a.amount, 0);
  const kw = q.trim().toUpperCase();
  const shown = units
    .filter((u) => filter === 'all' || (filter === 'offset' ? offsetKeys.has(normUnit(u.unitNo)) : (u.openingPrepaid ?? 0) > 0))
    .filter((u) => !kw || u.unitNo.toUpperCase().includes(kw) || ownerMatches(u, kw));
  const withValue = units.filter((u) => (u.openingPrepaid ?? 0) > 0);
  const total = withValue.reduce((t, u) => t + (u.openingPrepaid ?? 0), 0);
  const used = withValue.reduce((t, u) => t + usedOf(u), 0);

  const setAmount = (u: Unit, amount: number) =>
    update(
      (d) => ({ ...d, settings: { ...d.settings, units: d.settings.units.map((x) => (x.id === u.id ? { ...x, openingPrepaid: amount > 0 ? amount : undefined } : x)) } }),
      '設定期初預收款',
      `${u.unitNo} ${amount}`,
    );

  function byMonths(u: Unit) {
    const base = unitBaseline(u, s.feePlans);
    if (!base) return alert('這戶還沒有每月基準，請直接輸入金額。');
    const n = Number(prompt(`${u.unitNo} 帳務起始月起還剩幾個月已預繳？（每月基準 ${base.toLocaleString('zh-TW')} 元）`, ''));
    if (Number.isFinite(n) && n > 0) setAmount(u, Math.round(n * base));
  }

  return (
    <Section title={`期初預收款（${withValue.length} 戶）`}>
      <p className="hint">
        社區啟用本系統前，住戶可能已經一次繳了半年、一年（例如年繳 7 月繳到隔年 6 月）。請輸入每戶在帳務起始月（{s.billingStartMonth || alloc.startMonth || '尚未設定'}）
        時還有多少預繳、尚未沖銷的金額。系統會從起始月起依序拿來銷每月應繳，剩下的列為預收款，每個月沖銷後越來越少。
        智生活帳單上的預繳沖銷（例如「年繳沖銷」）會由這筆預收款銷帳，不再減少應繳；已匯入的月份也會自動改過來，不用重新匯入。
      </p>
      {!s.billingStartMonth && <p className="banner warn">尚未設定帳務起始月，請先到「基本設定 → 戶數與銷帳」設定，期初預收款以起始月計算。</p>}
      <div className="banner">
        <span>期初預收款合計 <Money value={total} strong /> 元，截至 {now} 已沖銷 <Money value={used} /> 元，剩餘 <Money value={total - used} strong /> 元。</span>
      </div>
      <div className="form-row">
        {(['all', 'offset', 'set'] as const).map((f) => (
          <button key={f} className={filter === f ? 'primary' : ''} onClick={() => setFilter(f)}>
            {f === 'all' ? `全部（${units.length}）` : f === 'offset' ? `沖銷沒有預收款（${units.filter((u) => offsetKeys.has(normUnit(u.unitNo))).length}）` : `已輸入（${withValue.length}）`}
          </button>
        ))}
        <input placeholder="搜尋戶別代碼或所有權人" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>戶別</th><th>所有權人</th><th>繳費週期</th><th className="num">每月基準</th><th className="num">期初預收款</th><th></th><th className="num">已沖銷</th><th className="num">剩餘</th><th>提醒</th></tr></thead>
          <tbody>
            {shown.map((u) => {
              const amount = u.openingPrepaid ?? 0;
              const usedHere = usedOf(u);
              const offset = offsetKeys.has(normUnit(u.unitNo));
              return (
                <tr key={u.id} className={offset && !amount ? 'attention' : ''}>
                  <td>{u.unitNo}</td>
                  <td>{u.owner}</td>
                  <td>{cycleLabel(u)}</td>
                  <td className="num"><Money value={unitBaseline(u, s.feePlans)} /></td>
                  <td className="num">
                    <input type="number" min={0} className="short-num" defaultValue={amount || ''} key={`p${amount}`} placeholder="0"
                      onBlur={(e) => (Number(e.target.value) || 0) !== amount && setAmount(u, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
                  </td>
                  <td><button className="link" onClick={() => byMonths(u)}>依月數計算</button></td>
                  <td className="num">{amount ? <Money value={usedHere} /> : ''}</td>
                  <td className="num">{amount ? <Money value={amount - usedHere} strong /> : ''}</td>
                  <td>{offset && <span className="tag warn" title="帳單有預繳沖銷，但這戶沒有預收款可以扣，目前照帳單減少應繳；輸入期初預收款後會自動改由預收款沖銷">沖銷沒有預收款</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">沒有符合的戶別。</p>}
      </div>
    </Section>
  );
}
