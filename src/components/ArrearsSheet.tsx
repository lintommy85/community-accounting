import { ArrearsLine, suggestArrearsLabel } from '../lib/arrears';
import { formatMoney } from '../lib/defaults';
import { rocYear } from '../lib/statement';
import { AppData } from '../lib/types';
import Signatures from './Signatures';

/** 逾期銷帳明細（列印）：每戶逾期銷了哪個月的哪個應繳項目；同一戶的戶別、所有權人只在第一行顯示並合併。 */
export default function ArrearsSheet({ data, month, lines }: { data: AppData; month: string; lines: ArrearsLine[] }) {
  const name = data.settings.communityName.trim();
  const total = lines.reduce((t, l) => t + l.amount, 0);
  const span = new Map<number, number>();
  lines.forEach((l, i) => {
    if (i > 0 && lines[i - 1].unitNo === l.unitNo) return;
    let n = 1;
    while (lines[i + n]?.unitNo === l.unitNo) n++;
    span.set(i, n);
  });
  const units = new Set(lines.map((l) => l.unitNo)).size;

  return (
    <div className="fin-sheet wo-sheet">
      <div className="fs-title">
        <div className="fs-org">{name ? `${name}管理委員會` : '管理委員會'}</div>
        <div className="fs-sub">{rocYear(Number(month.slice(0, 4)))}年{Number(month.slice(5))}月 逾期銷帳明細</div>
      </div>
      <table className="fs-table">
        <thead>
          <tr><th colSpan={7} className="fs-in-head">本月繳款銷到以前月份的應繳（{units} 戶、{lines.length} 筆）</th></tr>
          <tr className="fs-cols"><th>戶別</th><th>所有權人</th><th>繳費日期</th><th>逾期月份</th><th>應繳項目</th><th>報表科目</th><th className="fs-num">金額</th></tr>
        </thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.key}>
              {span.has(i) && <td rowSpan={span.get(i)}>{l.unitNo}</td>}
              {span.has(i) && <td rowSpan={span.get(i)}>{l.owner}</td>}
              <td>{l.paidDate}</td>
              <td>{l.month}</td>
              <td>{l.beforeStart ? `${l.item}（帳務起始月前的帳單）` : l.item}</td>
              <td>{l.label || `${suggestArrearsLabel(l)}（未歸類）`}</td>
              <td className="fs-num">{formatMoney(l.amount)}</td>
            </tr>
          ))}
          {lines.length === 0 && <tr><td colSpan={7}>本月沒有逾期款項</td></tr>}
          <tr><td colSpan={6} className="fs-in-total">逾期款項合計：</td><td className="fs-num fs-in-total">{formatMoney(total)}</td></tr>
        </tbody>
      </table>
      <Signatures />
    </div>
  );
}
