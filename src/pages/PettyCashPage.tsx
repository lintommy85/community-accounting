import { useEffect, useRef, useState } from 'react';
import { isEnterKey, Money, MonthInput, Section, thisMonth } from '../components/ui';
import { Icon } from '../components/icons';
import PettySheet from '../components/PettySheet';
import { monthEnd, monthOf, todayStr } from '../lib/dates';
import { newId, PETTY_OTHER, resolveDepositAccountId } from '../lib/defaults';
import { defaultReplenishDate, pettyLedger, pettyOfMonth, pettyTotal, replenishmentOf, replenishReportMonths, spentDateOf, upsertReplenishment } from '../lib/petty';
import { LedgerEntry, PettyCashEntry } from '../lib/types';
import { useStore } from '../store';


function nextVoucher(entries: LedgerEntry[], date: string): string {
  const prefix = `${Number(date.slice(0, 4)) - 1911}-`;
  const max = entries.filter((e) => e.voucherNo.startsWith(prefix)).reduce((m, e) => Math.max(m, Number(e.voucherNo.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

/** 零用金：獨立記錄每筆零用金支出；每月使用總額產生一筆「零用金撥補」支出（從銀行帳戶）。 */
export default function PettyCashPage() {
  const { data, update, isClosed } = useStore();
  const { settings } = data;
  const [month, setMonth] = useState(thisMonth());
  const list = pettyOfMonth(data.pettyCash, month);
  const total = pettyTotal(data.pettyCash, month);
  const repl = replenishmentOf(data.entries, month);
  const banks = settings.accounts.filter((a) => a.kind === 'bank');
  const locked = isClosed(`${month}-01`);
  const categories = settings.pettyCategories;
  const otherRef = useRef<HTMLInputElement>(null);

  const defaultDate = () => (todayStr().startsWith(month) ? todayStr() : `${month}-01`);
  const blank = () => ({ date: defaultDate(), spentDate: defaultDate(), category: categories[0] ?? PETTY_OTHER, other: '', amount: '', payee: '', note: '' });
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');
  const [nextMonth] = replenishReportMonths(month);
  const [reportMonth, setReportMonth] = useState(() => (repl ? monthOf(repl.date) : nextMonth));
  const [replDate, setReplDate] = useState(() => repl?.date ?? defaultReplenishDate(month, nextMonth));
  const [replAccount, setReplAccount] = useState(resolveDepositAccountId(settings) || banks[0]?.id || '');
  const [replMsg, setReplMsg] = useState('');

  useEffect(() => {
    setF((prev) => (prev.date.startsWith(month) ? prev : { ...prev, date: defaultDate(), spentDate: defaultDate() }));
    const rm = repl ? monthOf(repl.date) : replenishReportMonths(month)[0];
    setReportMonth(rm);
    setReplDate(repl?.date ?? defaultReplenishDate(month, rm));
    if (repl) setReplAccount(repl.accountId);
    setReplMsg('');
  }, [month, repl?.id]);

  function chooseReportMonth(m: string) {
    setReportMonth(m);
    setReplDate(repl?.date.startsWith(m) ? repl.date : defaultReplenishDate(month, m));
    setReplMsg('');
  }

  function add() {
    const amount = Number(f.amount);
    const isOther = f.category === PETTY_OTHER;
    if (isOther && !f.other.trim()) {
      otherRef.current?.focus();
      return setMsg('選「其他」時請輸入項目名稱');
    }
    if (!f.date || !f.spentDate || !f.category || !Number.isFinite(amount) || !amount) return setMsg('請輸入輸入日期、消費日期、項目與金額');
    if (isClosed(f.date)) return setMsg('該月份已結帳，請先解除月結');
    const e: PettyCashEntry = { id: newId('pc_'), date: f.date, spentDate: f.spentDate, category: f.category, item: isOther ? f.other.trim() : f.category, amount, payee: f.payee.trim(), note: f.note.trim() };
    update((d) => ({ ...d, pettyCash: [...d.pettyCash, e] }), '新增零用金支出', `${e.date} ${e.item} ${e.amount}`);
    setF({ ...blank(), date: f.date, spentDate: f.date, category: f.category });
    setMsg('');
  }

  function remove(e: PettyCashEntry) {
    if (!confirm(`刪除零用金支出「${e.item} ${e.amount.toLocaleString('zh-TW')} 元」？`)) return;
    update((d) => ({ ...d, pettyCash: d.pettyCash.filter((x) => x.id !== e.id) }), '刪除零用金支出', `${e.date} ${e.item} ${e.amount}`);
  }

  function replenish() {
    if (!replAccount) return setReplMsg('請先在「基本設定」建立銀行帳戶');
    if (!replDate.startsWith(reportMonth)) return setReplMsg(`撥補日期要在 ${reportMonth} 內，才會列入 ${reportMonth} 的月報`);
    if (isClosed(replDate)) return setReplMsg('撥補日期所在月份已結帳，請先解除月結');
    setReplMsg('');
    update(
      (d) => ({ ...d, entries: upsertReplenishment(d.entries, month, { date: replDate, accountId: replAccount, amount: total, voucherNo: nextVoucher(d.entries, replDate) }) }),
      repl ? '更新零用金撥補' : '零用金撥補',
      `${month} ${total}，列入 ${reportMonth} 月報`,
    );
  }

  function removeReplenishment() {
    if (!repl || !confirm(`刪除 ${month} 的零用金撥補（${repl.amount.toLocaleString('zh-TW')} 元）？`)) return;
    update((d) => ({ ...d, entries: d.entries.filter((e) => e.id !== repl.id) }), '刪除零用金撥補', month);
  }

  const fund = settings.pettyCashFund ?? 0;
  const ledger = pettyLedger(data.pettyCash, data.entries, fund, month);
  const current = pettyLedger(data.pettyCash, data.entries, fund, todayStr().slice(0, 7));
  const status = !repl ? (total ? 'none' : 'empty') : repl.amount === total ? 'ok' : 'diff';
  const replClosed = !!repl && isClosed(repl.date);
  const targetClosed = isClosed(`${reportMonth}-01`);
  const changed = !repl || repl.amount !== total || repl.date !== replDate || repl.accountId !== replAccount;
  const monthOptions: [string, string][] = [[nextMonth, `${nextMonth}（下個月）`], [month, `${month}（本月）`]];
  if (!monthOptions.some(([m]) => m === reportMonth)) monthOptions.push([reportMonth, reportMonth]);

  return (
    <>
      <div className="page-head no-print">
        <h1>零用金</h1>
        <div className="actions">
          <MonthInput value={month} onChange={setMonth} />
          <button onClick={() => window.print()}><Icon name="printer" />列印</button>
        </div>
      </div>
      <p className="hint no-print">
        零用金的每筆支出記在這裡，不會出現在收支表。清單依「輸入日期」列入月份；「消費日期」是發票或收據上的日期，只供查看，不影響列在哪個月。每月依使用總額向銀行帳戶申請撥補，收支表的支出只會出現一筆「零用金撥補」。
      </p>

      <Section title="零用金總額" className="no-print">
        <div className="form-row">
          <label className="no-print">零用金總額（定額）
            <input type="number" min={0} defaultValue={fund || ''} key={fund} placeholder="例如 10000"
              onBlur={(e) => {
                const v = Math.max(0, Number(e.target.value) || 0);
                if (v !== fund) update((d) => ({ ...d, settings: { ...d.settings, pettyCashFund: v } }), '修改零用金總額', String(v));
              }}
              onKeyDown={(e) => isEnterKey(e) && e.currentTarget.blur()} />
          </label>
          <div className="petty-balance">
            <span>總額 <Money value={fund} strong /></span>
            <span>目前餘額 <Money value={current.closing} strong /></span>
            <span>尚未撥補 <Money value={fund - current.closing} strong /></span>
          </div>
        </div>
        {!fund && <p className="warn no-print">尚未設定零用金總額，餘額會從 0 開始計算。</p>}
      </Section>

      <Section title={`${month} 零用金支出（${list.length} 筆，合計 ${total.toLocaleString('zh-TW')} 元）`} className="no-print">
        {!locked && (
          <div className="form-row wrap no-print">
            <label title="決定列在哪個月的零用金清單">輸入日期<input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label>
            <label title="發票、收據上的日期，不影響列在哪個月">消費日期<input type="date" value={f.spentDate} onChange={(e) => setF({ ...f, spentDate: e.target.value })} /></label>
            <label>項目
              <select
                value={f.category}
                onChange={(e) => {
                  setF({ ...f, category: e.target.value });
                  if (e.target.value === PETTY_OTHER) setTimeout(() => otherRef.current?.focus(), 0);
                }}
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            {f.category === PETTY_OTHER && (
              <label className="other-item">其他項目
                <input ref={otherRef} value={f.other} placeholder="請輸入項目名稱，例如 電池" onChange={(e) => setF({ ...f, other: e.target.value })} onKeyDown={(e) => isEnterKey(e) && add()} />
              </label>
            )}
            <label>金額<input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} onKeyDown={(e) => isEnterKey(e) && add()} /></label>
            <label>店家／對象<input value={f.payee} onChange={(e) => setF({ ...f, payee: e.target.value })} /></label>
            <label>備註（發票號碼等）<input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
            <button className="primary" onClick={add}>新增</button>
          </div>
        )}
        {msg && <p className="err">{msg}</p>}
        <table className="report">
          <thead>
            <tr><th>輸入日期</th><th>消費日期</th><th>項目</th><th>店家／對象</th><th>備註</th><th className="num">支出</th><th className="num">撥補</th><th className="num">餘額</th><th className="no-print"></th></tr>
          </thead>
          <tbody>
            <tr className="sub-line"><td>{month}-01</td><td colSpan={6}>上月結餘</td><td className="num"><Money value={ledger.opening} /></td><td className="no-print"></td></tr>
            {ledger.lines.map((l) =>
              l.expense ? (
                <tr key={l.expense.id} className={l.balance < 0 ? 'attention' : ''}>
                  <td>{l.date}</td>
                  <td>{spentDateOf(l.expense)}</td>
                  <td>{l.expense.category === PETTY_OTHER ? `其他：${l.expense.item}` : l.expense.item}</td>
                  <td>{l.expense.payee}</td>
                  <td>{l.expense.note}</td>
                  <td className="num"><Money value={l.out} /></td>
                  <td></td>
                  <td className="num"><Money value={l.balance} /></td>
                  <td className="no-print">{isClosed(l.date) ? <span className="tag">已結帳</span> : <button className="link danger" onClick={() => remove(l.expense!)}>刪除</button>}</td>
                </tr>
              ) : (
                <tr key={l.replenishment!.id} className="petty-replenish">
                  <td>{l.date}</td>
                  <td></td>
                  <td colSpan={3}>零用金撥補（{l.replenishment!.pettyMonth} 使用總額）</td>
                  <td></td>
                  <td className="num"><Money value={l.in} /></td>
                  <td className="num"><Money value={l.balance} /></td>
                  <td className="no-print"></td>
                </tr>
              ),
            )}
            {list.length === 0 && <tr><td colSpan={9} className="empty">本月沒有零用金支出。</td></tr>}
            <tr className="total">
              <th colSpan={5}>本月零用金使用總額／月底餘額</th>
              <td className="num"><Money value={total} strong /></td>
              <td className="num">{ledger.lines.some((l) => l.in) ? <Money value={ledger.lines.reduce((sum, l) => sum + l.in, 0)} /> : ''}</td>
              <td className="num"><Money value={ledger.closing} strong /></td>
              <td className="no-print"></td>
            </tr>
          </tbody>
        </table>
        {fund > 0 && ledger.closing < 0 && <p className="err">零用金餘額不足：支出已超過零用金總額 {(-ledger.closing).toLocaleString('zh-TW')} 元，請盡快撥補。</p>}
      </Section>

      <Section title={`${month} 零用金撥補`} className="no-print">
        <p className="hint">撥補金額＝本月零用金使用總額，會在收支記帳產生一筆支出「零用金撥補」，從下列銀行帳戶支出。撥補預設列入下個月的月報（撥補日期在下個月）；要列在本月的月報，「列入月報」請選本月。</p>
        <div className="form-row">
          <label>列入月報
            <select value={reportMonth} disabled={replClosed} onChange={(e) => chooseReportMonth(e.target.value)}>
              {monthOptions.map(([m, text]) => <option key={m} value={m}>{text}</option>)}
            </select>
          </label>
          <label>撥補日期<input type="date" value={replDate} min={`${reportMonth}-01`} max={monthEnd(reportMonth)} disabled={replClosed} onChange={(e) => setReplDate(e.target.value)} /></label>
          <label>從帳戶
            <select value={replAccount} disabled={replClosed} onChange={(e) => setReplAccount(e.target.value)}>
              {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <span>撥補金額 <Money value={total} strong /> 元</span>
          <button className="primary" disabled={!total || !changed || replClosed || targetClosed} onClick={replenish}>{repl ? '更新撥補' : '產生零用金撥補'}</button>
          {repl && <button className="danger" disabled={replClosed} onClick={removeReplenishment}>刪除撥補</button>}
        </div>
        {replMsg && <p className="err">{replMsg}</p>}
        {replClosed && <p className="warn">撥補日期所在的 {monthOf(repl!.date)} 已結帳，不能修改或刪除這筆撥補。</p>}
        {!replClosed && targetClosed && <p className="warn">{reportMonth} 已結帳，不能列入這個月的月報；請改選其他月份，或先解除月結。</p>}
        {status === 'ok' && <p className="ok">已撥補：{repl!.date} 從「{settings.accounts.find((a) => a.id === repl!.accountId)?.name}」支出 {repl!.amount.toLocaleString('zh-TW')} 元（傳票 {repl!.voucherNo}），列入 {monthOf(repl!.date)} 的月報。</p>}
        {status === 'diff' && <p className="warn">已撥補 {repl!.amount.toLocaleString('zh-TW')} 元，但目前使用總額為 {total.toLocaleString('zh-TW')} 元，請按「更新撥補」。</p>}
        {status === 'ok' && changed && !replClosed && <p className="hint">已改了列入月報、撥補日期或帳戶，按「更新撥補」後才會生效。</p>}
        {status === 'none' && <p className="warn">本月尚未撥補。</p>}
      </Section>

      <div className="print-only">
        <PettySheet data={data} month={month} ledger={ledger} total={total} />
      </div>
    </>
  );
}
