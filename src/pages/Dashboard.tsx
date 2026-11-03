import type { PageKey } from '../App';
import type { Go } from '../components/nav';
import CommunityProfile from '../components/CommunityProfile';
import { lastMonth, Section, Stat, thisMonth } from '../components/ui';
import { todayStr } from '../lib/dates';
import { resolveDepositAccountId } from '../lib/defaults';
import { activeUnits } from '../lib/fees';
import { accountBalances, depositGroups, monthReport } from '../lib/ledger';
import { useStore } from '../store';

export default function Dashboard({ go }: { go: Go }) {
  const { data, fileStatus } = useStore();
  const today = todayStr();
  const month = thisMonth();
  const r = monthReport(data, month);
  const monthIncome = r.received.gross + r.income.reduce((sum, i) => sum + i.amount, 0);
  const monthExpense = r.expense.reduce((sum, i) => sum + i.amount, 0);
  const bankIds = new Set(data.settings.accounts.filter((a) => a.kind === 'bank').map((a) => a.id));
  const bankBalances = accountBalances(data, today).filter((b) => bankIds.has(b.accountId));
  const bankTotal = bankBalances.reduce((sum, b) => sum + b.closing, 0);
  const prevReport = monthReport(data, lastMonth());
  const units = activeUnits(data.settings.units);
  const overdue = depositGroups(data.payments).filter((g) => g.depositDate <= today && !g.confirmed);
  const lastBackup = [...data.audit].reverse().find((a) => a.action === '下載備份');
  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup.at)) / 86400000) : null;
  const lastImport = data.batches[data.batches.length - 1];

  const todos: { text: string; page: PageKey; arg?: string }[] = [];
  if (!data.settings.communityName) todos.push({ text: '尚未輸入社區名稱（可直接在上方輸入）', page: 'home' });
  if (!resolveDepositAccountId(data.settings)) todos.push({ text: '有多個銀行帳戶，請指定管理費撥款要轉入哪個帳戶', page: 'settings' });
  if (units.length && !data.dues.some((d) => d.month === month)) todos.push({ text: `${month} 尚未匯入每月應繳（智生活管理費匯入範本）`, page: 'import', arg: 'dues' });
  if (data.settings.accounts.every((a) => !a.openingDate)) todos.push({ text: '尚未設定帳戶期初餘額與期初日期', page: 'settings' });
  if (!data.settings.totalUnits) todos.push({ text: '尚未設定總戶數（欠費／銷帳需要）', page: 'arrears' });
  else if (units.length !== data.settings.totalUnits) todos.push({ text: `戶別已建立 ${units.length}／${data.settings.totalUnits} 戶`, page: 'arrears' });
  if (fileStatus !== 'linked' && fileStatus !== 'service') todos.push({ text: '資料只存在瀏覽器內，建議改用「社區帳務管理.exe」開啟', page: 'backup' });
  if (daysSinceBackup === null || daysSinceBackup > 30) todos.push({ text: daysSinceBackup === null ? '從未下載備份檔' : `已 ${daysSinceBackup} 天未下載備份`, page: 'backup' });
  if (overdue.length) todos.push({ text: `${overdue.length} 筆撥款已到預計日但尚未核對存摺`, page: 'deposits' });
  if (r.suspense > 0) todos.push({ text: `有 ${r.suspense.toLocaleString('zh-TW')} 元繳費尚無應繳可銷帳（暫收款），請匯入或建立對應月份的每月應繳`, page: 'import', arg: 'dues' });
  const prev = lastMonth();
  if (data.payments.length && !data.closes.some((c) => c.month === prev)) todos.push({ text: `${prev} 尚未月結`, page: 'month' });

  return (
    <>
      <CommunityProfile />
      <div className="stats">
        <Stat label={`${month} 本月總收入`} value={monthIncome} hint={`管理費 ${r.received.gross.toLocaleString('zh-TW')}＋其他收入 ${(monthIncome - r.received.gross).toLocaleString('zh-TW')}`} />
        <Stat label={`${month} 本月總支出`} value={monthExpense} hint={`${r.expense.length} 個科目`} />
        <Stat label={`${month} 本月結餘`} value={monthIncome - monthExpense} hint="總收入－總支出" tone={monthIncome - monthExpense < 0 ? 'warn' : 'ok'} />
        <Stat label="銀行帳戶總餘額" value={bankTotal} hint={`${bankBalances.length} 個銀行帳戶，截至 ${today}`} onClick={() => go('accounts')} />
      </div>
      <div className="stats">
        <Stat label={`${month} 住戶繳費`} value={r.received.gross} hint={`${r.received.count} 筆`} />
        <Stat label={`${month} 已撥入銀行`} value={r.deposited.gross} hint={`${r.deposited.count} 筆（依報表入帳日）`} />
        <Stat label={`${lastMonth()} 月底在途存款`} value={prevReport.closingInTransit.gross} hint={`${prevReport.closingInTransit.count} 筆，月底前未入帳`} tone="warn" />
        <Stat label={`${month} 月底在途（目前）`} value={r.closingInTransit.gross} hint={`${r.closingInTransit.count} 筆，入帳日在下月或報表尚無入帳日`} />
        <Stat label={`${month} 預收款`} value={r.prepaid} hint="已繳，銷到下個月以後的應繳" />
        {r.suspense !== 0 && <Stat label={`${month} 暫收款`} value={r.suspense} hint="已繳但尚無應繳可銷帳" tone="warn" />}
      </div>
      <Section title="待辦事項">
        {todos.length === 0 ? (
          <p className="empty">目前沒有待辦事項。</p>
        ) : (
          <ul className="todos">
            {todos.map((t) => (
              <li key={t.text}>
                {t.text} <button className="link" onClick={() => go(t.page, t.arg)}>前往</button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="資料概況">
        <table className="kv">
          <tbody>
            <tr><th>繳費紀錄</th><td>{data.payments.length} 筆</td></tr>
            <tr><th>收支分錄</th><td>{data.entries.length} 筆</td></tr>
            <tr><th>戶別</th><td>{units.length} 戶{data.settings.units.length > units.length ? `（另有 ${data.settings.units.length - units.length} 戶已刪除）` : ''}</td></tr>
            <tr><th>最近匯入</th><td>{lastImport ? `${lastImport.fileName}（${lastImport.importedAt.slice(0, 10)}，新增 ${lastImport.added} 筆）` : '尚未匯入'}</td></tr>
            <tr><th>已月結月份</th><td>{data.closes.map((c) => c.month).sort().join('、') || '無'}</td></tr>
          </tbody>
        </table>
      </Section>
    </>
  );
}

