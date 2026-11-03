import { useMemo, useState } from 'react';
import type { Go } from './nav';
import { normUnit } from '../lib/allocation';
import { PRIOR_ITEM } from '../lib/dues';
import { activeUnits, cycleLabel, sortUnits, unitBaseline } from '../lib/fees';
import { ownerAt, ownerMatches } from '../lib/owners';
import { Due } from '../lib/types';
import { useStore } from '../store';
import { Money, MonthInput, Section, thisMonth } from './ui';

/** 每月應繳（只能查看）：應繳一律由匯入智生活管理費匯入範本更新，這裡列出各戶基準、帳單金額與拆出的本月應繳。 */
export default function MonthDues({ go }: { go: Go }) {
  const { data } = useStore();
  const s = data.settings;
  const [month, setMonth] = useState(thisMonth());
  const [q, setQ] = useState('');
  const [onlyIssue, setOnlyIssue] = useState(false);

  const dueMap = useMemo(() => {
    const m = new Map<string, Due[]>();
    for (const d of data.dues) if (d.month === month || d.fromBill === month) (m.get(normUnit(d.unitNo)) ?? m.set(normUnit(d.unitNo), []).get(normUnit(d.unitNo))!).push(d);
    return m;
  }, [data.dues, month]);
  const kw = q.trim().toUpperCase();
  const units = sortUnits(activeUnits(s.units));
  const rows = units.map((u) => {
    const items = dueMap.get(normUnit(u.unitNo)) ?? [];
    const current = items.filter((d) => d.month === month);
    const due = current.reduce((sum, d) => sum + d.amount, 0);
    const billRows = current.filter((d) => !d.fromBill);
    const bill = billRows.reduce((sum, d) => sum + (d.billAmount ?? d.amount), 0);
    // 這張帳單拆出的應繳：本月份＋季繳／年繳的其他週期月份
    const covered = billRows.reduce((sum, d) => sum + d.amount, 0) + items.filter((d) => d.fromBill === month && d.item !== PRIOR_ITEM).reduce((sum, d) => sum + d.amount, 0);
    const prior = items.filter((d) => d.fromBill === month && d.item === PRIOR_ITEM).reduce((sum, d) => sum + d.amount, 0);
    const inCycle = current.find((d) => d.fromBill && d.item !== PRIOR_ITEM)?.fromBill;
    const base = unitBaseline(u, s.feePlans);
    const issue = !base && !current.length ? '未設定基準' : !current.length ? '尚未匯入' : billRows.length && bill < covered ? '帳單低於基準' : '';
    return { u, current, due, bill, covered, hasBill: billRows.length > 0, carried: Math.max(0, bill - covered), prior, inCycle, base, issue };
  });
  const shown = rows
    .filter((r) => !kw || r.u.unitNo.toUpperCase().includes(kw) || ownerMatches(r.u, kw))
    .filter((r) => !onlyIssue || r.issue);
  const billed = rows.filter((r) => r.current.length).length;
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((t, r) => t + f(r), 0);

  return (
    <Section title="每月應繳（只能查看）" actions={<MonthInput value={month} onChange={setMonth} />}>
      <p className="hint">
        應繳只能由「匯入智生活報表 → 每月應繳報表」更新，這裡不能修改。智生活會把逾期加在當期帳單上，
        所以本期應繳採用「基準與費率」設定的基準（方案＋加收），帳單超過基準的部分是帳單內含的逾期，不會重複列為應繳；已匯入的月份保留當時的基準，之後調整費率不影響；
        系統沒有的逾期記為上個月的「{PRIOR_ITEM}」。季繳、年繳的帳單會把基準分到週期內每個月。
      </p>
      <div className={`banner ${billed < units.length ? 'warn' : 'ok'}`}>
        <span>
          {month}：已匯入 {billed}／{units.length} 戶，帳單合計 <Money value={sum((r) => r.bill)} strong /> 元，
          其中本月應繳 <Money value={sum((r) => r.due)} strong /> 元、帳單內含逾期 <Money value={sum((r) => r.carried)} /> 元
          {sum((r) => r.prior) ? <>（前期欠款 <Money value={sum((r) => r.prior)} /> 元）</> : ''}
        </span>
        <button onClick={() => go('import', 'dues')}>匯入每月應繳報表 →</button>
      </div>
      <div className="form-row">
        <input placeholder="搜尋戶別代碼或所有權人，例如 A01、35號2樓" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check"><input type="checkbox" checked={onlyIssue} onChange={(e) => setOnlyIssue(e.target.checked)} /> 只顯示需要注意的戶別</label>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>戶別</th><th>所有權人</th><th>繳費週期</th><th className="num" title="已匯入的月份顯示匯入時採用的基準；尚未匯入顯示目前基準">本期基準</th><th className="num">智生活帳單</th>
              <th className="num">帳單內含逾期</th><th className="num">本月應繳</th><th>項目</th><th>提醒</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.u.id} className={r.issue && r.issue !== '尚未匯入' ? 'attention' : ''}>
                <td>{r.u.unitNo}</td>
                <td>{ownerAt(r.u, month)}{ownerAt(r.u, month) !== r.u.owner && <span className="tag" title={`目前所有權人：${r.u.owner}`}>現為 {r.u.owner}</span>}</td>
                <td>{cycleLabel(r.u)}</td>
                <td className="num">{r.hasBill ? <Money value={r.covered} /> : r.inCycle ? '' : <span className="muted"><Money value={r.base * (r.u.cycle ?? 1)} /></span>}</td>
                <td className="num">{r.hasBill ? <Money value={r.bill} /> : r.inCycle ? <span className="muted small">含於 {r.inCycle} 帳單</span> : ''}</td>
                <td className="num">{r.carried ? <Money value={r.carried} /> : ''}{r.prior ? <div className="muted small">前期欠款 {r.prior.toLocaleString('zh-TW')}</div> : null}</td>
                <td className="num">{r.current.length ? <Money value={r.due} strong /> : ''}</td>
                <td>
                  <div className="due-items">
                    {r.current.map((d) => (
                      <span key={d.id} className={`due-chip ${d.amount < 0 ? 'neg' : ''} ${d.kind === 'arrears' || d.kind === 'prepaid' ? 'muted' : ''}`} title={d.kind === 'arrears' ? '帳單內含逾期，不列應繳' : d.kind === 'prepaid' ? '由預收款銷帳，不減少應繳' : d.billAmount !== undefined && d.billAmount !== d.amount ? `帳單 ${d.billAmount.toLocaleString('zh-TW')}` : undefined}>
                        {d.item} {(d.kind === 'arrears' || d.kind === 'prepaid' ? d.billAmount ?? 0 : d.amount).toLocaleString('zh-TW')}
                      </span>
                    ))}
                  </div>
                </td>
                <td>{r.issue && <span className={`tag ${r.issue === '尚未匯入' ? '' : 'warn'}`}>{r.issue}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && <p className="empty">沒有符合的戶別。</p>}
      </div>
    </Section>
  );
}
