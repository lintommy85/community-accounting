import { isOpeningPayment, PrepaidRow, PrepaidUse } from '../lib/allocation';
import { formatMoney } from '../lib/defaults';
import { rocYear } from '../lib/statement';
import { AppData } from '../lib/types';
import Signatures from './Signatures';

const SOURCE_LABEL = { manual: '手動指定', period: '依期別', offset: '帳單沖銷', auto: '自動銷帳' } as const;

/** 預收款項銷帳紀錄：逐戶的預收款增減，以及本月由預收款沖銷的明細。 */
export default function PrepaidSheet({ data, month, rows, uses, printOnly }: { data: AppData; month: string; rows: PrepaidRow[]; uses: PrepaidUse[]; printOnly?: boolean }) {
  const name = data.settings.communityName.trim();
  const sum = (f: (r: PrepaidRow) => number) => rows.reduce((t, r) => t + f(r), 0);
  const usedTotal = uses.reduce((t, u) => t + u.amount, 0);

  return (
    <div className="fin-sheet wo-sheet">
      {printOnly && (
        <div className="fs-title">
          <div className="fs-org">{name ? `${name}管理委員會` : '管理委員會'}</div>
          <div className="fs-sub">{rocYear(Number(month.slice(0, 4)))}年{Number(month.slice(5))}月 預收款項銷帳紀錄</div>
        </div>
      )}

      <table className="fs-table">
        <thead>
          <tr><th colSpan={6} className="fs-in-head">預收款增減（{rows.length} 戶）</th></tr>
          <tr className="fs-cols"><th>戶別</th><th>所有權人</th><th className="fs-num">上月底預收款</th><th className="fs-num">本月新增（預繳、多繳）</th><th className="fs-num">本月沖銷</th><th className="fs-num">本月底剩餘預收款</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.unitNo}>
              <td>{r.unitNo}</td>
              <td>{r.owner}</td>
              <td className="fs-num">{r.opening ? formatMoney(r.opening) : ''}</td>
              <td className="fs-num">{r.added ? formatMoney(r.added) : ''}</td>
              <td className="fs-num">{r.used ? formatMoney(r.used) : ''}</td>
              <td className="fs-num">{formatMoney(r.closing)}</td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={6}>本月沒有預收款</td></tr>}
          <tr>
            <td colSpan={2} className="fs-in-total">合計：</td>
            <td className="fs-num fs-in-total">{formatMoney(sum((r) => r.opening))}</td>
            <td className="fs-num fs-in-total">{formatMoney(sum((r) => r.added))}</td>
            <td className="fs-num fs-in-total">{formatMoney(sum((r) => r.used))}</td>
            <td className="fs-num fs-in-total">{formatMoney(sum((r) => r.closing))}</td>
          </tr>
        </tbody>
      </table>

      <table className="fs-table wo-unpaid">
        <thead>
          <tr><th colSpan={5} className="fs-out-head">本月沖銷明細（{uses.length} 筆，以前繳的預收款銷到本月）</th></tr>
          <tr className="fs-cols"><th>戶別</th><th>所有權人</th><th>預收款來源</th><th>沖銷方式</th><th className="fs-num">沖銷金額</th></tr>
        </thead>
        <tbody>
          {uses.map((u, i) => (
            <tr key={`${u.payment.id}-${i}`}>
              <td>{u.unitNo}</td>
              <td>{u.owner}</td>
              <td>{isOpeningPayment(u.payment.id) ? '期初預收款（啟用前預繳）' : `${u.payment.paidDate} ${u.payment.channel}${u.payment.billPeriod ? `（期別 ${u.payment.billPeriod}）` : ''}`}</td>
              <td>{SOURCE_LABEL[u.source]}</td>
              <td className="fs-num">{formatMoney(u.amount)}</td>
            </tr>
          ))}
          {uses.length === 0 && <tr><td colSpan={5}>本月沒有由預收款沖銷的款項</td></tr>}
          <tr><td colSpan={4} className="fs-out-total">沖銷合計：</td><td className="fs-num fs-out-total">{formatMoney(usedTotal)}</td></tr>
        </tbody>
      </table>
      {printOnly && <Signatures />}
    </div>
  );
}
