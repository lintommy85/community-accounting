import { useState } from 'react';
import { Money, MonthInput, Section, thisMonth } from '../components/ui';
import { newId, resolveDepositAccountId, transferAccounts } from '../lib/defaults';
import { todayStr } from '../lib/dates';
import { nextVoucher } from '../lib/ledger';
import { LedgerEntry } from '../lib/types';
import { useStore } from '../store';

const TYPE_LABEL = { income: '收入', expense: '支出', transfer: '轉帳' } as const;


export default function LedgerPage() {
  const { data, update, isClosed } = useStore();
  const { settings } = data;
  const [month, setMonth] = useState(thisMonth());
  const blank = (): Omit<LedgerEntry, 'id' | 'amount'> & { amount: string } => ({
    date: todayStr(),
    type: 'expense',
    category: '',
    accountId: resolveDepositAccountId(settings) || settings.accounts[0]?.id || '',
    toAccountId: '',
    amount: '',
    counterparty: '',
    voucherNo: '',
    note: '',
  });
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');
  const accName = (id: string) => settings.accounts.find((a) => a.id === id)?.name ?? '';
  const list = data.entries.filter((e) => e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo));
  const cats = f.type === 'income' ? settings.incomeCategories : f.type === 'expense' ? settings.expenseCategories : ['公共基金提撥', '零用金撥補', '定存', '帳戶間轉帳'];

  function save() {
    const amount = Number(f.amount);
    if (!f.date || !Number.isFinite(amount) || amount === 0) return setMsg('請輸入日期與金額（可為負數，例如退款或沖銷）');
    if (!f.category.trim()) return setMsg('請輸入科目');
    if (f.type === 'transfer' && (!f.toAccountId || f.toAccountId === f.accountId)) return setMsg('請選擇不同的轉入帳戶');
    if (f.type === 'transfer' && ![f.accountId, f.toAccountId].every((id) => transferAccounts(settings).some((a) => a.id === id))) return setMsg('零用金等排除轉帳的帳戶不能轉帳，請重新選擇帳戶');
    if (isClosed(f.date)) return setMsg('該月份已結帳，請先解除月結');
    const e: LedgerEntry = { ...f, id: newId('e_'), amount, category: f.category.trim(), voucherNo: f.voucherNo.trim() || nextVoucher(data.entries, f.date) };
    update((d) => ({ ...d, entries: [...d.entries, e] }), `新增${TYPE_LABEL[e.type]}`, `${e.voucherNo} ${e.date} ${e.category} ${e.amount}`);
    setF({ ...blank(), date: f.date, type: f.type, accountId: f.accountId });
    setMsg(`已登錄傳票 ${e.voucherNo}`);
  }

  function remove(e: LedgerEntry) {
    if (!confirm(`刪除傳票 ${e.voucherNo}（${e.category} ${e.amount} 元）？`)) return;
    update((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id) }), '刪除分錄', `${e.voucherNo} ${e.date} ${e.category} ${e.amount}`);
  }

  return (
    <>
      <h1>收支記帳</h1>
      <p className="hint">管理費收款由匯入報表自動處理，這裡登錄其他收入（利息、場地租借…）與各項支出。零用金的支出請到「零用金」登錄，每月撥補會自動列為支出「零用金撥補」；帳戶間轉帳請到「帳戶與轉帳」。</p>
      <Section title="新增分錄">
        <div className="form-row wrap">
          <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as LedgerEntry['type'], category: '' })}>
            <option value="expense">支出</option>
            <option value="income">收入</option>
            <option value="transfer">轉帳</option>
          </select>
          <input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
          <input list="cats" placeholder="科目" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          <select value={f.accountId} onChange={(e) => setF({ ...f, accountId: e.target.value })}>
            {(f.type === 'transfer' ? transferAccounts(settings) : settings.accounts.filter((a) => a.kind !== 'cash')).map((a) => <option key={a.id} value={a.id}>{f.type === 'transfer' ? '轉出：' : ''}{a.name}</option>)}
          </select>
          {f.type === 'transfer' && (
            <select value={f.toAccountId} onChange={(e) => setF({ ...f, toAccountId: e.target.value })}>
              <option value="">轉入帳戶…</option>
              {transferAccounts(settings).map((a) => <option key={a.id} value={a.id}>轉入：{a.name}</option>)}
            </select>
          )}
          <input type="number" placeholder="金額" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <input placeholder={f.type === 'expense' ? '受款人／廠商' : '對象'} value={f.counterparty} onChange={(e) => setF({ ...f, counterparty: e.target.value })} />
          <input placeholder="傳票號碼（空白自動編）" value={f.voucherNo} onChange={(e) => setF({ ...f, voucherNo: e.target.value })} />
          <input placeholder="摘要／發票號碼" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <button className="primary" onClick={save}>登錄</button>
        </div>
        {msg && <p className="hint">{msg}</p>}
      </Section>
      <Section title="分錄明細" actions={<MonthInput value={month} onChange={setMonth} />}>
        {list.length === 0 ? <p className="empty">本月沒有分錄。</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>傳票</th><th>日期</th><th>類型</th><th>科目</th><th>帳戶</th><th className="num">金額</th><th>對象</th><th>摘要</th><th></th></tr></thead>
              <tbody>
                {list.map((e) => (
                  <tr key={e.id}>
                    <td>{e.voucherNo}</td><td>{e.date}</td><td>{TYPE_LABEL[e.type]}</td><td>{e.category}</td>
                    <td>{accName(e.accountId)}{e.type === 'transfer' ? ` → ${accName(e.toAccountId)}` : ''}</td>
                    <td className="num"><Money value={e.type === 'expense' ? -e.amount : e.amount} /></td>
                    <td>{e.counterparty}</td><td>{e.note}</td>
                    <td>{isClosed(e.date) ? <span className="tag">已結帳</span> : <button className="link danger" onClick={() => remove(e)}>刪除</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
