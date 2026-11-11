import { Fragment, ReactNode, useState } from 'react';
import { Go, useNavArg } from '../components/nav';
import { Icon } from '../components/icons';
import { DueTag, HistoryTable } from '../components/RegistryParts';
import { Section, thisMonth } from '../components/ui';
import { newId } from '../lib/defaults';
import { ASSET_KIND_LABEL, dateDue, filingDetail, filingDue, needsAttention, reminderMonths, withRecord } from '../lib/registry';
import { AssetItem, Filing } from '../lib/types';
import { useStore } from '../store';

type Tab = 'assets' | 'filings';

/** 合約與財產 → 財產管理：有有效期的設備與證書（到期前 3 個月提醒），以及政府固定申報（期限前半年提醒）。 */
export default function PropertyPage({ go }: { go: Go }) {
  const { data } = useStore();
  const warn = reminderMonths(data.settings);
  const navArg = useNavArg();
  const [tab, setTab] = useState<Tab>(navArg === 'filings' ? 'filings' : 'assets');
  const assetAlerts = (data.assets ?? []).filter((a) => needsAttention(dateDue(a.expiry, undefined, warn.assets))).length;
  const filingAlerts = (data.filings ?? []).filter((f) => needsAttention(filingDue(f, undefined, warn.filings))).length;
  const toSettings = <button className="link" onClick={() => go('settings')}>「基本設定 → 到期提醒」</button>;
  return (
    <>
      <div className="seg" role="tablist">
        <button role="tab" aria-selected={tab === 'assets'} className={tab === 'assets' ? 'primary' : ''} onClick={() => setTab('assets')}>
          設備與證書{assetAlerts > 0 && <span className="seg-count">{assetAlerts}</span>}
        </button>
        <button role="tab" aria-selected={tab === 'filings'} className={tab === 'filings' ? 'primary' : ''} onClick={() => setTab('filings')}>
          政府申報{filingAlerts > 0 && <span className="seg-count">{filingAlerts}</span>}
        </button>
      </div>
      {tab === 'assets' ? <Assets warn={warn.assets} toSettings={toSettings} /> : <Filings warn={warn.filings} toSettings={toSettings} />}
    </>
  );
}

type AssetDraft = Omit<AssetItem, 'id' | 'history'>;
const emptyAsset = (): AssetDraft => ({ kind: 'equipment', name: '', expiry: '', note: '' });
const assetDetail = (a: AssetDraft) => `${ASSET_KIND_LABEL[a.kind]}｜${a.name}${a.note ? `｜${a.note}` : ''}`;
const checkAsset = (a: AssetDraft) => (!a.name.trim() ? '請輸入名稱' : !a.expiry ? '請輸入到期日（精確到日期）' : '');

function AssetFields({ draft, onChange }: { draft: AssetDraft; onChange: (d: AssetDraft) => void }) {
  const set = (patch: Partial<AssetDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="form-row">
      <label>
        類別
        <select value={draft.kind} onChange={(e) => set({ kind: e.target.value as AssetItem['kind'] })}>
          <option value="equipment">設備</option>
          <option value="certificate">證書</option>
        </select>
      </label>
      <label>名稱<input value={draft.name} placeholder={draft.kind === 'equipment' ? '例如滅火器、緊急照明電池' : '例如昇降機使用許可證'} onChange={(e) => set({ name: e.target.value })} /></label>
      <label>到期日<input type="date" value={draft.expiry} onChange={(e) => set({ expiry: e.target.value })} /></label>
      <label>備註<input value={draft.note} placeholder="位置、數量、廠商" onChange={(e) => set({ note: e.target.value })} /></label>
    </div>
  );
}

function Assets({ warn, toSettings }: { warn: number; toSettings: ReactNode }) {
  const { data, update } = useStore();
  const list = [...(data.assets ?? [])].sort((a, b) => a.expiry.localeCompare(b.expiry));
  const [draft, setDraft] = useState<AssetDraft>(emptyAsset);
  const [open, setOpen] = useState('');
  const [msg, setMsg] = useState('');

  function add() {
    const err = checkAsset(draft);
    if (err) return setMsg(err);
    const base: AssetItem = { id: newId('as_'), history: [], ...draft, name: draft.name.trim(), note: draft.note.trim() };
    const a = withRecord(base, base.expiry, `新增：${assetDetail(base)}`);
    update((d) => ({ ...d, assets: [...(d.assets ?? []), a] }), `新增${ASSET_KIND_LABEL[a.kind]}`, `${a.name} 到期 ${a.expiry}`);
    setDraft({ ...emptyAsset(), kind: draft.kind });
    setMsg('');
  }

  return (
    <>
      <Section title="新增設備或證書">
        <AssetFields draft={draft} onChange={setDraft} />
        <div className="form-row">
          <button className="primary" onClick={add}><Icon name="check" />新增</button>
          {msg && <span className="err">{msg}</span>}
        </div>
      </Section>
      <Section title={`設備與證書（${list.length}）`}>
        <p className="hint">到期日精確到日期；到期前 {warn} 個月起，該列會一直標成黃色，直到更新到期日（提醒時間可以在{toSettings}修改）。按「展開」可以修改，並看每次更新的到期日與修改時間（紀錄可以刪除）。</p>
        {list.length === 0 ? (
          <p className="empty">還沒有設備或證書，從上方新增。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>類別</th><th>名稱</th><th>到期日</th><th>到期</th><th>備註</th><th></th></tr></thead>
              <tbody>
                {list.map((a) => <AssetRow key={a.id} item={a} warn={warn} open={open === a.id} onToggle={() => setOpen(open === a.id ? '' : a.id)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}

function AssetRow({ item: a, warn, open, onToggle }: { item: AssetItem; warn: number; open: boolean; onToggle: () => void }) {
  const { update } = useStore();
  const toDraft = (): AssetDraft => ({ kind: a.kind, name: a.name, expiry: a.expiry, note: a.note });
  const [draft, setDraft] = useState<AssetDraft>(toDraft);
  const [msg, setMsg] = useState('');
  const due = dateDue(a.expiry, undefined, warn);
  const setItem = (fn: (x: AssetItem) => AssetItem, action: string, detail: string) =>
    update((d) => ({ ...d, assets: (d.assets ?? []).map((x) => (x.id === a.id ? fn(x) : x)) }), action, detail);

  function save() {
    const err = checkAsset(draft);
    if (err) return setMsg(err);
    const next = { ...a, ...draft, name: draft.name.trim(), note: draft.note.trim() };
    setItem(() => withRecord(next, next.expiry, assetDetail(next)), `修改${ASSET_KIND_LABEL[next.kind]}`, `${next.name} 到期 ${next.expiry}`);
    setMsg('已儲存，並新增一筆修改紀錄。');
  }

  function remove() {
    if (!confirm(`刪除${ASSET_KIND_LABEL[a.kind]}「${a.name}」？修改紀錄也會一起刪除。`)) return;
    update((d) => ({ ...d, assets: (d.assets ?? []).filter((x) => x.id !== a.id) }), `刪除${ASSET_KIND_LABEL[a.kind]}`, a.name);
  }

  return (
    <Fragment>
      <tr className={[needsAttention(due) ? 'attention' : '', open ? 'is-open' : ''].join(' ').trim() || undefined}>
        <td><span className={a.kind === 'certificate' ? 'tag purple' : 'tag info'}>{ASSET_KIND_LABEL[a.kind]}</span></td>
        <td>{a.name}</td>
        <td>{a.expiry}</td>
        <td><DueTag due={due} /></td>
        <td className="note-cell">{a.note}</td>
        <td><button className="link" onClick={() => { setDraft(toDraft()); setMsg(''); onToggle(); }} aria-expanded={open}>{open ? '收合' : '展開'}</button></td>
      </tr>
      {open && (
        <tr className="expand-row">
          <td colSpan={6}>
            <h4>修改（更新後改到期日再儲存）</h4>
            <AssetFields draft={draft} onChange={setDraft} />
            <div className="form-row">
              <button className="primary" onClick={save}>儲存變更</button>
              <button className="link danger" onClick={remove}>刪除</button>
              {msg && <span className={msg.startsWith('已') ? 'hint' : 'err'}>{msg}</span>}
            </div>
            <h4>修改紀錄（{a.history.length}）</h4>
            <HistoryTable records={a.history} valueLabel="到期日" onDelete={(id) => setItem((x) => ({ ...x, history: x.history.filter((r) => r.id !== id) }), '刪除設備證書修改紀錄', a.name)} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}

type FilingDraft = { name: string; everyYears: string; dueMonth: string; lastMonth: string; note: string };
const emptyFiling = (): FilingDraft => ({ name: '', everyYears: '1', dueMonth: '12', lastMonth: '', note: '' });
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function checkFiling(f: FilingDraft): string {
  if (!f.name.trim()) return '請輸入申報項目';
  const y = Number(f.everyYears);
  if (!Number.isInteger(y) || y < 1 || y > 20) return '申報週期要是 1～20 年';
  return '';
}

const fromFilingDraft = (f: FilingDraft) => ({ name: f.name.trim(), everyYears: Number(f.everyYears), dueMonth: Number(f.dueMonth), lastMonth: f.lastMonth, note: f.note.trim() });

function FilingFields({ draft, onChange }: { draft: FilingDraft; onChange: (d: FilingDraft) => void }) {
  const set = (patch: Partial<FilingDraft>) => onChange({ ...draft, ...patch });
  return (
    <div className="form-row">
      <label>申報項目<input value={draft.name} placeholder="例如水塔清洗" onChange={(e) => set({ name: e.target.value })} /></label>
      <label>每幾年申報一次<input type="number" min={1} max={20} className="short-num" value={draft.everyYears} onChange={(e) => set({ everyYears: e.target.value })} /></label>
      <label>
        幾月底前要完成
        <select value={draft.dueMonth} onChange={(e) => set({ dueMonth: e.target.value })}>
          {MONTHS.map((m) => <option key={m} value={m}>{m} 月</option>)}
        </select>
      </label>
      <label>最近一次申報月份<input type="month" value={draft.lastMonth} onChange={(e) => set({ lastMonth: e.target.value })} /></label>
      <label>備註<input value={draft.note} onChange={(e) => set({ note: e.target.value })} /></label>
    </div>
  );
}

function Filings({ warn, toSettings }: { warn: number; toSettings: ReactNode }) {
  const { data, update } = useStore();
  const list = [...(data.filings ?? [])].sort((a, b) => filingDue(a).month.localeCompare(filingDue(b).month));

  const [draft, setDraft] = useState<FilingDraft>(emptyFiling);
  const [open, setOpen] = useState('');
  const [msg, setMsg] = useState('');

  function add() {
    const err = checkFiling(draft);
    if (err) return setMsg(err);
    const base: Filing = { id: newId('fl_'), history: [], ...fromFilingDraft(draft) };
    const f = base.lastMonth ? withRecord(base, base.lastMonth, `新增：${filingDetail(base)}`) : base;
    update((d) => ({ ...d, filings: [...(d.filings ?? []), f] }), '新增政府申報', `${f.name} ${filingDetail(f)}`);
    setDraft(emptyFiling());
    setMsg('');
  }

  return (
    <>
      <Section title={`政府申報（${list.length}）`}>
        <p className="hint">
          依「每幾年申報一次」與「幾月底前要完成」計算下次期限：有最近一次申報月份時往後推，還沒填時取今天以後最近的期限月份。
          期限前 {warn} 個月起，該列會一直標成黃色，直到更新最近一次申報月份（提醒時間可以在{toSettings}修改）。透保水檢查、消防申報、公安申報是預先載入的一般規定，週期與月份請依所在縣市的公告修改。
        </p>
        {list.length === 0 ? (
          <p className="empty">沒有政府申報項目，從下方新增。</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>申報項目</th><th>週期</th><th>最近一次申報</th><th>下次期限</th><th>到期</th><th></th></tr></thead>
              <tbody>
                {list.map((f) => <FilingRow key={f.id} item={f} warn={warn} open={open === f.id} onToggle={() => setOpen(open === f.id ? '' : f.id)} />)}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <Section title="新增申報項目">
        <FilingFields draft={draft} onChange={setDraft} />
        <div className="form-row">
          <button className="primary" onClick={add}><Icon name="check" />新增</button>
          {msg && <span className="err">{msg}</span>}
        </div>
      </Section>
    </>
  );
}

function FilingRow({ item: f, warn, open, onToggle }: { item: Filing; warn: number; open: boolean; onToggle: () => void }) {
  const { update } = useStore();
  const toDraft = (): FilingDraft => ({ name: f.name, everyYears: String(f.everyYears), dueMonth: String(f.dueMonth), lastMonth: f.lastMonth, note: f.note });
  const [draft, setDraft] = useState<FilingDraft>(toDraft);
  const [msg, setMsg] = useState('');
  const due = filingDue(f, undefined, warn);
  const setItem = (fn: (x: Filing) => Filing, action: string, detail: string) =>
    update((d) => ({ ...d, filings: (d.filings ?? []).map((x) => (x.id === f.id ? fn(x) : x)) }), action, detail);

  function save(next: FilingDraft = draft) {
    const err = checkFiling(next);
    if (err) return setMsg(err);
    const item = { ...f, ...fromFilingDraft(next) };
    setItem(() => withRecord(item, item.lastMonth, filingDetail(item)), '修改政府申報', `${item.name} 最近一次 ${item.lastMonth || '未填'}`);
    setDraft(next);
    setMsg('已儲存，並新增一筆修改紀錄。');
  }

  function remove() {
    if (!confirm(`刪除申報項目「${f.name}」？修改紀錄也會一起刪除。`)) return;
    update((d) => ({ ...d, filings: (d.filings ?? []).filter((x) => x.id !== f.id) }), '刪除政府申報', f.name);
  }

  return (
    <Fragment>
      <tr className={[needsAttention(due) ? 'attention' : '', open ? 'is-open' : ''].join(' ').trim() || undefined}>
        <td>{f.name}{f.note && <div className="muted small">{f.note}</div>}</td>
        <td>每 {f.everyYears} 年，{f.dueMonth} 月底前</td>
        <td>{f.lastMonth || <span className="muted">未填</span>}</td>
        <td>{due.month}</td>
        <td><DueTag due={due} /></td>
        <td><button className="link" onClick={() => { setDraft(toDraft()); setMsg(''); onToggle(); }} aria-expanded={open}>{open ? '收合' : '展開'}</button></td>
      </tr>
      {open && (
        <tr className="expand-row">
          <td colSpan={6}>
            <h4>修改（申報完成後更新最近一次申報月份）</h4>
            <FilingFields draft={draft} onChange={setDraft} />
            <div className="form-row">
              <button className="primary" onClick={() => save()}>儲存變更</button>
              <button onClick={() => save({ ...draft, lastMonth: thisMonth() })}>本月已完成申報</button>
              <button className="link danger" onClick={remove}>刪除</button>
              {msg && <span className={msg.startsWith('已') ? 'hint' : 'err'}>{msg}</span>}
            </div>
            <h4>修改紀錄（{f.history.length}）</h4>
            <HistoryTable records={f.history} valueLabel="申報完成月份" onDelete={(id) => setItem((x) => ({ ...x, history: x.history.filter((r) => r.id !== id) }), '刪除政府申報修改紀錄', f.name)} />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
