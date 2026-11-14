import { PrepaidTotals } from '../lib/allocation';
import { appTitle, formatMoney } from '../lib/defaults';
import { ReceivableRollForward } from '../lib/receivable';
import { MonthReport } from '../lib/ledger';
import { monthSheet, rocYear, SheetLine } from '../lib/statement';
import { AppData } from '../lib/types';
import { PrepaidBlock, ReceivableBlock } from './ReportBlocks';
import Signatures from './Signatures';

const dollars = (n: number) => `$${formatMoney(n)}`;
const sum = (lines: SheetLine[]) => lines.reduce((s, l) => s + l.amount, 0);

function Cells({ line }: { line?: SheetLine }) {
  if (!line) return <><td /><td /><td /><td /><td /></>;
  return (
    <>
      <td>{line.subject}</td>
      <td>{line.item}</td>
      <td>{line.month}</td>
      <td className="fs-note">{line.note}</td>
      <td className="fs-num">{dollars(line.amount)}</td>
    </>
  );
}

function Rows({ income, expense }: { income: SheetLine[]; expense: SheetLine[] }) {
  const n = Math.max(income.length, expense.length, 1);
  return (
    <>
      {Array.from({ length: n }, (_, i) => (
        <tr key={i}>
          <Cells line={income[i]} />
          <Cells line={expense[i]} />
        </tr>
      ))}
    </>
  );
}

/** 列印用的彩色「財務收支總表」（仿智生活格式）：收入與支出左右並排，分固定／非固定，接帳戶匯總、預收款項變動、應收（未繳）管理費變動與簽章。 */
export default function FinanceSheet({ data, month, report, prepaid, receivable }: { data: AppData; month: string; report: MonthReport; prepaid?: PrepaidTotals | null; receivable?: ReceivableRollForward | null }) {
  const s = data.settings;
  const sheet = monthSheet(data, month);
  const fixedIn = sheet.income.filter((l) => l.fixed);
  const varIn = sheet.income.filter((l) => !l.fixed);
  const fixedOut = sheet.expense.filter((l) => l.fixed);
  const varOut = sheet.expense.filter((l) => !l.fixed);
  const totalIn = sum(sheet.income);
  const totalOut = sum(sheet.expense);
  const pl = totalIn - totalOut;
  const balances = report.balances;
  const closingTotal = balances.reduce((t, b) => t + b.closing, 0);
  const now = new Date();
  const stamp = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const name = s.communityName.trim();

  return (
    <div className="fin-sheet">
      <div className="fs-header">
        <div className="fs-brand">
          {s.logo && <img src={s.logo} alt="" />}
          <span>{appTitle(s)}</span>
        </div>
        <div className="fs-stamp">製表日期：{stamp}</div>
      </div>
      <div className="fs-title">
        <div className="fs-org">{name ? `${name}管理委員會` : '管理委員會'}</div>
        <div className="fs-sub">{rocYear(Number(month.slice(0, 4)))}年{Number(month.slice(5))}月 財務收支總表</div>
      </div>

      <table className="fs-table">
        <colgroup>
          <col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '5%' }} /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} />
          <col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '5%' }} /><col style={{ width: '8%' }} /><col style={{ width: '9%' }} />
        </colgroup>
        <thead>
          <tr>
            <th colSpan={5} className="fs-in-head">本期收入</th>
            <th colSpan={5} className="fs-out-head">本期支出</th>
          </tr>
          <tr className="fs-cols">
            <th>科目</th><th>收入項目</th><th>月份</th><th>備註</th><th className="fs-num">金額</th>
            <th>科目</th><th>支出項目</th><th>月份</th><th>備註</th><th className="fs-num">金額</th>
          </tr>
        </thead>
        <tbody>
          <tr className="fs-group"><td colSpan={5}>固 定 收 入</td><td colSpan={5}>固 定 支 出</td></tr>
          <Rows income={fixedIn} expense={fixedOut} />
          <tr className="fs-sub">
            <td colSpan={4} className="fs-in-sub">固定收入小計：</td><td className="fs-num fs-in-sub">{dollars(sum(fixedIn))}</td>
            <td colSpan={4} className="fs-out-sub">固定支出小計：</td><td className="fs-num fs-out-sub">{dollars(sum(fixedOut))}</td>
          </tr>
          <tr className="fs-group"><td colSpan={5}>非 固 定 收 入</td><td colSpan={5}>非 固 定 支 出</td></tr>
          <Rows income={varIn} expense={varOut} />
          <tr className="fs-sub">
            <td colSpan={4} className="fs-in-sub">非固定收入小計：</td><td className="fs-num fs-in-sub">{dollars(sum(varIn))}</td>
            <td colSpan={4} className="fs-out-sub">非固定支出小計：</td><td className="fs-num fs-out-sub">{dollars(sum(varOut))}</td>
          </tr>
          <tr className="fs-total">
            <td colSpan={4} className="fs-in-total">本期收入合計：</td><td className="fs-num fs-in-total">{dollars(totalIn)}</td>
            <td colSpan={4} className="fs-out-total">本期支出合計：</td><td className="fs-num fs-out-total">{dollars(totalOut)}</td>
          </tr>
          <tr className="fs-pl">
            <td colSpan={5} className="fs-blank" />
            <td colSpan={4} className="fs-pl-label">本期損益 (收入 - 支出)：</td>
            <td className={`fs-num fs-pl-value${pl < 0 ? ' fs-neg' : ''}`}>{dollars(pl)}</td>
          </tr>
        </tbody>
      </table>

      <div className="fs-section">帳戶匯總</div>
      <table className="fs-accounts">
        <thead>
          <tr><th>帳戶</th><th className="fs-num">上期餘額</th><th className="fs-num">本月收入</th><th className="fs-num">本月支出</th><th className="fs-num">本期餘額</th></tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.accountId}>
              <td>{b.name}</td>
              <td className="fs-num">{formatMoney(b.opening)}</td>
              <td className="fs-num">{formatMoney(b.inflow)}</td>
              <td className="fs-num">{formatMoney(b.outflow)}</td>
              <td className="fs-num"><strong>{formatMoney(b.closing)}</strong></td>
            </tr>
          ))}
          <tr className="fs-acc-total">
            <td>總計</td>
            <td className="fs-num">{formatMoney(balances.reduce((t, b) => t + b.opening, 0))}</td>
            <td className="fs-num">{formatMoney(balances.reduce((t, b) => t + b.inflow, 0))}</td>
            <td className="fs-num">{formatMoney(balances.reduce((t, b) => t + b.outflow, 0))}</td>
            <td className="fs-num">{formatMoney(closingTotal)}</td>
          </tr>
          {report.closingInTransit.net !== 0 && (
            <>
              <tr><td>在途存款（月底前未入帳）</td><td /><td /><td /><td className="fs-num">{formatMoney(report.closingInTransit.net)}</td></tr>
              <tr className="fs-acc-total"><td>資產合計</td><td /><td /><td /><td className="fs-num">{formatMoney(closingTotal + report.closingInTransit.net)}</td></tr>
            </>
          )}
        </tbody>
      </table>

      {prepaid && <PrepaidBlock totals={prepaid} settings={s} sheet />}
      {receivable && <ReceivableBlock rf={receivable} settings={s} sheet />}
      <Signatures />
    </div>
  );
}
