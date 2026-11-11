import { Fragment, useState } from 'react';
import type { Go } from '../components/nav';
import { Icon } from '../components/icons';
import { DueTag, HistoryTable } from '../components/RegistryParts';
import { Money, Section } from '../components/ui';
import { newId } from '../lib/defaults';
import { annualAmount, contractAlert, contractDetail, CYCLE_LABEL, dateDue, dueText, reminderMonths, withRecord } from '../lib/registry';
import { Contract, ContractCycle } from '../lib/types';
import { useStore } from '../store';

const fmt = (n: number) => n.toLocaleString('zh-TW');
const CYCLES = Object.keys(CYCLE_LABEL) as ContractCycle[];

type Draft = Omit<Contract, 'id' | 'history' | 'amount'> & { amount: string };
const emptyDraft = (): Draft => ({ title: '', vendor: '', amount: '', cycle: 'month', startDate: '', endDate: '', note: '' });
const toDraft = (c: Contract): Draft => ({ title: c.title, vendor: c.vendor, amount: String(c.amount), cycle: c.cycle, startDate: c.startDate, endDate: c.endDate, note: c.note });

/** 檢查合約欄位：要有合約項目或廠商、到期日，金額不能是負數。 */
function checkDraft(d: Draft): string {
  if (!d.title.trim() && !d.vendor.trim()) return '請輸入合約項目或簽約廠商';
  if (!d.endDate) return '請輸入合約到期日';
  if (d.startDate && d.startDate > d.endDate) return '開始日期不能晚於到期日';
  const n = Number(d.amount || 0);
  if (!Number.isFinite(n) || n < 0) return '合約金額要是 0 以上的數字';
  return '';
}

const fromDraft = (d: Draft): Omit<Contract, 'id' | 'history'> => ({ title: d.title.trim(), vendor: d.vendor.trim(), amount: Math.round(Number(d.amount || 0)), cycle: d.cycle, startDate: d.startDate, endDate: d.endDate, note: d.note.trim() });

/** 合約欄位：新增與修改共用。 */
function ContractFields({ draft, onChange }: { draft: Draft; onChange: (d: Draft) => void }) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  return (
    <div className="form-row">
      <label>合約項目<input value={draft.title} placeholder="例如保全服務" onChange={(e) => set({ title: e.target.value })} /></label>
      <label>簽約廠商<input value={draft.vendor} placeholder="廠商名稱" onChange={(e) => set({ vendor: e.target.value })} /></label>
      <label>合約金額<input type="number" min={0} className="short-num" value={draft.amount} placeholder="0" onChange={(e) => set({ amount: e.target.value })} /></label>
      <label>
        帳務週期
        <select value={draft.cycle} onChange={(e) => set({ cycle: e.target.value as ContractCycle })}>
          {CYCLES.map((c) => <option key={c} value={c}>{CYCLE_LABEL[c]}</option>)}
        </select>
      </label>
      <label>開始日期<input type="date" value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} /></label>
      <label>到期日期<input type="date" value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} /></label>
      <label>備註<input value={draft.note} onChange={(e) => set({ note: e.target.value })} /></label>
    </div>
  );
}

/** 合約與財產 → 合約管理：簽約廠商、合約金額與帳務週期、到期日；到期前 3 個月持續高亮提醒。 */
export default function ContractsPage({ go }: { go: Go }) {
  const { data, update } = useStore();
  const warn = reminderMonths(data.settings).contracts;
  const contracts = [...(data.contracts ?? [])].sort((a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'));
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [open, setOpen] = useState('');
  const [msg, setMsg] = useState('');
  const alerts = contracts.filter((c) => contractAlert(c, dateDue(c.endDate, undefined, warn)));
  const noRenew = contracts.filter((c) => c.noRenew).length;
  const yearly = contracts.reduce((t, c) => t + annualAmount(c), 0);

  function add() {
    const err = checkDraft(draft);
    if (err) return setMsg(err);
    const base: Contract = { id: newId('ct_'), history: [], ...fromDraft(draft) };
    const c = withRecord(base, base.endDate, `新增：${contractDetail(base)}`);
    update((d) => ({ ...d, contracts: [...(d.contracts ?? []), c] }), '新增合約', `${c.title} ${c.vendor} 到期 ${c.endDate}`);
    setDraft(emptyDraft());
    setMsg('');
  }

  return (
    <>
      <div className="stats">
        <div className="stat c-blue"><div className="stat-label">合約數</div><div className="stat-value">{contracts.length}</div><div className="stat-hint">依到期日排序</div></div>
        <div className="stat c-purple"><div className="stat-label">每年合約金額</div><div className="stat-value"><Money value={yearly} /></div><div className="stat-hint">平均每月 {fmt(Math.round(yearly / 12))} 元</div></div>
        <div className={alerts.length ? 'stat c-yellow' : 'stat c-green'}><div className="stat-label">即將到期</div><div className="stat-value">{alerts.length}</div><div className="stat-hint">{alerts.length ? `到期前 ${warn} 個月起提醒，續約後更新到期日` : `${warn} 個月內沒有要續約的合約`}{noRenew ? `；${noRenew} 份到期不續約` : ''}</div></div>
      </div>

      <Section title="新增合約">
        <ContractFields draft={draft} onChange={setDraft} />
        <div className="form-row">
          <button className="primary" onClick={add}><Icon name="check" />新增合約</button>
          {msg && <span className="err">{msg}</span>}
        </div>
      </Section>

      <Section title={`合約（${contracts.length}）`}>
        <p className="hint">
          到期前 {warn} 個月起，該列會一直標成黃色，直到續約更新到期日；提醒時間可以在<button className="link" onClick={() => go('settings')}>「基本設定 → 到期提醒」</button>修改。
          勾選最後一欄「到期不續約」的合約不會再提醒。按「展開」可以修改內容，並看每次修改的到期日與修改時間（紀錄可以刪除）。
        </p>
        {contracts.length === 0 ? (
          <p className="empty">還沒有合約，從上方新增。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>合約項目</th><th>簽約廠商</th><th className="num">合約金額</th><th className="num">每年金額</th><th>合約期間</th><th>到期</th><th></th><th className="center">到期不續約</th></tr></thead>
              <tbody>
                {contracts.map((c) => (
                  <ContractRow key={c.id} contract={c} warn={warn} open={open === c.id} onToggle={() => setOpen(open === c.id ? '' : c.id)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function ContractRow({ contract: c, warn, open, onToggle }: { contract: Contract; warn: number; open: boolean; onToggle: () => void }) {
  const { update } = useStore();
  const [draft, setDraft] = useState<Draft>(() => toDraft(c));
  const [msg, setMsg] = useState('');
  const due = dateDue(c.endDate, undefined, warn);
  const setContract = (fn: (x: Contract) => Contract, action: string, detail: string) =>
    update((d) => ({ ...d, contracts: (d.contracts ?? []).map((x) => (x.id === c.id ? fn(x) : x)) }), action, detail);

  function save() {
    const err = checkDraft(draft);
    if (err) return setMsg(err);
    const next = { ...c, ...fromDraft(draft) };
    setContract(() => withRecord(next, next.endDate, contractDetail(next)), '修改合約', `${next.title} ${next.vendor} 到期 ${next.endDate}`);
    setMsg('已儲存，並新增一筆修改紀錄。');
  }

  function toggleNoRenew(on: boolean) {
    const next = { ...c, noRenew: on || undefined };
    setContract(() => withRecord(next, next.endDate, `${on ? '設為到期不續約' : '取消到期不續約'}｜${contractDetail(next)}`), on ? '合約設為到期不續約' : '合約取消到期不續約', `${c.title} ${c.vendor}`);
  }

  function remove() {
    if (!confirm(`刪除合約「${c.title || c.vendor}」？修改紀錄也會一起刪除。`)) return;
    update((d) => ({ ...d, contracts: (d.contracts ?? []).filter((x) => x.id !== c.id) }), '刪除合約', `${c.title} ${c.vendor}`);
  }

  return (
    <Fragment>
      <tr className={[contractAlert(c, due) ? 'attention' : '', c.noRenew ? 'muted-row' : '', open ? 'is-open' : ''].join(' ').trim() || undefined}>
        <td>{c.title || '—'}{c.note && <div className="muted small">{c.note}</div>}</td>
        <td>{c.vendor || '—'}</td>
        <td className="num"><Money value={c.amount} /><span className="muted"> / {CYCLE_LABEL[c.cycle].replace('每', '')}</span></td>
        <td className="num"><Money value={annualAmount(c)} /></td>
        <td>{c.startDate ? `${c.startDate} ～ ` : '～ '}{c.endDate}</td>
        <td>{c.noRenew ? <><span className="tag">到期不續約</span><span className="muted small">{dueText(due)}</span></> : <DueTag due={due} />}</td>
        <td><button className="link" onClick={() => { setDraft(toDraft(c)); setMsg(''); onToggle(); }} aria-expanded={open}>{open ? '收合' : '展開'}</button></td>
        <td className="center"><input type="checkbox" checked={!!c.noRenew} onChange={(e) => toggleNoRenew(e.target.checked)} aria-label={`${c.title || c.vendor} 到期不續約`} title="勾選後到了提醒時間也不高亮提醒" /></td>
      </tr>
      {open && (
        <tr className="expand-row">
          <td colSpan={8}>
            <h4>修改合約（續約時改到期日後儲存）</h4>
            <ContractFields draft={draft} onChange={setDraft} />
            <div className="form-row">
              <button className="primary" onClick={save}>儲存變更</button>
              <button className="link danger" onClick={remove}>刪除合約</button>
              {msg && <span className={msg.startsWith('已') ? 'hint' : 'err'}>{msg}</span>}
            </div>
            <h4>修改紀錄（{c.history.length}）</h4>
            <HistoryTable records={c.history} valueLabel="合約到期日" onDelete={(id) => setContract((x) => ({ ...x, history: x.history.filter((r) => r.id !== id) }), '刪除合約修改紀錄', c.title)} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
