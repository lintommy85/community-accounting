import { useEffect, useState } from 'react';
import type { PageKey } from '../App';
import { isEnterKey, Money, MonthInput, Section, thisMonth } from '../components/ui';
import { Icon } from '../components/icons';
import { fileBase, newId, transferAccounts } from '../lib/defaults';
import { todayStr } from '../lib/dates';
import { accountRegisters, RegisterKind } from '../lib/ledger';
import { downloadBlob } from '../lib/storage';
import { LedgerEntry } from '../lib/types';
import { exportAccountRegisters } from '../lib/xlsxio';
import { useStore } from '../store';

const KIND_LABEL: Record<RegisterKind, string> = { deposit: '撥款入帳', income: '收入', expense: '支出', transferIn: '轉入', transferOut: '轉出' };
const TRANSFER_CATEGORIES = ['帳戶間轉帳', '公共基金提撥', '定存', '定存解約'];

function nextVoucher(entries: LedgerEntry[], date: string): string {
  const prefix = `${Number(date.slice(0, 4)) - 1911}-`;
  const max = entries.filter((e) => e.voucherNo.startsWith(prefix)).reduce((m, e) => Math.max(m, Number(e.voucherNo.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** 帳戶與轉帳：每月依帳戶分開列出逐筆變動與累計餘額，並登錄帳戶間轉帳。 */
export default function AccountsPage({ go }: { go: (p: PageKey) => void }) {
  const { data, update, isClosed } = useStore();
  const { settings } = data;
  const [month, setMonth] = useState(thisMonth());
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const regs = accountRegisters(data, month);
  const accName = (id: string) => settings.accounts.find((a) => a.id === id)?.name ?? '';
  const movable = transferAccounts(settings);
  const transfers = data.entries.filter((e) => e.type === 'transfer' && e.date.startsWith(month)).sort((a, b) => a.date.localeCompare(b.date));

  const blank = () => ({
    date: todayStr().startsWith(month) ? todayStr() : `${month}-01`,
    from: movable[0]?.id ?? '',
    to: movable[1]?.id ?? '',
    amount: '',
    category: TRANSFER_CATEGORIES[0],
    note: '',
  });
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    setF((prev) => (prev.date.startsWith(month) ? prev : { ...prev, date: todayStr().startsWith(month) ? todayStr() : `${month}-01` }));
  }, [month]);

  function addTransfer() {
    const amount = Number(f.amount);
    if (!f.date || !Number.isFinite(amount) || !amount) return setMsg('請輸入日期與金額');
    if (!f.from || !f.to || f.from === f.to) return setMsg('請選擇不同的轉出與轉入帳戶');
    if (![f.from, f.to].every((id) => movable.some((a) => a.id === id))) return setMsg('請重新選擇轉出與轉入帳戶');
    if (isClosed(f.date)) return setMsg('該月份已結帳，請先解除月結');
    const e: LedgerEntry = {
      id: newId('e_'),
      date: f.date,
      type: 'transfer',
      category: f.category.trim() || '帳戶間轉帳',
      accountId: f.from,
      toAccountId: f.to,
      amount,
      counterparty: '',
      voucherNo: nextVoucher(data.entries, f.date),
      note: f.note.trim(),
    };
    update((d) => ({ ...d, entries: [...d.entries, e] }), '新增轉帳', `${e.voucherNo} ${e.date} ${accName(e.accountId)}→${accName(e.toAccountId)} ${e.amount}`);
    setF({ ...blank(), date: f.date, from: f.from, to: f.to });
    setMsg(`已登錄轉帳 ${e.voucherNo}：${accName(e.accountId)} → ${accName(e.toAccountId)} ${amount.toLocaleString('zh-TW')} 元`);
  }

  function removeTransfer(e: LedgerEntry) {
    if (!confirm(`刪除轉帳 ${e.voucherNo}（${accName(e.accountId)} → ${accName(e.toAccountId)} ${e.amount.toLocaleString('zh-TW')} 元）？`)) return;
    update((d) => ({ ...d, entries: d.entries.filter((x) => x.id !== e.id) }), '刪除轉帳', `${e.voucherNo} ${e.date} ${e.amount}`);
  }

  const toggle = (id: string) => setOpen({ ...open, [id]: !(open[id] ?? true) });

  return (
    <>
      <div className="page-head">
        <h1>帳戶與轉帳</h1>
        <div className="actions">
          <MonthInput value={month} onChange={setMonth} />
          <button onClick={() => downloadBlob(exportAccountRegisters(data, month, regs), `${fileBase(settings)}-${month}-帳戶變動.xlsx`)}><Icon name="download" />匯出 Excel</button>
          <button onClick={() => window.print()}><Icon name="printer" />列印</button>
        </div>
      </div>

      <Section title={`${month} 各帳戶結存`}>
        <table className="report">
          <thead><tr><th>帳戶</th><th>帳號</th><th className="num">上月結存</th><th className="num">本月存入</th><th className="num">本月支出</th><th className="num">本月結存</th></tr></thead>
          <tbody>
            {regs.map((r) => (
              <tr key={r.accountId}>
                <th>{r.name}</th><td>{r.accountNo}</td>
                <td className="num"><Money value={r.opening} /></td>
                <td className="num"><Money value={r.inflow} /></td>
                <td className="num"><Money value={r.outflow} /></td>
                <td className="num"><Money value={r.closing} strong /></td>
              </tr>
            ))}
            <tr className="total">
              <th>合計</th><td></td>
              <td className="num"><Money value={regs.reduce((s, r) => s + r.opening, 0)} /></td>
              <td className="num"><Money value={regs.reduce((s, r) => s + r.inflow, 0)} /></td>
              <td className="num"><Money value={regs.reduce((s, r) => s + r.outflow, 0)} /></td>
              <td className="num"><Money value={regs.reduce((s, r) => s + r.closing, 0)} strong /></td>
            </tr>
          </tbody>
        </table>
        <p className="hint no-print">帳戶的期初餘額、帳號在「基本設定 → 銀行帳戶」設定。本月結存應與存摺餘額相同。</p>
      </Section>

      {regs.map((r) => {
        const isOpen = open[r.accountId] ?? true;
        return (
          <Section
            key={r.accountId}
            title={`${r.name}${r.accountNo ? `（${r.accountNo}）` : ''} 變動紀錄`}
            actions={<button className="link no-print" onClick={() => toggle(r.accountId)}>{isOpen ? '收合' : `展開（${r.lines.length} 筆）`}</button>}
          >
            {isOpen && (
              <div className="table-wrap">
                <table className="report register">
                  <thead><tr><th>日期</th><th>類別</th><th>摘要</th><th>傳票</th><th className="num">存入</th><th className="num">支出</th><th className="num">餘額</th></tr></thead>
                  <tbody>
                    <tr className="sub-line"><td>{month}-01</td><td></td><td>上月結存</td><td></td><td></td><td></td><td className="num"><Money value={r.opening} /></td></tr>
                    {r.lines.map((l, i) => (
                      <tr key={i}>
                        <td>{l.date}</td>
                        <td><span className={`tag ${l.inflow ? 'ok' : ''}`}>{KIND_LABEL[l.kind]}</span></td>
                        <td>{l.description}</td>
                        <td>{l.ref}</td>
                        <td className="num">{l.inflow ? <Money value={l.inflow} /> : ''}</td>
                        <td className="num">{l.outflow ? <Money value={l.outflow} /> : ''}</td>
                        <td className="num"><Money value={l.balance} /></td>
                      </tr>
                    ))}
                    <tr className="total"><td></td><td></td><th>本月合計／結存</th><td></td><td className="num"><Money value={r.inflow} /></td><td className="num"><Money value={r.outflow} /></td><td className="num"><Money value={r.closing} strong /></td></tr>
                  </tbody>
                </table>
                {r.lines.length === 0 && <p className="empty">本月沒有變動。</p>}
              </div>
            )}
          </Section>
        );
      })}

      <Section title="帳戶間轉帳" className="no-print">
        {movable.length < 2 ? (
          <p className="hint">至少要有兩個可轉帳的帳戶才能轉帳（零用金等勾選「排除轉帳」的帳戶不列入）。<button className="link" onClick={() => go('settings')}>到基本設定調整帳戶</button></p>
        ) : (
          <>
            <div className="form-row wrap">
              <label>日期<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
              <label>轉出帳戶
                <select value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })}>
                  {movable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>轉入帳戶
                <select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>
                  {movable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </label>
              <label>金額<input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} onKeyDown={(e) => isEnterKey(e) && addTransfer()} /></label>
              <label>用途
                <input list="transfer-cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
                <datalist id="transfer-cats">{TRANSFER_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label>摘要<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
              <button className="primary" onClick={addTransfer}>登錄轉帳</button>
            </div>
            <p className="hint">零用金不在轉帳選項內：零用金的撥補請到「零用金」產生；要調整可轉帳的帳戶，請到「基本設定 → 銀行帳戶與期初餘額」勾選「排除轉帳」。</p>
            {msg && <p className="hint">{msg}</p>}
            {transfers.length > 0 ? (
              <table>
                <thead><tr><th>傳票</th><th>日期</th><th>轉出</th><th>轉入</th><th className="num">金額</th><th>用途</th><th>摘要</th><th></th></tr></thead>
                <tbody>
                  {transfers.map((e) => (
                    <tr key={e.id}>
                      <td>{e.voucherNo}</td><td>{e.date}</td><td>{accName(e.accountId)}</td><td>{accName(e.toAccountId)}</td>
                      <td className="num"><Money value={e.amount} /></td><td>{e.category}</td><td>{e.note}</td>
                      <td>{isClosed(e.date) ? <span className="tag">已結帳</span> : <button className="link danger" onClick={() => removeTransfer(e)}>刪除</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="empty">{month} 沒有轉帳紀錄。</p>
            )}
          </>
        )}
      </Section>
    </>
  );
}
