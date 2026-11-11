import { useMemo, useState } from 'react';
import FirstSetupGuide from '../components/FirstSetupGuide';
import type { Go } from '../components/nav';
import HouseholdSetup from '../components/HouseholdSetup';
import UnitCard from '../components/UnitCard';
import { Money, Section, thisMonth } from '../components/ui';
import { Icon } from '../components/icons';
import { allocateAll, dueFor, summarizeUnit, UnitSummary } from '../lib/allocation';
import { addMonths, monthRange } from '../lib/dates';
import { fileBase, withCommunity } from '../lib/defaults';
import { downloadBlob } from '../lib/storage';
import { exportUnitSummaries } from '../lib/xlsxio';
import { ownerHistory, ownerMatches } from '../lib/owners';
import { useStore } from '../store';

type View = 'units' | 'matrix';

export default function ArrearsPage({ go }: { go: Go }) {
  const { data } = useStore();
  const s = data.settings;
  const alloc = useMemo(() => allocateAll(data), [data]);
  const [view, setView] = useState<View>('units');
  const [to, setTo] = useState(thisMonth());
  const [fromInput, setFrom] = useState('');
  const [q, setQ] = useState('');
  const [onlyOwing, setOnlyOwing] = useState(false);
  const [cardKey, setCardKey] = useState('');
  const [notice, setNotice] = useState<UnitSummary | null>(null);
  const [editSetup, setEditSetup] = useState(false);

  if (!s.units.some((u) => !u.deletedAt)) {
    return (
      <>
        <h1>欠費／銷帳</h1>
        <FirstSetupGuide go={go} />
      </>
    );
  }

  if (!s.totalUnits || editSetup) {
    return (
      <>
        <h1>欠費／銷帳</h1>
        <Section title={s.totalUnits ? '修改戶數設定' : '第一步：設定總戶數'}>
          <HouseholdSetup onDone={editSetup ? () => setEditSetup(false) : undefined} />
        </Section>
      </>
    );
  }

  const card = cardKey ? alloc.byKey.get(cardKey) : undefined;
  if (card) return <UnitCard account={card} startMonth={alloc.startMonth} onBack={() => setCardKey('')} />;
  if (notice) return <Notice summary={notice} onBack={() => setNotice(null)} />;

  const from = fromInput || [alloc.startMonth, addMonths(thisMonth(), -11)].sort().reverse()[0];
  const months = monthRange(from, to);
  const summaries = alloc.accounts.map((a) => summarizeUnit(a, from, to));
  const kw = q.trim().toUpperCase();
  const shown = summaries
    .filter((r) => !onlyOwing || r.owing > 0)
    .filter((r) => !kw || r.account.unit.unitNo.toUpperCase().includes(kw) || ownerMatches(r.account.unit, kw));
  const totals = shown.reduce(
    (t, r) => ({ due: t.due + r.due, paid: t.paid + r.paid, owing: t.owing + r.owing, prepaid: t.prepaid + r.prepaid, received: t.received + r.received }),
    { due: 0, paid: 0, owing: 0, prepaid: 0, received: 0 },
  );
  const owingUnits = summaries.filter((r) => r.owing > 0).length;
  const unitCount = s.units.filter((u) => !u.deletedAt).length;
  const missing = s.totalUnits - unitCount;

  return (
    <>
      <div className="page-head no-print">
        <h1>欠費／銷帳</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={view === 'units'} className={view === 'units' ? 'primary' : ''} onClick={() => setView('units')}>戶別明細</button>
          <button role="tab" aria-selected={view === 'matrix'} className={view === 'matrix' ? 'primary' : ''} onClick={() => setView('matrix')}>月份總表</button>
        </div>
      </div>

      <div className={`banner ${missing ? 'warn' : ''} no-print`}>
        <span>
          總戶數 {s.totalUnits} 戶，已建立戶別 {unitCount} 戶
          {missing > 0 && `，還差 ${missing} 戶`}
          {missing < 0 && `，比總戶數多 ${-missing} 戶`}
          。銷帳起始月 {alloc.startMonth}。
        </span>
        <span className="actions">
          <button onClick={() => setEditSetup(true)}>修改戶數／起始月</button>
          <button onClick={() => go('units')}>編輯戶別與月費</button>
        </span>
      </div>

      <Section
        title={`${from} 至 ${to}：${owingUnits} 戶欠繳`}
        actions={
          <div className="form-row">
            <input type="month" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} /> 至
            <input type="month" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} />
            <input placeholder="搜尋戶別／所有權人" value={q} onChange={(e) => setQ(e.target.value)} />
            <label className="check"><input type="checkbox" checked={onlyOwing} onChange={(e) => setOnlyOwing(e.target.checked)} /> 只顯示欠繳戶</label>
            <button onClick={() => downloadBlob(exportUnitSummaries(data, shown, from, to), `${fileBase(s)}-戶別繳費明細-${from}_${to}.xlsx`)}><Icon name="download" />匯出 Excel</button>
          </div>
        }
      >
        {view === 'units' ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>戶別</th><th>所有權人</th><th className="num">月費</th><th className="num">期間應繳</th><th className="num">已銷帳</th>
                  <th className="num">未繳</th><th className="num">期間繳款</th><th className="num">預繳／暫收</th><th>已繳至</th><th>最後繳費</th><th></th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.account.key} className={r.owing ? 'attention' : ''}>
                    <td><button className="link" onClick={() => setCardKey(r.account.key)}>{r.account.unit.unitNo}</button></td>
                    <td>{r.account.unit.owner}{ownerHistory(r.account.unit).length > 1 && <span className="tag warn" title="所有權人有變更，點戶別看帳卡的所有權人紀錄">曾變更</span>}</td>
                    <td className="num"><Money value={r.account.unit.monthlyFee} /></td>
                    <td className="num"><Money value={r.due} /></td>
                    <td className="num"><Money value={r.paid} /></td>
                    <td className="num">{r.owing ? <><Money value={r.owing} strong />（{r.owingMonths.length}期）</> : ''}</td>
                    <td className="num"><Money value={r.received} /></td>
                    <td className="num">{r.prepaid ? <Money value={r.prepaid} /> : ''}</td>
                    <td>{r.paidThrough}</td>
                    <td>{r.lastPaidDate}</td>
                    <td className="row-actions">
                      <button className="link" onClick={() => setCardKey(r.account.key)}>帳卡</button>
                      {r.owing > 0 && <button className="link danger" onClick={() => setNotice(r)}>催繳單</button>}
                    </td>
                  </tr>
                ))}
                <tr className="total">
                  <th>合計</th><td>{shown.length} 戶</td><td></td>
                  <td className="num"><Money value={totals.due} strong /></td>
                  <td className="num"><Money value={totals.paid} strong /></td>
                  <td className="num"><Money value={totals.owing} strong /></td>
                  <td className="num"><Money value={totals.received} strong /></td>
                  <td className="num"><Money value={totals.prepaid} strong /></td>
                  <td colSpan={3}></td>
                </tr>
              </tbody>
            </table>
            <p className="hint">「已銷帳」是銷到期間內各月的金額；「期間繳款」是期間內實際繳費的金額（含預繳後面月份的部分）。點戶別可看帳卡並手動調整銷帳。</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="matrix">
              <thead>
                <tr><th>戶別</th><th>所有權人</th>{months.map((m) => <th key={m}>{m.slice(2).replace('-', '/')}</th>)}<th className="num">未繳</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.account.key}>
                    <td><button className="link" onClick={() => setCardKey(r.account.key)}>{r.account.unit.unitNo}</button></td>
                    <td>{r.account.unit.owner}{ownerHistory(r.account.unit).length > 1 && <span className="tag warn" title="所有權人有變更，點戶別看帳卡的所有權人紀錄">曾變更</span>}</td>
                    {months.map((m) => {
                      const due = dueFor(r.account, m);
                      const paid = r.account.paidByMonth.get(m) ?? 0;
                      const cls = due === 0 ? '' : paid >= due ? 'paid' : paid > 0 ? 'partial' : 'owing';
                      return <td key={m} className={`cell ${cls}`} title={`應繳 ${due}／已銷 ${paid}`}>{due === 0 ? '' : paid >= due ? '✓' : paid > 0 ? paid : '✗'}</td>;
                    })}
                    <td className="num">{r.owing ? <Money value={r.owing} strong /> : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {alloc.unmatched.length > 0 && (
        <Section title={`無法對應戶別的繳費紀錄（${alloc.unmatched.length} 筆）`}>
          <p className="hint">
            以下戶別不在戶別清單中，沒有列入銷帳：{Array.from(new Set(alloc.unmatched.map((p) => p.unitNo || '（空白）'))).join('、')}。
            請到「修改戶數／起始月」帶入戶別，或在「戶別與月費」修正寫法。
          </p>
        </Section>
      )}
    </>
  );
}

function Notice({ summary, onBack }: { summary: UnitSummary; onBack: () => void }) {
  const { data } = useStore();
  const unit = summary.account.unit;
  return (
    <>
      <div className="no-print page-head">
        <button onClick={onBack}>← 返回</button>
        <button className="primary" onClick={() => window.print()}><Icon name="printer" />列印催繳通知</button>
      </div>
      <div className="notice">
        <h1>{withCommunity(data.settings, '管理費繳費通知')}</h1>
        <p>{unit.unitNo} {unit.owner} 住戶您好：</p>
        <p>經查 貴戶下列期別之管理費尚未繳清，敬請於收到本通知後儘速繳納。如已繳納，請忽略本通知並向管理中心提供繳費證明，謝謝。</p>
        <table className="report">
          <thead><tr><th>期別</th><th className="num">應繳</th><th className="num">已繳</th><th className="num">未繳</th></tr></thead>
          <tbody>
            {summary.owingMonths.map((m) => {
              const due = dueFor(summary.account, m);
              const paid = summary.account.paidByMonth.get(m) ?? 0;
              return <tr key={m}><td>{m}</td><td className="num"><Money value={due} /></td><td className="num"><Money value={paid} /></td><td className="num"><Money value={due - paid} /></td></tr>;
            })}
            <tr className="total"><th>合計</th><td></td><td></td><td className="num"><Money value={summary.owing} strong /></td></tr>
          </tbody>
        </table>
        {summary.owingMonths.length >= 2 && <p className="hint">依公寓大廈管理條例第 21 條，積欠管理費達二期以上，經定相當期間催告仍不給付者，管理委員會得訴請法院命其給付應繳之金額及遲延利息。</p>}
        <p className="sign">{withCommunity(data.settings, '管理委員會')} 敬啟　　　年　　月　　日</p>
      </div>
    </>
  );
}
