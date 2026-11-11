import { BEFORE_START_TEXT, chargeText } from '../lib/allocation';
import { formatMoney } from '../lib/defaults';
import { MonthReport } from '../lib/ledger';
import { rocYear } from '../lib/statement';
import { AppData } from '../lib/types';
import Signatures from './Signatures';

const monthLabel = (m: string) => `${rocYear(Number(m.slice(0, 4)))}/${m.slice(5)}`;

/** 管理費繳費明細：本月繳費紀錄（已繳）與截至本月尚未繳清的應繳（未繳，逐月列出）。 */
export default function WriteOffSheet({ data, month, report, printOnly }: { data: AppData; month: string; report: MonthReport; printOnly?: boolean }) {
  const name = data.settings.communityName.trim();
  const paidTotal = report.paidList.reduce((s, l) => s + l.payment.amount, 0);
  const owingTotal = report.unpaidList.reduce((s, l) => s + l.owing, 0);
  const owingUnits = new Set(report.unpaidList.map((l) => l.unitNo)).size;

  return (
    <div className="fin-sheet wo-sheet">
      {printOnly && (
        <div className="fs-title">
          <div className="fs-org">{name ? `${name}管理委員會` : '管理委員會'}</div>
          <div className="fs-sub">{rocYear(Number(month.slice(0, 4)))}年{Number(month.slice(5))}月 管理費繳費明細</div>
        </div>
      )}

      <table className="fs-table">
        <thead>
          <tr><th colSpan={7} className="fs-in-head">已繳（本月繳費紀錄 {report.paidList.length} 筆）</th></tr>
          <tr className="fs-cols"><th>戶別</th><th>所有權人</th><th>繳費日期</th><th>繳費方式</th><th>期別</th><th>銷帳月份</th><th className="fs-num">繳費金額</th></tr>
        </thead>
        <tbody>
          {report.paidList.map((l) => (
            <tr key={l.payment.id}>
              <td>{l.payment.unitNo}</td>
              <td>{l.owner}</td>
              <td>{l.payment.paidDate}</td>
              <td>{l.payment.channel}</td>
              <td>{l.payment.billPeriod}</td>
              <td>
                {l.allocations.map((a) => `${monthLabel(a.month)} ${formatMoney(a.amount)}`).join('、')}
                {l.credit ? `${l.allocations.length ? '、' : ''}${l.pending ? '暫收' : '預收'} ${formatMoney(l.credit)}` : ''}
                {l.beforeStart ? BEFORE_START_TEXT : ''}
                {chargeText(l.charges, l.allocations.length > 0 || l.credit !== 0)}
              </td>
              <td className="fs-num">{formatMoney(l.payment.amount)}</td>
            </tr>
          ))}
          {report.paidList.length === 0 && <tr><td colSpan={7}>本月沒有繳費紀錄</td></tr>}
          <tr><td colSpan={6} className="fs-in-total">已繳合計：</td><td className="fs-num fs-in-total">{formatMoney(paidTotal)}</td></tr>
        </tbody>
      </table>

      <table className="fs-table wo-unpaid">
        <thead>
          <tr><th colSpan={6} className="fs-out-head">未繳（截至 {monthLabel(month)}，{owingUnits} 戶、{report.unpaidList.length} 個月，逐月列出）</th></tr>
          <tr className="fs-cols"><th>戶別</th><th>所有權人</th><th>月份</th><th className="fs-num">應繳</th><th className="fs-num">已繳</th><th className="fs-num">未繳</th></tr>
        </thead>
        <tbody>
          {report.unpaidList.map((l) => (
            <tr key={`${l.unitNo}-${l.month}`}>
              <td>{l.unitNo}</td>
              <td>{l.owner}</td>
              <td>{monthLabel(l.month)}{l.month < month ? <span className="wo-overdue">逾期</span> : ''}</td>
              <td className="fs-num">{formatMoney(l.due)}</td>
              <td className="fs-num">{l.paid ? formatMoney(l.paid) : ''}</td>
              <td className="fs-num">{formatMoney(l.owing)}</td>
            </tr>
          ))}
          {report.unpaidList.length === 0 && <tr><td colSpan={6}>沒有未繳</td></tr>}
          <tr><td colSpan={5} className="fs-out-total">未繳合計：</td><td className="fs-num fs-out-total">{formatMoney(owingTotal)}</td></tr>
        </tbody>
      </table>
      {printOnly && <Signatures />}
    </div>
  );
}
