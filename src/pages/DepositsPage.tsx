import { Fragment, useState } from 'react';
import { Money, MonthInput, Section, thisMonth } from '../components/ui';
import { todayStr } from '../lib/dates';
import { awaitingDeposit, DepositGroup, depositGroups } from '../lib/ledger';
import { useStore } from '../store';

export default function DepositsPage() {
  const { data, update, isClosed } = useStore();
  const [month, setMonth] = useState(thisMonth());
  const [open, setOpen] = useState<string>('');
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const today = todayStr();
  const pending = awaitingDeposit(data.payments);
  const priorCount = (g: DepositGroup) => g.payments.filter((p) => p.paidDate.slice(0, 7) < g.depositDate.slice(0, 7)).length;
  const groups = depositGroups(data.payments, month);
  const byDate = new Map<string, DepositGroup[]>();
  for (const g of groups) (byDate.get(g.depositDate) ?? byDate.set(g.depositDate, []).get(g.depositDate)!).push(g);

  function setGroup(g: DepositGroup, changes: { depositDate?: string; depositConfirmed: boolean }, action: string) {
    const ids = new Set(g.payments.map((p) => p.id));
    update(
      (d) => ({ ...d, payments: d.payments.map((p) => (ids.has(p.id) ? { ...p, ...changes } : p)) }),
      action,
      `${g.depositDate} ${g.channelName} ${g.payments.length} 筆 ${g.totals.net}${changes.depositDate ? ` → ${changes.depositDate}` : ''}`,
    );
  }

  return (
    <>
      <h1>撥款對帳</h1>
      <p className="hint">
        入帳日一律來自智生活入帳報表的「入帳／撥款日」，並依繳費方式分組。請拿存摺或網銀明細逐筆比對「入帳淨額」：
        相符就按「核對相符」；實際入帳日不同時，填入實際日期後按「改日並核對」，系統會自動重算在途存款。
      </p>
      {pending.length > 0 && (
        <div className="banner warn">
          有 {pending.length} 筆繳費（<Money value={pending.reduce((sum, p) => sum + p.amount, 0)} /> 元）報表尚未提供入帳日，目前列為在途存款；之後匯入有入帳日的報表會自動更新。
        </div>
      )}
      <Section title="撥款批次" actions={<MonthInput value={month} onChange={setMonth} />}>
        {groups.length === 0 ? (
          <p className="empty">這個月份沒有預計入帳的款項。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>入帳日</th><th>通路</th><th className="num">筆數</th><th className="num">繳費金額</th><th className="num">手續費</th><th className="num">入帳淨額</th><th>依據</th><th>狀態</th><th>操作</th></tr>
              </thead>
              <tbody>
                {Array.from(byDate.entries()).map(([date, gs]) => (
                  <Fragment key={date}>
                    {gs.map((g) => {
                      const locked = isClosed(g.depositDate);
                      return (
                        <Fragment key={g.key}>
                          <tr className={!g.confirmed && g.depositDate <= today ? 'attention' : ''}>
                            <td>{g.depositDate}</td>
                            <td>
                              <button className="link" onClick={() => setOpen(open === g.key ? '' : g.key)}>{g.channelName} {open === g.key ? '▴' : '▾'}</button>
                              {priorCount(g) > 0 && <span className="tag warn" title="繳費月份早於入帳月份，在上個月月底列為在途存款">含上月在途 {priorCount(g)} 筆</span>}
                            </td>
                            <td className="num">{g.totals.count}</td>
                            <td className="num"><Money value={g.totals.gross} /></td>
                            <td className="num"><Money value={g.totals.fee} /></td>
                            <td className="num"><Money value={g.totals.net} strong /></td>
                            <td>{g.confirmed ? <span className="tag ok">存摺</span> : <span className="tag">報表</span>}</td>
                            <td>
                              {g.confirmed ? <span className="tag ok">已核對</span> : g.partlyConfirmed ? <span className="tag warn">部分核對</span> : g.depositDate <= today ? <span className="tag warn">待核對</span> : <span className="tag">未到期</span>}
                            </td>
                            <td className="row-actions">
                              {locked ? <span className="tag">已結帳</span> : g.confirmed ? (
                                <button className="link" onClick={() => setGroup(g, { depositConfirmed: false }, '取消撥款核對')}>取消核對</button>
                              ) : (
                                <>
                                  <button className="link" onClick={() => setGroup(g, { depositConfirmed: true }, '撥款核對相符')}>核對相符</button>
                                  <input type="date" value={moveTo[g.key] ?? ''} onChange={(e) => setMoveTo({ ...moveTo, [g.key]: e.target.value })} />
                                  <button
                                    className="link"
                                    disabled={!moveTo[g.key] || isClosed(moveTo[g.key])}
                                    onClick={() => setGroup(g, { depositDate: moveTo[g.key], depositConfirmed: true }, '撥款改日核對')}
                                  >改日並核對</button>
                                </>
                              )}
                            </td>
                          </tr>
                          {open === g.key && (
                            <tr className="detail">
                              <td colSpan={9}>
                                <table>
                                  <tbody>
                                    {g.payments.map((p) => (
                                      <tr key={p.id}><td>{p.unitNo}</td><td>{p.payerName}</td><td>{p.billPeriod}</td><td>繳費 {p.paidDate}</td><td>{p.channel}</td><td className="num"><Money value={p.amount} /></td></tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    {gs.length > 1 && (
                      <tr className="subtotal">
                        <td>{date}</td><td>當日合計</td><td></td><td></td><td></td>
                        <td className="num"><Money value={gs.reduce((s, g) => s + g.totals.net, 0)} strong /></td><td colSpan={3}></td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
