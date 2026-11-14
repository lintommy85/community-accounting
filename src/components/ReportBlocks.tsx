import { Fragment } from 'react';
import { PrepaidTotals } from '../lib/allocation';
import { formatMoney } from '../lib/defaults';
import { ReceivableLine, ReceivableRollForward, reportLabels } from '../lib/receivable';
import { Settings } from '../lib/types';
import { Money } from './ui';

/** sheet 為列印的財務收支總表樣式，否則是收支報表畫面的樣式。 */
type Variant = { settings: Settings; sheet?: boolean };

const Title = ({ text, sheet }: { text: string; sheet?: boolean }) => (sheet ? <div className="fs-section">{text}</div> : <h2 className="statement-block">{text}</h2>);

/** 預收款項變動：月初預收款－本月沖銷＋本期新增預收＝目前預收金額（月底還有預收款的戶數）。 */
export function PrepaidBlock({ totals, settings, sheet }: Variant & { totals: PrepaidTotals }) {
  const L = reportLabels(settings);
  const num = sheet ? 'fs-num' : 'num';
  const heads = [L.ppOpening, `－ ${L.ppUsed}`, `＋ ${L.ppAdded}`, `＝ ${L.ppClosing}（${totals.households} 戶）`];
  const values = [totals.opening, totals.used, totals.added, totals.closing];
  return (
    <>
      <Title text={L.ppTitle} sheet={sheet} />
      <table className={sheet ? 'fs-accounts' : 'report statement-balances'}>
        <thead>
          <tr><th>項目</th>{heads.map((h, i) => <th key={i} className={num}>{h}</th>)}</tr>
        </thead>
        <tbody>
          <tr className={sheet ? 'fs-acc-total' : 'total'}>
            {sheet ? <td>{L.ppRow}</td> : <th>{L.ppRow}</th>}
            {values.map((v, i) => <td key={i} className={num}>{sheet ? formatMoney(v) : <Money value={v} strong={i === 3} />}</td>)}
          </tr>
        </tbody>
      </table>
    </>
  );
}

const op = (l: ReceivableLine) => (l.key === 'arResult' ? '＝ ' : l.sign === 1 ? '＋ ' : l.sign === -1 ? '－ ' : '');

/** 應收（未繳）管理費變動：逐行列出公式，最後一行是本月應收（未繳）管理費累計。 */
export function ReceivableBlock({ rf, settings, sheet }: Variant & { rf: ReceivableRollForward }) {
  const L = reportLabels(settings);
  return (
    <>
      <Title text={L.arTitle} sheet={sheet} />
      <table className={sheet ? 'fs-accounts fs-receivable' : 'report statement-balances receivable-table'}>
        {sheet && <colgroup><col style={{ width: '80%' }} /><col style={{ width: '20%' }} /></colgroup>}
        <thead>
          <tr><th>項目</th><th className={sheet ? 'fs-num' : 'num'}>金額</th></tr>
        </thead>
        <tbody>
          {rf.lines.map((l, i) => {
            const total = l.key === 'arResult';
            return (
              <Fragment key={i}>
                {sheet ? (
                  <tr className={total ? 'fs-acc-total' : ''}><td>{op(l)}{l.label}</td><td className="fs-num">{formatMoney(l.amount)}</td></tr>
                ) : (
                  <tr className={total ? 'total' : ''}><th>{op(l)}{l.label}</th><td className="num"><Money value={l.amount} strong={total} /></td></tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
