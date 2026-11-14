import { useState } from 'react';
import { BEFORE_START_TEXT, cardMonths, chargeAmounts, chargeKindOfItem, chargeText, dueFor, isOpeningPayment, summarizeUnit, UnitAccount, unitChargeRows } from '../lib/allocation';
import { withCommunity } from '../lib/defaults';
import { ownerAt, ownerHistory } from '../lib/owners';
import { Payment } from '../lib/types';
import { useStore } from '../store';
import AllocationEditor from './AllocationEditor';
import { Money, thisMonth } from './ui';
import { Icon } from './icons';

const SOURCE_LABEL = { manual: '手動', period: '依期別', offset: '預收沖銷', auto: '自動' } as const;

/** 戶別帳卡：逐月應繳／銷帳明細與每筆繳款的銷帳情形。 */
export default function UnitCard({ account, startMonth, onBack }: { account: UnitAccount; startMonth: string; onBack: () => void }) {
  const { data } = useStore();
  const [editing, setEditing] = useState<Payment | null>(null);
  const unit = account.unit;
  const months = cardMonths(account, thisMonth());
  const sum = summarizeUnit(account, months[0] ?? startMonth, thisMonth());
  const payById = new Map(account.feePayments.map((p) => [p.id, p]));
  const owners = ownerHistory(unit);
  const changed = owners.length > 1;
  const allocatedOf = (id: string) => account.allocations.filter((a) => a.paymentId === id).reduce((s, a) => s + a.amount, 0);
  const chargeOf = (id: string) => account.chargePaid.filter((c) => c.paymentId === id).reduce((s, c) => s + c.amount, 0);
  const chargeRows = unitChargeRows(account, data.entries);

  return (
    <>
      <div className="page-head no-print">
        <button onClick={onBack}>← 返回戶別列表</button>
        <button className="primary" onClick={() => window.print()}><Icon name="printer" />列印帳卡</button>
      </div>
      <section className="card">
        <h1 className="statement-title">{withCommunity(data.settings, '管理費帳卡')}</h1>
        <p className="statement-sub">戶別 {unit.unitNo}　{unit.owner && `${changed ? '目前所有權人' : '所有權人'} ${unit.owner}　`}列印日 {new Date().toLocaleDateString('zh-TW')}</p>
        {changed && (
          <p className="statement-sub">
            所有權人紀錄：{owners.map((o) => `${o.from ? `${o.from} 起` : '最早'} ${o.owner || '（空白）'}`).join('　→　')}
          </p>
        )}
        <div className="stats">
          <div className="stat"><div className="stat-label">截至本月應繳</div><div className="stat-value"><Money value={sum.due} /></div></div>
          <div className="stat"><div className="stat-label">已銷帳</div><div className="stat-value"><Money value={sum.paid} /></div></div>
          <div className={`stat ${sum.owing ? 'warn' : ''}`}><div className="stat-label">未繳</div><div className="stat-value"><Money value={sum.owing} /></div><div className="stat-hint">{sum.owingMonths.length ? `${sum.owingMonths.length} 期：${sum.owingMonths.join('、')}` : '無欠繳'}</div></div>
          <div className="stat"><div className="stat-label">預繳／暫收</div><div className="stat-value"><Money value={sum.prepaid} /></div><div className="stat-hint">{sum.paidThrough ? `已繳至 ${sum.paidThrough}` : ''}</div></div>
        </div>

        <h2 className="statement-block">逐月銷帳</h2>
        {months.length === 0 && <p className="empty">這一戶還沒有任何應繳紀錄，請到「匯入智生活報表 → 每月應繳報表」匯入智生活管理費匯入範本。</p>}
        <table className="report">
          <thead><tr><th>月份</th>{changed && <th>所有權人</th>}<th className="num">應繳</th><th className="num">已銷</th><th className="num">未繳</th><th>銷帳來源</th></tr></thead>
          <tbody>
            {months.map((m) => {
              const due = dueFor(account, m);
              const allocs = account.allocations.filter((a) => a.month === m);
              const paid = allocs.reduce((s, a) => s + a.amount, 0);
              const future = m > thisMonth();
              return (
                <tr key={m} className={paid < due && !future ? 'attention' : ''}>
                  <td>{m}{future && paid > 0 ? '（預繳）' : ''}</td>
                  {changed && <td>{ownerAt(unit, m)}</td>}
                  <td className="num"><Money value={due} /></td>
                  <td className="num">{paid ? <Money value={paid} /> : ''}</td>
                  <td className="num">{due > paid ? <Money value={due - paid} /> : ''}</td>
                  <td>
                    {allocs.map((a, i) => {
                      const p = payById.get(a.paymentId);
                      return <span key={i} className="tag">{p?.paidDate} {p?.channel} <Money value={a.amount} />（{SOURCE_LABEL[a.source]}）</span>;
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 className="statement-block">繳款紀錄</h2>
        <table className="report">
          <thead><tr><th>繳費日</th><th>方式</th><th>期別</th><th className="num">金額</th><th className="num">已銷帳</th><th className="num">暫收／預收</th><th>銷帳方式</th><th>備註</th><th className="no-print"></th></tr></thead>
          <tbody>
            {account.feePayments.map((p) => {
              const allocated = allocatedOf(p.id);
              const opening = isOpeningPayment(p.id);
              const before = account.beforeStart.has(p.id);
              const kind = opening ? undefined : chargeKindOfItem(p.item, data.settings);
              return (
                <tr key={p.id} className={opening ? 'sub-line' : ''}>
                  <td>{p.paidDate}</td><td>{p.channel}</td><td>{p.billPeriod}</td>
                  <td className="num"><Money value={p.amount} /></td>
                  <td className="num"><Money value={allocated} /></td>
                  <td className="num">{!before && p.amount - allocated - chargeOf(p.id) ? <Money value={p.amount - allocated - chargeOf(p.id)} /> : ''}</td>
                  <td>
                    {kind ? (
                      <span className="tag purple" title="罰款、裝潢保證金只記在帳卡，不銷管理費">{kind === 'deposit' ? '裝潢保證金' : '罰款'}，不銷管理費</span>
                    ) : (
                      <>
                        {opening ? <span className="tag ok">期初預收款</span> : before ? <span className="tag" title="期別在帳務起始月之前，這些月份沒有應繳，不銷帳、不列預收或暫收">{BEFORE_START_TEXT}</span> : p.allocations ? <span className="tag warn">手動</span> : p.billPeriod ? <span className="tag">依期別</span> : <span className="tag">自動（先銷舊欠）</span>}
                        {chargeOf(p.id) > 0 && <span className="tag purple">{chargeText(chargeAmounts(account, p.id))}</span>}
                      </>
                    )}
                  </td>
                  <td className="note-cell" title={p.note}>{p.note}</td>
                  <td className="no-print">{!opening && !kind && <button className="link" onClick={() => setEditing(p)}>調整銷帳</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {account.feePayments.length === 0 && <p className="empty">沒有繳款紀錄。</p>}

        {chargeRows.length > 0 && (
          <>
            <h2 className="statement-block">罰款與裝潢保證金</h2>
            <p className="hint no-print">罰款、裝潢保證金不列入每月應繳，也不算欠費；繳款直接入帳。裝潢保證金請到「日常記帳 → 裝潢保證金」結算退款。</p>
            <table className="report">
              <thead><tr><th>月份</th><th>類型</th><th>項目</th><th className="num">帳單金額</th><th className="num">已繳</th><th className="num">未繳</th><th>繳款日</th></tr></thead>
              <tbody>
                {chargeRows.map((r, i) => (
                  <tr key={`${r.month}|${r.kind}|${r.item}|${i}`}>
                    <td>{r.month}</td>
                    <td><span className={`tag ${r.kind === 'fine' ? 'danger' : 'purple'}`}>{r.kind === 'fine' ? '罰款' : '裝潢保證金'}</span></td>
                    <td>{r.item}</td>
                    <td className="num">{r.billed !== null ? <Money value={r.billed} /> : <span className="muted small">沒有帳單</span>}</td>
                    <td className="num"><Money value={r.paid} /></td>
                    <td className="num">{r.billed !== null && r.billed > r.paid ? <strong className="warn"><Money value={r.billed - r.paid} /></strong> : ''}</td>
                    <td>{r.dates.join('、')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
      {editing && <AllocationEditor payment={editing} account={account} startMonth={startMonth} onClose={() => setEditing(null)} />}
    </>
  );
}
