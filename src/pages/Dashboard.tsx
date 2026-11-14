import type { PageKey } from '../App';
import type { Go } from '../components/nav';
import CommunityProfile from '../components/CommunityProfile';
import { lastMonth, Section, Stat, thisMonth } from '../components/ui';
import { advancesFromAllocations, allocateAll } from '../lib/allocation';
import { openDepositSummary } from '../lib/renovation';
import { localDate, todayStr } from '../lib/dates';
import { resolveDepositAccountId } from '../lib/defaults';
import { activeUnits, unitBaseline } from '../lib/fees';
import { accountBalances, depositGroups, monthReport } from '../lib/ledger';
import { registryAlerts, reminderMonths } from '../lib/registry';
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
  // 撥款對帳還沒核對相符的繳費列為待確認款項，不算進預收款／暫收款
  const pending = data.payments.filter((p) => !p.voided && !p.depositConfirmed && p.paidDate <= today);
  const pendingTotal = pending.reduce((sum, p) => sum + p.amount, 0);
  const alloc = data.settings.units.some((u) => !u.deletedAt) ? allocateAll(data) : null;
  const adv = alloc ? advancesFromAllocations(alloc, data.payments, month, { confirmedOnly: true }) : { prepaid: r.prepaid, suspense: r.suspense };
  // 有收到、還沒結算的裝潢保證金才顯示這格
  const renovation = alloc ? openDepositSummary(data, alloc, month) : { total: 0, units: 0 };
  const units = activeUnits(data.settings.units);
  const overdue = depositGroups(data.payments).filter((g) => g.depositDate <= today && !g.confirmed);
  const lastBackup = [...data.audit].reverse().find((a) => a.action === '下載備份');
  const daysSinceBackup = lastBackup ? Math.floor((Date.now() - Date.parse(lastBackup.at)) / 86400000) : null;
  const lastImport = data.batches[data.batches.length - 1];

  const todos: { text: string; page: PageKey; arg?: string }[] = [];
  const hasBase = units.some((u) => unitBaseline(u, data.settings.feePlans) > 0);
  if (!units.length) todos.push({ text: '尚未建立戶別：從智生活後台「繳費單列表」匯出管理費匯入範本，到「匯入智生活報表 → 每月應繳報表」匯入，不需要管理的戶別勾選「排除」後按「建立戶別」', page: 'import', arg: 'dues' });
  else if (!hasBase) todos.push({ text: '尚未設定基準與費率：到「戶別與月費 → 基準與費率」新增費率方案（例如坪數費、清潔費）並套用到每戶', page: 'units', arg: 'units' });
  else if (!data.dues.length) todos.push({ text: '尚未建立每月應繳：再匯入一次智生活管理費匯入範本，和基準不同的逐戶選擇後確認匯入', page: 'import', arg: 'dues' });
  if (!data.settings.communityName) todos.push({ text: '尚未輸入社區名稱（可直接在上方輸入）', page: 'home' });
  if (!resolveDepositAccountId(data.settings)) todos.push({ text: '有多個銀行帳戶，請指定管理費撥款要轉入哪個帳戶', page: 'settings' });
  if (units.length && data.dues.length && !data.dues.some((d) => d.month === month)) todos.push({ text: `${month} 尚未匯入每月應繳（智生活管理費匯入範本）`, page: 'import', arg: 'dues' });
  if (data.settings.accounts.every((a) => !a.openingDate)) todos.push({ text: '尚未設定帳戶期初餘額與期初日期', page: 'settings' });
  if (units.length && !data.settings.totalUnits) todos.push({ text: '尚未設定總戶數（欠費／銷帳需要）', page: 'settings' });
  else if (units.length && units.length !== data.settings.totalUnits) todos.push({ text: `戶別已建立 ${units.length}／${data.settings.totalUnits} 戶`, page: 'arrears' });
  if (fileStatus !== 'linked' && fileStatus !== 'service') todos.push({ text: '資料只存在瀏覽器內，建議改用「社區帳務管理.exe」開啟', page: 'backup' });
  if (daysSinceBackup === null || daysSinceBackup > 30) todos.push({ text: daysSinceBackup === null ? '從未下載備份檔' : `已 ${daysSinceBackup} 天未下載備份`, page: 'backup' });
  if (overdue.length) todos.push({ text: `${overdue.length} 筆撥款已到預計日但尚未核對存摺`, page: 'deposits' });
  if (r.suspense > 0) todos.push({ text: `有 ${r.suspense.toLocaleString('zh-TW')} 元繳費的期別還沒有每月應繳（暫收款），請匯入對應月份的每月應繳報表`, page: 'import', arg: 'dues' });
  const prev = lastMonth();
  const reg = registryAlerts(data);
  const warn = reminderMonths(data.settings);
  if (reg.contracts) todos.push({ text: `${reg.contracts} 份合約 ${warn.contracts} 個月內到期（或已到期），請續約後更新到期日；不續約的請勾「到期不續約」`, page: 'contracts' });
  if (reg.assets) todos.push({ text: `${reg.assets} 項設備或證書 ${warn.assets} 個月內到期（或已過期），更新後請改到期日`, page: 'property' });
  if (reg.filings) todos.push({ text: `${reg.filings} 項政府申報在 ${warn.filings} 個月內到期（或已逾期），申報完成後請更新最近一次申報月份`, page: 'property', arg: 'filings' });
  if (data.payments.length && !data.closes.some((c) => c.month === prev)) todos.push({ text: `${prev} 尚未月結`, page: 'month' });

  return (
    <>
      <CommunityProfile />
      <div className="stats">
        <Stat label={`${month} 本月總收入`} icon="arrowDown" color="green" value={monthIncome} hint={`管理費 ${r.received.gross.toLocaleString('zh-TW')}＋其他收入 ${(monthIncome - r.received.gross).toLocaleString('zh-TW')}`} />
        <Stat label={`${month} 本月總支出`} icon="arrowUp" color="red" value={monthExpense} hint={`${r.expense.length} 個科目`} />
        <Stat label={`${month} 本月結餘`} icon="scale" color="blue" value={monthIncome - monthExpense} hint="總收入－總支出" tone={monthIncome - monthExpense < 0 ? 'warn' : 'ok'} />
        <Stat label="銀行帳戶總餘額" icon="bank" color="purple" value={bankTotal} hint={`${bankBalances.length} 個銀行帳戶，截至 ${today}`} onClick={() => go('accounts')} />
      </div>
      <div className="stats">
        <Stat label={`${month} 住戶繳費`} icon="receipt" color="green" value={r.received.gross} hint={`${r.received.count} 筆`} />
        <Stat label={`${month} 已撥入銀行`} icon="inbox" color="blue" value={r.deposited.gross} hint={`${r.deposited.count} 筆（依報表入帳日）`} />
        <Stat label={`${month} 月底在途（目前）`} icon="truck" color="yellow" value={r.closingInTransit.gross} hint={`${r.closingInTransit.count} 筆，入帳日在下月或報表尚無入帳日`} />
        <Stat label="待確認款項" icon="hourglass" color="red" value={pendingTotal} hint={`${pending.length} 筆，撥款對帳尚未核對相符`} tone={pendingTotal ? 'warn' : undefined} onClick={() => go('deposits')} title="前往撥款對帳" />
        <Stat label={`${month} 預收款`} icon="coins" color="purple" value={adv.prepaid} hint="已核對的預繳、多繳款項（含期初預收款），每月沖銷後減少" />
        <Stat label={`${month} 暫收款`} icon="clock" color="gray" value={adv.suspense} hint="已核對，期別的每月應繳還沒匯入" tone={adv.suspense ? 'warn' : undefined} />
        {renovation.total > 0 && <Stat label="裝潢保證金" icon="hammer" color="purple" value={renovation.total} hint={`${renovation.units} 戶施工中、尚未結算`} onClick={() => go('renovation')} title="前往裝潢保證金" />}
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
            <tr><th>戶別</th><td>{units.length} 戶{data.settings.units.length > units.length ? `（另有 ${data.settings.units.length - units.length} 戶已排除）` : ''}</td></tr>
            <tr><th>最近匯入</th><td>{lastImport ? `${lastImport.fileName}（${localDate(lastImport.importedAt)}，新增 ${lastImport.added} 筆）` : '尚未匯入'}</td></tr>
            <tr><th>已月結月份</th><td>{data.closes.map((c) => c.month).sort().join('、') || '無'}</td></tr>
          </tbody>
        </table>
      </Section>
    </>
  );
}

