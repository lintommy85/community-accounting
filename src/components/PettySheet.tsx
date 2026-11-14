import { formatMoney, PETTY_OTHER } from '../lib/defaults';
import { PettyLedger, spentDateOf } from '../lib/petty';
import { rocYear } from '../lib/statement';
import { AppData } from '../lib/types';

/** 列印用的零用金明細表（和月報同樣的表格樣式）：上月結餘、本月支出與撥補、月底餘額，不附簽章欄。 */
export default function PettySheet({ data, month, ledger, total }: { data: AppData; month: string; ledger: PettyLedger; total: number }) {
  const name = data.settings.communityName.trim();
  const count = ledger.lines.filter((l) => l.expense).length;
  const replenished = ledger.lines.reduce((t, l) => t + l.in, 0);
  const num = (v: number) => `fs-num${v < 0 ? ' fs-neg' : ''}`;

  return (
    <div className="fin-sheet wo-sheet">
      <div className="fs-title">
        <div className="fs-org">{name ? `${name}管理委員會` : '管理委員會'}</div>
        <div className="fs-sub">{rocYear(Number(month.slice(0, 4)))}年{Number(month.slice(5))}月 零用金明細表</div>
      </div>

      <table className="fs-table">
        <colgroup>
          <col style={{ width: '11%' }} /><col style={{ width: '11%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} />
          <col style={{ width: '18%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} /><col style={{ width: '10%' }} />
        </colgroup>
        <thead>
          <tr><th colSpan={8} className="fs-out-head">零用金支出與撥補（零用金總額 {formatMoney(ledger.fund)} 元，本月支出 {count} 筆）</th></tr>
          <tr className="fs-cols">
            <th>輸入日期</th><th>消費日期</th><th>項目</th><th>店家／對象</th><th>備註</th><th className="fs-num">支出</th><th className="fs-num">撥補</th><th className="fs-num">餘額</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>{month}-01</td><td colSpan={6}>上月結餘</td><td className={num(ledger.opening)}>{formatMoney(ledger.opening)}</td></tr>
          {ledger.lines.map((l) =>
            l.expense ? (
              <tr key={l.expense.id}>
                <td>{l.date}</td>
                <td>{spentDateOf(l.expense)}</td>
                <td>{l.expense.category === PETTY_OTHER ? `其他：${l.expense.item}` : l.expense.item}</td>
                <td>{l.expense.payee}</td>
                <td className="fs-note">{l.expense.note}</td>
                <td className="fs-num">{formatMoney(l.out)}</td>
                <td />
                <td className={num(l.balance)}>{formatMoney(l.balance)}</td>
              </tr>
            ) : (
              <tr key={l.replenishment!.id}>
                <td>{l.date}</td>
                <td />
                <td colSpan={3}>零用金撥補（{l.replenishment!.pettyMonth} 使用總額）</td>
                <td />
                <td className="fs-num">{formatMoney(l.in)}</td>
                <td className={num(l.balance)}>{formatMoney(l.balance)}</td>
              </tr>
            ),
          )}
          {count === 0 && <tr><td colSpan={8}>本月沒有零用金支出</td></tr>}
          <tr>
            <td colSpan={5} className="fs-out-total">本月零用金使用總額／月底餘額：</td>
            <td className="fs-num fs-out-total">{formatMoney(total)}</td>
            <td className="fs-num fs-out-total">{replenished ? formatMoney(replenished) : ''}</td>
            <td className={`${num(ledger.closing)} fs-out-total`}>{formatMoney(ledger.closing)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
