import { useState } from 'react';
import FinanceSheet from '../components/FinanceSheet';
import IncomeExpenseTable from '../components/IncomeExpenseTable';
import Signatures from '../components/Signatures';
import WriteOffSheet from '../components/WriteOffSheet';
import { useNavArg } from '../components/nav';
import { lastMonth, Money, MonthInput, Section } from '../components/ui';
import { monthEnd } from '../lib/dates';
import { withCommunity } from '../lib/defaults';
import { monthReport } from '../lib/ledger';
import { downloadBlob } from '../lib/storage';
import { Basis, buildStatement, FundFilter, monthPeriods, positionFor, rocYear, StatementLine, yearPeriods } from '../lib/statement';
import { exportStatement } from '../lib/xlsxio';
import { useStore } from '../store';

type Mode = 'month' | 'year';
type PrintMode = 'statement' | 'report' | 'writeoff';

export default function StatementPage() {
  const { data } = useStore();
  const navArg = useNavArg();
  const [mode, setMode] = useState<Mode>('month');
  const [month, setMonth] = useState(/^\d{4}-\d{2}$/.test(navArg) ? navArg : lastMonth());
  const [year, setYear] = useState(Number(lastMonth().slice(0, 4)));
  const [basis, setBasis] = useState<Basis>('paid');
  const [fund, setFund] = useState<FundFilter>('');
  const [printMode, setPrintMode] = useState<PrintMode>('statement');
  const [showDetail, setShowDetail] = useState(false);

  const periods = mode === 'month' ? monthPeriods(month) : yearPeriods(year);
  const st = buildStatement(data, periods, { basis, fund });
  const start = mode === 'month' ? `${month}-01` : `${year}-01-01`;
  const end = mode === 'month' ? monthEnd(month) : `${year}-12-31`;
  const pos = positionFor(data, start, end, fund);
  const r = mode === 'month' ? monthReport(data, month) : null;
  const periodText = mode === 'month' ? `${rocYear(Number(month.slice(0, 4)))}年${Number(month.slice(5))}月` : `${rocYear(year)}年度`;
  const title = withCommunity(data.settings, `${periodText}${fund ? `（${fund}）` : ''}收支報表`);
  const sub = `期間：${start} 至 ${end}　管理費收入認列：${basis === 'paid' ? '住戶繳費日' : '撥入銀行日'}（預收款全額列入收款當期）　單位：新臺幣元`;
  const years = Array.from({ length: 8 }, (_, i) => Number(lastMonth().slice(0, 4)) + 1 - i);
  const wide = mode === 'year';

  function print(m: PrintMode) {
    setPrintMode(m);
    const reset = () => {
      setPrintMode('statement');
      window.removeEventListener('afterprint', reset);
    };
    window.addEventListener('afterprint', reset);
    setTimeout(() => window.print(), 50);
  }

  const lineRows = (lines: StatementLine[]) =>
    lines.map((l) => (
      <tr key={l.label} className={l.sub ? 'sub-line' : ''}>
        <th>{l.label}</th>
        {l.values.map((v, i) => <td key={i} className="num"><Money value={v} /></td>)}
      </tr>
    ));

  return (
    <div className={`print-mode-${printMode}`}>
      {wide && printMode === 'statement' && <style>{'@page { size: A4 landscape; }'}</style>}
      <div className="page-head no-print">
        <h1>收支報表</h1>
        <div className="actions">
          <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
            <option value="month">月報</option>
            <option value="year">年報</option>
          </select>
          {mode === 'month' ? (
            <MonthInput value={month} onChange={setMonth} />
          ) : (
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
              {years.map((y) => <option key={y} value={y}>{rocYear(y)} 年（{y}）</option>)}
            </select>
          )}
          <select value={fund} onChange={(e) => setFund(e.target.value as FundFilter)} title="基金別">
            <option value="">全部帳戶</option>
            <option value="管理費">管理費</option>
            <option value="公共基金">公共基金</option>
            <option value="其他">其他</option>
          </select>
          <select value={basis} onChange={(e) => setBasis(e.target.value as Basis)} title="管理費收入認列方式">
            <option value="paid">依繳費日認列</option>
            <option value="deposit">依入帳日認列</option>
          </select>
          <button onClick={() => downloadBlob(exportStatement(data, title, sub, st, pos), `${title.replace(/\s+/g, '-')}.xlsx`)}>匯出 Excel</button>
          <button className="primary" onClick={() => print('statement')}>列印收支報表</button>
          {r && <button onClick={() => print('report')} title="彩色「財務收支總表」：收入與支出左右並列，附帳戶匯總與簽章">列印月報</button>}
          {r?.writeOff && <button onClick={() => print('writeoff')}>列印管理費銷帳</button>}
        </div>
      </div>

      {r && (
        <div className="print-only print-report">
          <FinanceSheet data={data} month={month} report={r} />
        </div>
      )}

      <section className="card statement-card print-statement">
        <h1 className="statement-title">{title}</h1>
        <p className="statement-sub">{sub}</p>
        {wide ? (
          <div className="table-wrap">
            <table className={`statement report${wide ? ' wide' : ''}`}>
              <thead>
                <tr><th>科目</th>{st.columns.map((c) => <th key={c} className="num">{c}</th>)}</tr>
              </thead>
              <tbody>
                <tr className="st-in"><th colSpan={st.columns.length + 1}>收　入</th></tr>
                {lineRows(st.income)}
                <tr className="total st-in-total"><th>收入合計</th>{st.incomeTotals.map((v, i) => <td key={i} className="num"><Money value={v} strong /></td>)}</tr>
                <tr className="st-out"><th colSpan={st.columns.length + 1}>支　出</th></tr>
                {lineRows(st.expense)}
                <tr className="total st-out-total"><th>支出合計</th>{st.expenseTotals.map((v, i) => <td key={i} className="num"><Money value={v} strong /></td>)}</tr>
                <tr className="total st-net"><th>本期結餘（收入 - 支出）</th>{st.net.map((v, i) => <td key={i} className="num"><Money value={v} strong /></td>)}</tr>
              </tbody>
            </table>
          </div>
        ) : (
          <IncomeExpenseTable st={st} />
        )}

        <h2 className="statement-block">結存表（{end}）</h2>
        <table className="report statement-balances">
          <thead><tr><th>帳戶</th><th className="num">期初結存</th><th className="num">本期存入</th><th className="num">本期支出</th><th className="num">期末結存</th></tr></thead>
          <tbody>
            {pos.balances.map((b) => (
              <tr key={b.accountId}><th>{b.name}</th><td className="num"><Money value={b.opening} /></td><td className="num"><Money value={b.inflow} /></td><td className="num"><Money value={b.outflow} /></td><td className="num"><Money value={b.closing} /></td></tr>
            ))}
            {pos.inTransit !== 0 && <tr><th>在途存款</th><td></td><td></td><td></td><td className="num"><Money value={pos.inTransit} /></td></tr>}
            <tr className="total"><th>資金合計</th><td></td><td></td><td></td><td className="num"><Money value={pos.balances.reduce((s, b) => s + b.closing, 0) + pos.inTransit} strong /></td></tr>
            {pos.prepaid !== 0 && <tr className="sub-line"><th>其中：預收管理費</th><td></td><td></td><td></td><td className="num"><Money value={pos.prepaid} /></td></tr>}
            {pos.suspense !== 0 && <tr className="sub-line"><th>其中：暫收款（尚無應繳可銷帳）</th><td></td><td></td><td></td><td className="num"><Money value={pos.suspense} /></td></tr>}
          </tbody>
        </table>
        <Signatures />
      </section>

      {r?.writeOff && (
        <>
          <Section
            title={`${month} 管理費銷帳`}
            className="no-print"
            actions={<button onClick={() => setShowDetail(!showDetail)}>{showDetail ? '隱藏已繳／未繳明細' : `顯示已繳 ${r.paidList.length} 筆／未繳 ${r.unpaidList.length} 個月`}</button>}
          >
            <table className="report">
              <tbody>
                <tr><th>本月應收管理費（{r.writeOff.units} 戶）</th><td className="num"><Money value={r.writeOff.due} /></td></tr>
                <tr><th>本月已銷帳</th><td className="num"><Money value={r.writeOff.writtenOff} strong /></td></tr>
                <tr className="sub-line"><th>　其中：以前月份預收轉銷</th><td className="num"><Money value={r.writeOff.fromPrepaid} /></td></tr>
                <tr className="sub-line"><th>　其中：本月繳款</th><td className="num"><Money value={r.writeOff.fromCurrent} /></td></tr>
                {r.writeOff.fromLater > 0 && <tr className="sub-line"><th>　其中：月底後補繳</th><td className="num"><Money value={r.writeOff.fromLater} /></td></tr>}
                <tr className="total"><th>本月未繳（{r.writeOff.owingUnits} 戶）</th><td className="num"><Money value={r.writeOff.owing} strong /></td></tr>
              </tbody>
            </table>
            {showDetail && <WriteOffSheet data={data} month={month} report={r} />}
            <p className="hint">「列印管理費銷帳」會印出本月繳費紀錄（已繳）與截至本月尚未繳清的應繳（未繳，每個月分開列出）。</p>
          </Section>
          <div className="print-only print-writeoff">
            <WriteOffSheet data={data} month={month} report={r} printOnly />
          </div>
        </>
      )}
    </div>
  );
}
