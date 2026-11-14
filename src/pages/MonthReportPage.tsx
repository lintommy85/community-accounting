import { useState } from 'react';
import IncomeExpenseTable from '../components/IncomeExpenseTable';
import type { Go } from '../components/nav';
import { Money, MonthInput, Section, thisMonth } from '../components/ui';
import { Icon } from '../components/icons';
import { localDate } from '../lib/dates';
import { fileBase, formatMoney } from '../lib/defaults';
import { monthReport, Totals } from '../lib/ledger';
import { buildStatement, monthPeriods } from '../lib/statement';
import { downloadBlob } from '../lib/storage';
import { exportMonthReport } from '../lib/xlsxio';
import { useStore } from '../store';

function Row({ label, t, strong }: { label: string; t: Totals; strong?: boolean }) {
  return (
    <tr className={strong ? 'total' : ''}>
      <th>{label}</th>
      <td className="num">{t.count}</td>
      <td className="num"><Money value={t.gross} strong={strong} /></td>
      <td className="num"><Money value={t.fee} /></td>
      <td className="num"><Money value={t.net} strong={strong} /></td>
    </tr>
  );
}

export default function MonthReportPage({ go }: { go: Go }) {
  const { data, update } = useStore();
  const [month, setMonth] = useState(thisMonth());
  const r = monthReport(data, month);
  const closed = data.closes.find((c) => c.month === month);
  const unconfirmed = data.payments.filter((p) => !p.voided && !p.depositConfirmed && p.depositDate >= r.start && p.depositDate <= r.end);

  function closeMonth() {
    const warn = unconfirmed.length ? `\n\n注意：本月仍有 ${unconfirmed.length} 筆入帳尚未核對存摺。` : '';
    if (!confirm(`確定結帳 ${month}？結帳後此月份的繳費、入帳日與收支分錄將無法修改。${warn}`)) return;
    update(
      (d) => ({
        ...d,
        closes: [...d.closes.filter((c) => c.month !== month), { month, closedAt: new Date().toISOString(), inTransit: r.closingInTransit.gross, deposited: r.deposited.net, note: '' }],
      }),
      '月結',
      `${month} 在途 ${r.closingInTransit.gross}`,
    );
  }

  function reopen() {
    if (!confirm(`解除 ${month} 的月結鎖定？已公告的報表可能需要重新公告。`)) return;
    update((d) => ({ ...d, closes: d.closes.filter((c) => c.month !== month) }), '解除月結', month);
  }

  const incomeSection = (
    <Section title="一、收支明細表" className="no-print">
      <IncomeExpenseTable st={buildStatement(data, monthPeriods(month).slice(0, 1), { basis: 'paid', fund: '' })} />
      <p className="hint">管理費收入以住戶繳費日全額認列，預收款列入收款當月；含在途存款。</p>
    </Section>
  );

  return (
    <>
      <div className="page-head no-print">
        <h1>月結／在途存款</h1>
        <div className="actions">
          <MonthInput value={month} onChange={setMonth} />
          <button onClick={() => downloadBlob(exportMonthReport(data, r), `${fileBase(data.settings)}-${month}-月報.xlsx`)}><Icon name="download" />匯出 Excel</button>
          <button onClick={() => go('statement', month)}>列印月報／管理費銷帳 →</button>
          {closed ? <button onClick={reopen}>解除月結</button> : <button className="primary" onClick={closeMonth}>結帳鎖定</button>}
        </div>
      </div>
      {closed && <div className="banner ok no-print">此月份已於 {localDate(closed.closedAt)} 結帳鎖定。</div>}
      {r.checkDiff !== 0 && <div className="banner err">勾稽不平：差額 {formatMoney(r.checkDiff)} 元，請檢查入帳日早於繳費日的資料。</div>}
      {unconfirmed.length > 0 && <div className="banner warn no-print">本月有 {unconfirmed.length} 筆入帳尚未核對存摺。</div>}

      {incomeSection}

      <Section title="二、管理費入帳及在途存款" className="no-print">
        <table className="report">
          <thead><tr><th></th><th className="num">筆數</th><th className="num">繳費金額</th><th className="num">手續費</th><th className="num">入帳淨額</th></tr></thead>
          <tbody>
            <Row label="上月底在途存款" t={r.openingInTransit} />
            <Row label="＋ 本月住戶繳費" t={r.received} />
            <Row label="－ 本月撥入銀行" t={r.deposited} />
            <Row label="　其中：上月在途本月入帳" t={r.depositedFromPrior} />
            <Row label="＝ 本月底在途存款" t={r.closingInTransit} strong />
          </tbody>
        </table>
        <p className="hint">繳費當月月底前沒有撥入銀行的款項列為在途存款，下個月撥款入帳後自動沖銷。</p>
      </Section>

      <Section title="三、結存表" className="no-print">
        <table className="report">
          <thead><tr><th>帳戶</th><th className="num">上月結存</th><th className="num">本月存入</th><th className="num">本月支出</th><th className="num">本月結存</th></tr></thead>
          <tbody>
            {r.balances.map((b) => (
              <tr key={b.accountId}><th>{b.name}</th><td className="num"><Money value={b.opening} /></td><td className="num"><Money value={b.inflow} /></td><td className="num"><Money value={b.outflow} /></td><td className="num"><Money value={b.closing} /></td></tr>
            ))}
            <tr><th>在途存款</th><td></td><td></td><td></td><td className="num"><Money value={r.closingInTransit.net} /></td></tr>
            <tr className="total"><th>資產合計</th><td></td><td></td><td></td><td className="num"><Money value={r.balances.reduce((s, b) => s + b.closing, 0) + r.closingInTransit.net} strong /></td></tr>
            {r.prepaid !== 0 && <tr className="sub-line"><th>其中：預收管理費（已入帳，待以後月份銷帳）</th><td></td><td></td><td></td><td className="num"><Money value={r.prepaid} /></td></tr>}
            {r.suspense !== 0 && <tr className="sub-line"><th>其中：暫收款（已入帳，期別的每月應繳還沒匯入）</th><td></td><td></td><td></td><td className="num"><Money value={r.suspense} /></td></tr>}
          </tbody>
        </table>
        <p className="hint no-print">銀行帳戶的「本月結存」應與存摺餘額相同；若不同，請到「撥款對帳」確認實際入帳日，或檢查收支記帳是否漏登（例如利息、銀行手續費）。</p>
      </Section>

      <p className="hint no-print">月報（彩色財務收支總表）與管理費銷帳的列印與銷帳統計，請到「收支報表」選擇月報後列印。<button className="link" onClick={() => go('statement', month)}>前往收支報表</button></p>
    </>
  );
}
