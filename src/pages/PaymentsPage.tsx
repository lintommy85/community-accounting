import { useMemo, useState } from 'react';
import AllocationEditor from '../components/AllocationEditor';
import { Money, MonthInput, Section, thisMonth } from '../components/ui';
import { newId } from '../lib/defaults';
import { todayStr } from '../lib/dates';
import { allocateAll, normUnit } from '../lib/allocation';
import { channelLabel, isMonthEndInTransit, netAmount } from '../lib/ledger';
import { Payment } from '../lib/types';
import { useStore } from '../store';

type Status = 'all' | 'transit' | 'pending' | 'confirmed';
const LIMIT = 500;

export default function PaymentsPage() {
  const { data, isClosed } = useStore();
  const [month, setMonth] = useState(thisMonth());
  const [allMonths, setAllMonths] = useState(false);
  const [by, setBy] = useState<'paid' | 'deposit'>('paid');
  const [q, setQ] = useState('');
  const [channel, setChannel] = useState('');
  const channels = useMemo(() => Array.from(new Set(data.payments.map(channelLabel))).sort((a, b) => a.localeCompare(b, 'zh-Hant')), [data.payments]);
  const [status, setStatus] = useState<Status>('all');
  const [editing, setEditing] = useState<Payment | null>(null);
  const alloc = useMemo(() => allocateAll(data), [data]);

  const list = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return data.payments
      .filter((p) => allMonths || (by === 'paid' ? p.paidDate : p.depositDate).startsWith(month))
      .filter((p) => !channel || channelLabel(p) === channel)
      .filter((p) => !kw || [p.unitNo, p.payerName, p.txnNo, p.billPeriod, p.note].some((v) => v.toLowerCase().includes(kw)))
      .filter((p) => {
        if (p.voided) return status === 'all';
        if (status === 'transit') return isMonthEndInTransit(p);
        if (status === 'pending') return !p.depositDate;
        if (status === 'confirmed') return p.depositConfirmed;
        return true;
      })
      .sort((a, b) => b.paidDate.localeCompare(a.paidDate) || a.unitNo.localeCompare(b.unitNo));
  }, [data.payments, month, allMonths, by, q, channel, status]);

  const sum = list.filter((p) => !p.voided).reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <h1>繳費紀錄</h1>
      <Section title="篩選">
        <div className="form-row">
          <select value={by} onChange={(e) => setBy(e.target.value as 'paid' | 'deposit')}>
            <option value="paid">依繳費日</option>
            <option value="deposit">依入帳日</option>
          </select>
          {!allMonths && <MonthInput value={month} onChange={setMonth} />}
          <label className="check"><input type="checkbox" checked={allMonths} onChange={(e) => setAllMonths(e.target.checked)} /> 全部月份</label>
          <input placeholder="搜尋戶別、姓名、序號…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">全部繳費方式</option>
            {channels.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
            <option value="all">全部狀態</option>
            <option value="transit">在途（繳費當月月底前未入帳）</option>
            <option value="pending">報表尚無入帳日</option>
            <option value="confirmed">已核對存摺</option>
          </select>
        </div>
      </Section>
      <Section title={`共 ${list.length} 筆，合計 ${sum.toLocaleString('zh-TW')} 元`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>戶別</th><th>所有權人</th><th>期別</th><th>項目</th><th>繳費日</th><th>方式</th>
                <th className="num">金額</th><th className="num">淨額</th><th>入帳日</th><th>狀態</th><th>備註</th><th></th>
              </tr>
            </thead>
            <tbody>
              {list.slice(0, LIMIT).map((p) => {
                const locked = isClosed(p.paidDate) || (!!p.depositDate && isClosed(p.depositDate));
                return (
                  <tr key={p.id} className={p.voided ? 'voided' : ''}>
                    <td>{p.unitNo}</td><td>{p.payerName}</td><td>{p.billPeriod}</td><td>{p.item}</td><td>{p.paidDate}</td>
                    <td>{channelLabel(p)}</td>
                    <td className="num"><Money value={p.amount} /></td>
                    <td className="num"><Money value={netAmount(p)} /></td>
                    <td>{p.depositDate || <span className="muted">尚未入帳</span>}</td>
                    <td>
                      {p.voided ? <span className="tag">作廢</span>
                        : p.depositConfirmed ? <span className="tag ok">已核對存摺</span>
                        : !p.depositDate ? <span className="tag warn">未入帳</span>
                        : <span className="tag">報表</span>}
                      {!p.voided && isMonthEndInTransit(p) && <span className="tag warn" title="繳費當月月底前未入帳">{Number(p.paidDate.slice(5, 7))}月底在途</span>}
                      {locked && <span className="tag">已結帳</span>}
                      {p.allocations && <span className="tag" title="手動指定銷帳月份">手動銷帳</span>}
                    </td>
                    <td className="note-cell" title={p.note}>{p.note}</td>
                    <td className="row-actions">
                      {!p.voided && (alloc.byKey.has(normUnit(p.unitNo)) ? (
                        <button className="link" onClick={() => setEditing(p)}>調整銷帳</button>
                      ) : (
                        <span className="muted" title="戶別不在戶別清單中（或已刪除），無法銷帳">—</span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {list.length > LIMIT && <p className="hint">僅顯示前 {LIMIT} 筆，請縮小篩選範圍。</p>}
        </div>
      </Section>
      <ManualPayment />
      {editing && alloc.byKey.get(normUnit(editing.unitNo)) && (
        <AllocationEditor payment={editing} account={alloc.byKey.get(normUnit(editing.unitNo))!} startMonth={alloc.startMonth} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function ManualPayment() {
  const { data, update, isClosed } = useStore();
  const blank = { unitNo: '', payerName: '', billPeriod: '', item: '管理費', paidDate: todayStr(), channel: '現金', depositDate: todayStr(), amount: '', note: '' };
  const [f, setF] = useState(blank);
  const [msg, setMsg] = useState('');
  const channels = Array.from(new Set(['現金', '臨櫃', ...data.payments.map(channelLabel)]));

  function save() {
    const amount = Number(f.amount);
    if (!f.paidDate || !Number.isFinite(amount) || !amount) return setMsg('請輸入繳費日期與金額（可為負數）');
    if (isClosed(f.paidDate) || (f.depositDate && isClosed(f.depositDate))) return setMsg('該月份已結帳，請先解除月結');
    const p: Payment = {
      id: newId('pm_'),
      batchId: 'manual',
      unitNo: f.unitNo.trim(),
      payerName: f.payerName.trim(),
      billPeriod: f.billPeriod.trim(),
      item: f.item.trim(),
      paidDate: f.paidDate,
      channel: f.channel.trim(),
      amount,
      fee: 0,
      reportDepositDate: '',
      depositDate: f.depositDate,
      depositConfirmed: false,
      txnNo: '',
      status: '手動登錄',
      note: f.note,
      voided: false,
    };
    update((d) => ({ ...d, payments: [...d.payments, p] }), '手動新增繳費', `${p.unitNo} ${p.paidDate} ${p.amount}`);
    setF({ ...blank, paidDate: f.paidDate, depositDate: f.depositDate, channel: f.channel });
    setMsg(`已新增 ${p.unitNo} ${amount} 元${p.depositDate ? `，入帳日 ${p.depositDate}` : '，尚未入帳'}`);
  }

  return (
    <Section title="手動新增繳費（現金、臨櫃等不在智生活報表中的款項）">
      <div className="form-row wrap">
        <input placeholder="戶別" value={f.unitNo} onChange={(e) => setF({ ...f, unitNo: e.target.value })} />
        <input placeholder="住戶" value={f.payerName} onChange={(e) => setF({ ...f, payerName: e.target.value })} />
        <input placeholder="期別，如 115/11" value={f.billPeriod} onChange={(e) => setF({ ...f, billPeriod: e.target.value })} />
        <input placeholder="項目" value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} />
        <label>繳費日<input type="date" value={f.paidDate} onChange={(e) => setF({ ...f, paidDate: e.target.value })} /></label>
        <label>繳費方式<input list="manual-channels" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })} /></label>
        <datalist id="manual-channels">{channels.map((c) => <option key={c} value={c} />)}</datalist>
        <label>入帳日（空白＝尚未存入）<input type="date" value={f.depositDate} onChange={(e) => setF({ ...f, depositDate: e.target.value })} /></label>
        <input type="number" placeholder="金額（可負數）" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
        <input placeholder="備註" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        <button className="primary" onClick={save}>新增</button>
      </div>
      {msg && <p className="hint">{msg}</p>}
    </Section>
  );
}
