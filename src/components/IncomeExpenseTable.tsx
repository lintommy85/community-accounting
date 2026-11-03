import { Statement, StatementLine } from '../lib/statement';
import { Money } from './ui';

function Side({ line, n, split }: { line?: StatementLine; n: number; split?: boolean }) {
  const cls = `${split ? 'ie-split ' : ''}${line?.sub ? 'ie-sub' : ''}`;
  if (!line) return <><td className={cls} />{Array.from({ length: n }, (_, i) => <td key={i} />)}</>;
  return (
    <>
      <th className={cls}>{line.label}</th>
      {line.values.map((v, i) => <td key={i} className={`num${line.sub ? ' ie-sub' : ''}`}><Money value={v} /></td>)}
    </>
  );
}

/** 收支明細表：收入與支出左右並列（與月結的收支明細表同一格式），合計與本期結餘上色。 */
export default function IncomeExpenseTable({ st }: { st: Statement }) {
  const n = st.columns.length;
  const rows = Math.max(st.income.length, st.expense.length, 1);
  const cols = st.columns.map((c) => <th key={c} className="num">{c}</th>);

  return (
    <div className="table-wrap">
      <table className="report ie-table">
        <thead>
          <tr>
            <th colSpan={n + 1} className="ie-in-head">收　入</th>
            <th colSpan={n + 1} className="ie-out-head ie-split">支　出</th>
          </tr>
          <tr>
            <th>收入科目</th>{cols}
            <th className="ie-split">支出科目</th>{cols}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => (
            <tr key={i}>
              <Side line={st.income[i]} n={n} />
              <Side line={st.expense[i]} n={n} split />
            </tr>
          ))}
          <tr className="total">
            <th className="ie-in-total">收入合計</th>
            {st.incomeTotals.map((v, i) => <td key={i} className="num ie-in-total"><Money value={v} strong /></td>)}
            <th className="ie-out-total ie-split">支出合計</th>
            {st.expenseTotals.map((v, i) => <td key={i} className="num ie-out-total"><Money value={v} strong /></td>)}
          </tr>
          <tr className="total">
            <td colSpan={n + 1} className="ie-blank" />
            <th className="ie-net ie-split">本期結餘（收入 - 支出）</th>
            {st.net.map((v, i) => <td key={i} className="num ie-net"><Money value={v} strong /></td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
