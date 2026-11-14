import { useMemo, useState } from 'react';
import type { Go } from '../components/nav';
import { Icon } from '../components/icons';
import { isEnterKey, Money, Section, thisMonth } from '../components/ui';
import { allocateAll, normUnit } from '../lib/allocation';
import { addMonths, todayStr } from '../lib/dates';
import { newId, resolveDepositAccountId } from '../lib/defaults';
import { activeUnits, sortUnits } from '../lib/fees';
import { nextVoucher } from '../lib/ledger';
import { addRenovationOpening, computeDeductions, isBeforeOpening, removeDepositReceipt, removeRenovation, renameRenovationLabel, RenovationLabelKind, renovationSettings, settleRenovation, cancelSettlement, UnitDeposit, unitDeposits } from '../lib/renovation';
import { AppData, Renovation, RenovationFeeMode, RenovationPlan, RenovationRateItem, RenovationSettings } from '../lib/types';
import { useStore } from '../store';

const fmt = (n: number) => n.toLocaleString('zh-TW');
const modeLabel = { once: '單筆', daily: '每日' } as const;

/** 日常記帳 → 裝潢保證金：各戶收到的保證金、套用的費率方案、施工開始日與結算退款。 */
export default function RenovationPage({ go }: { go: Go }) {
  const { data } = useStore();
  const month = thisMonth();
  const alloc = useMemo(() => allocateAll(data), [data]);
  const deposits = useMemo(() => unitDeposits(data, alloc, month), [data, alloc, month]);
  const [selected, setSelected] = useState('');
  const [pick, setPick] = useState('');
  const [msg, setMsg] = useState('');
  const units = sortUnits(activeUnits(data.settings.units));
  const inProgress = Array.from(deposits.values())
    .filter((u) => u.openTotal > 0 || u.renovation)
    .sort((a, b) => a.unitNo.localeCompare(b.unitNo, 'zh-Hant', { numeric: true }));
  const settledCount = data.renovations.filter((r) => r.settlement).length;
  const openTotal = inProgress.reduce((t, u) => t + u.openTotal, 0);

  function open(input: string) {
    const kw = input.trim().toUpperCase();
    if (!kw) return;
    const unit = units.find((u) => normUnit(u.unitNo) === normUnit(input)) ?? units.find((u) => u.unitNo.toUpperCase().includes(kw));
    if (!unit) return setMsg(`找不到「${input.trim()}」，請輸入戶別代碼，例如 A01-02`);
    setMsg('');
    setPick('');
    setSelected(normUnit(unit.unitNo));
  }

  const current = selected ? deposits.get(selected) ?? emptyDeposit(selected, units.find((u) => normUnit(u.unitNo) === selected)?.unitNo ?? selected) : null;

  return (
    <>
      <h1>裝潢保證金</h1>
      <p className="hint">
        智生活帳單上對應到「裝潢保證金」的項目（「基本設定 → 帳單項目對應」）不列入每月應繳，住戶繳款後會自動出現在這裡；不是透過智生活收的，可以在各戶裡手動登錄。
        每戶獨立操作：選擇戶別後設定費率方案與施工開始日，完工後按「結算」，依方案扣除保護費、清潔費等，算出應退金額並列入月報。
      </p>
      <Section title={`進行中的裝潢保證金（${inProgress.length} 戶）`} actions={<button onClick={() => go('units', 'units')}>戶別與月費 →</button>}>
        <div className={`banner ${openTotal ? 'warn' : 'ok'}`}>
          <span>
            {openTotal ? <>尚未結算的保證金合計 <Money value={openTotal} strong /> 元。</> : '目前沒有尚未結算的裝潢保證金。'}
            {settledCount ? `已結算 ${settledCount} 筆，結算紀錄在各戶裡。` : ''}
          </span>
        </div>
        <div className="form-row">
          <label>
            選擇戶別
            <input list="renovation-units" placeholder="搜尋戶別代碼，例如 A01-02" value={pick} onChange={(e) => setPick(e.target.value)} onKeyDown={(e) => isEnterKey(e) && open(pick)} />
          </label>
          <datalist id="renovation-units">
            {units.map((u) => <option key={u.id} value={u.unitNo}>{u.owner}</option>)}
          </datalist>
          <button className="primary" onClick={() => open(pick)} disabled={!pick.trim()}>開啟這戶</button>
        </div>
        {msg && <p className="err">{msg}</p>}
        {inProgress.length > 0 && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>戶別</th><th>所有權人</th><th className="num">已收保證金</th><th>入帳日期</th><th>施工開始</th><th>費率方案</th><th></th></tr></thead>
              <tbody>
                {inProgress.map((u) => (
                  <tr key={u.key} className={selected === u.key ? 'selected' : ''}>
                    <td><button className="link" onClick={() => setSelected(u.key)}>{u.unitNo}</button></td>
                    <td>{u.owner}</td>
                    <td className="num"><Money value={u.openTotal} /></td>
                    <td>{u.open.map((r) => r.date).join('、') || <span className="muted">還沒收到</span>}</td>
                    <td>{u.renovation?.startDate || <span className="muted">未填</span>}</td>
                    <td>{u.renovation?.planName || <span className="muted">未選擇</span>}</td>
                    <td><button className="link" onClick={() => setSelected(u.key)}>管理</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {current && <UnitRenovation key={current.key} info={current} onClose={() => setSelected('')} />}

      <PlanEditor />
      <LabelEditor />
    </>
  );
}

function emptyDeposit(key: string, unitNo: string): UnitDeposit {
  return { key, unitNo, owner: '', open: [], openTotal: 0, settled: [] };
}

/** 一戶的裝潢保證金：收款、方案、施工開始日、結算與結算紀錄。 */
function UnitRenovation({ info, onClose }: { info: UnitDeposit; onClose: () => void }) {
  const { data, update, isClosed } = useStore();
  const s = data.settings;
  const cfg = renovationSettings(s);
  const month = thisMonth();
  const unit = s.units.find((u) => normUnit(u.unitNo) === info.key);
  const r = info.renovation;
  const [planId, setPlanId] = useState(cfg.plans[0]?.id ?? '');
  const [days, setDays] = useState<Record<string, number>>({});
  const [manual, setManual] = useState({ date: todayStr(), amount: '', accountId: resolveDepositAccountId(s) || s.accounts[0]?.id || '' });
  const [opening, setOpening] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [msg, setMsg] = useState('');
  const canOpening = isBeforeOpening(s, manual.accountId, manual.date);
  const accOpening = s.accounts.find((a) => a.id === manual.accountId)?.openingDate ?? '';
  const asOpening = canOpening && opening;
  const accName = (id: string) => s.accounts.find((a) => a.id === id)?.name ?? '';

  const items = r?.items ?? [];
  const deductions = computeDeductions(items, days);
  const deducted = deductions.reduce((t, d) => t + d.deducted, 0);
  const deposit = info.openTotal;
  const refundTotal = Math.max(0, deposit - deducted);

  const saveRenovation = (patch: Partial<Renovation>, action: string, detail: string) =>
    update((d) => {
      const prev = d.renovations.find((x) => x.id === r?.id);
      const next: Renovation = prev
        ? { ...prev, ...patch }
        : { id: newId('rn_'), unitNo: info.unitNo, planName: '', items: [], startDate: '', note: '', createdAt: new Date().toISOString(), ...patch };
      return { ...d, renovations: [...d.renovations.filter((x) => x.id !== next.id), next] };
    }, action, `${info.unitNo} ${detail}`);

  function applyPlan() {
    const plan = cfg.plans.find((p) => p.id === planId);
    if (!plan) return;
    if (r?.planName && !confirm(`改用「${plan.name}」？會換成這個方案目前的內容。`)) return;
    saveRenovation({ planName: plan.name, items: plan.items.map((i) => ({ ...i })) }, '套用裝潢保證金方案', plan.name);
    setDays({});
  }

  function addManual() {
    const amount = Math.round(Number(manual.amount));
    if (!manual.date || !Number.isFinite(amount) || amount <= 0) return setMsg('請輸入收到的日期與金額');
    if (asOpening) {
      update((d) => addRenovationOpening(d, { unitNo: info.unitNo, date: manual.date, amount, accountId: manual.accountId }), '登錄建立系統前已收的裝潢保證金', `${info.unitNo} ${manual.date} ${amount}`);
      setManual({ ...manual, amount: '' });
      setMsg('');
      return;
    }
    if (isClosed(manual.date)) return setMsg('該月份已結帳，請先解除月結');
    update((d) => ({
      ...d,
      settings: { ...d.settings, incomeCategories: d.settings.incomeCategories.includes(cfg.depositLabel) ? d.settings.incomeCategories : [...d.settings.incomeCategories, cfg.depositLabel] },
      entries: [...d.entries, {
        id: newId('e_'), date: manual.date, type: 'income', category: cfg.depositLabel, accountId: manual.accountId, toAccountId: '', amount,
        counterparty: '', voucherNo: nextVoucher(d.entries, manual.date), note: '', renovationKind: 'deposit', renovationUnit: info.unitNo,
      }],
    }), '登錄裝潢保證金', `${info.unitNo} ${manual.date} ${amount}`);
    setManual({ ...manual, amount: '' });
    setMsg('');
  }

  /** 刪除還沒結算的保證金；這戶刪完沒有其他保證金、又有施工開始日或費率方案時，詢問要不要一起清除。 */
  function removeReceipt(id: string) {
    const x = info.open.find((o) => o.id === id);
    if (!x) return;
    if (x.source === 'manual' && isClosed(x.date)) return setMsg('該月份已結帳，請先解除月結');
    const what = x.source === 'opening' ? '建立系統前已收' : '手動登錄';
    if (!confirm(`刪除 ${x.date} ${what}的保證金 ${fmt(x.amount)} 元？`)) return;
    const last = !info.open.some((o) => o.id !== id);
    const clear = last && !!r && confirm('這戶已經沒有其他保證金了，要一起清除施工開始日與費率方案，讓這戶不再列在「進行中」嗎？\n（按「取消」只刪除這筆保證金）');
    update(
      (d) => removeDepositReceipt(d, info, id, clear),
      x.source === 'opening' ? '刪除建立系統前已收的裝潢保證金' : '刪除裝潢保證金',
      `${info.unitNo} ${x.date} ${x.amount}${clear ? '，並清除施工開始日與費率方案' : ''}`,
    );
    setMsg('');
  }

  function clearProgress() {
    if (!r) return;
    const detail = [r.startDate && `施工開始日 ${r.startDate}`, r.planName && `費率方案「${r.planName}」`].filter(Boolean).join('、') || '進行中的紀錄';
    if (!confirm(`清除這戶的${detail}？收到的保證金與結算紀錄不受影響。`)) return;
    update((d) => removeRenovation(d, r.id), '清除裝潢施工紀錄', `${info.unitNo} ${detail}`);
    setDays({});
  }

  function cancel(x: Renovation) {
    const st = x.settlement!;
    if (isClosed(st.date)) return setMsg(`退款列在 ${st.date.slice(0, 7)}，該月份已結帳，請先解除月結`);
    if (!confirm(`取消 ${st.date} 的結算？會刪除退款 ${fmt(st.refund)} 元${st.fee ? `與手續費 ${fmt(st.fee)} 元` : ''}的分錄，這戶回到尚未結算。`)) return;
    update((d) => cancelSettlement(d, x.id), '取消裝潢保證金結算', `${info.unitNo} ${st.date}`);
  }

  return (
    <Section title={`${info.unitNo}${info.owner ? `　${info.owner}` : unit?.owner ? `　${unit.owner}` : ''}　裝潢保證金`} actions={<button onClick={onClose}>關閉</button>}>
      <div className="stats">
        <div className="stat c-purple"><div className="stat-label">目前保證金</div><div className="stat-value"><Money value={deposit} /></div><div className="stat-hint">{info.open.length ? `${info.open.length} 筆，${info.open.map((x) => x.date).join('、')} 入帳` : '還沒收到保證金'}</div></div>
        <div className="stat c-blue"><div className="stat-label">施工開始</div><div className="stat-value small-value">{r?.startDate || '未填'}</div><div className="stat-hint">{r?.planName ? `方案：${r.planName}` : '還沒選擇費率方案'}</div></div>
        <div className="stat c-green"><div className="stat-label">依目前輸入應退</div><div className="stat-value"><Money value={refundTotal} /></div><div className="stat-hint">扣款 {fmt(deducted)} 元</div></div>
      </div>

      <h3 className="sub-title">收到的保證金</h3>
      <div className="table-wrap">
        <table className="compact-inputs">
          <thead><tr><th>入帳日期</th><th>來源</th><th className="num">金額</th><th></th></tr></thead>
          <tbody>
            {info.open.map((x) => (
              <tr key={x.id}>
                <td>{x.date}</td>
                <td>{x.source === 'payment' ? <span className="tag info">智生活繳費</span> : x.source === 'opening' ? <span className="tag purple" title="已含在帳戶期初餘額，不影響帳戶餘額與報表">建立系統前已收</span> : <span className="tag">手動登錄</span>}</td>
                <td className="num"><Money value={x.amount} /></td>
                <td>
                  {x.source !== 'payment' && <button className="link danger" onClick={() => removeReceipt(x.id)}>刪除</button>}
                </td>
              </tr>
            ))}
            <tr className="add-row">
              <td><input type="date" value={manual.date} onChange={(e) => setManual({ ...manual, date: e.target.value })} /></td>
              <td>
                <select value={manual.accountId} onChange={(e) => setManual({ ...manual, accountId: e.target.value })}>
                  {s.accounts.map((a) => <option key={a.id} value={a.id}>存入 {a.name}</option>)}
                </select>
              </td>
              <td><input type="number" min={0} className="short-num" placeholder="金額" value={manual.amount} onChange={(e) => setManual({ ...manual, amount: e.target.value })} onKeyDown={(e) => isEnterKey(e) && addManual()} /></td>
              <td><button onClick={addManual} disabled={!manual.amount}>手動登錄</button></td>
            </tr>
            {canOpening && (
              <tr className="add-row">
                <td colSpan={4}>
                  <label className="check">
                    <input type="checkbox" checked={opening} onChange={(e) => setOpening(e.target.checked)} />
                    建立系統前已收（已含在帳戶期初餘額，{accOpening} 以前入帳）
                  </label>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="hint">
        透過智生活繳的保證金會自動列出；現金或其他方式收到的請手動登錄，會記一筆「{cfg.depositLabel}」收入存入選擇的帳戶。
        入帳日期早於帳戶期初日期時可以勾「建立系統前已收」：只記在這戶當作保證金，不改變帳戶餘額，也不列入收支報表；結算退款時照常從帳戶扣款、列入報表。
      </p>

      <h3 className="sub-title">施工與費率方案</h3>
      <div className="form-row">
        <label>
          施工開始日
          <input type="date" value={r?.startDate ?? ''} onChange={(e) => saveRenovation({ startDate: e.target.value }, '設定施工開始日', e.target.value)} />
        </label>
        <label>
          費率方案
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {cfg.plans.map((p) => <option key={p.id} value={p.id}>{p.name}{p.items.length ? '' : '（無費率）'}</option>)}
          </select>
        </label>
        <button onClick={applyPlan}>{r?.planName ? '改用這個方案' : '套用方案'}</button>
        {r && <button className="danger" onClick={clearProgress}>清除施工開始日與方案</button>}
      </div>
      {r?.planName ? (
        <p className="hint">這戶套用「{r.planName}」（套用當時的內容，之後修改方案不影響這戶）。</p>
      ) : (
        <p className="hint">請先選擇費率方案；沒有要扣的費用請選「無費率」。</p>
      )}

      {r?.planName && (
        <>
          <h3 className="sub-title">結算</h3>
          <div className="table-wrap">
            <table className="compact-inputs">
              <thead><tr><th>費率項目</th><th>計算方式</th><th className="num">金額</th><th>天數</th><th className="num">應扣</th></tr></thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={i.id}>
                    <td>{i.name}</td>
                    <td>{i.mode === 'daily' ? '每日' : '單筆'}</td>
                    <td className="num">{fmt(i.amount)}{i.mode === 'daily' ? ' / 日' : ''}</td>
                    <td>
                      {i.mode === 'daily' ? (
                        <input type="number" min={0} className="short-num" placeholder="共幾日" value={days[i.id] ?? ''} onChange={(e) => setDays({ ...days, [i.id]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} />
                      ) : <span className="muted">—</span>}
                    </td>
                    <td className="num"><Money value={deductions[idx].deducted} /></td>
                  </tr>
                ))}
                {items.length === 0 && <tr><td colSpan={5} className="muted">無費率：不扣任何費用，保證金全額退還。</td></tr>}
                <tr className="total"><td colSpan={4}>應扣合計</td><td className="num"><Money value={deducted} /></td></tr>
              </tbody>
            </table>
          </div>
          {deducted > deposit && <p className="warn">應扣金額超過目前保證金，應退金額以 0 計算。</p>}
          <div className="form-row">
            <button className="primary" onClick={() => setConfirming(true)} disabled={deposit <= 0}>結算</button>
            {deposit <= 0 && <span className="hint">還沒收到保證金，不能結算。</span>}
          </div>
        </>
      )}
      {msg && <p className="err">{msg}</p>}

      {info.settled.length > 0 && (
        <>
          <h3 className="sub-title">結算紀錄</h3>
          <div className="table-wrap">
            <table>
              <thead><tr><th>列入報表</th><th>方案</th><th className="num">保證金</th><th>扣款</th><th className="num">應退</th><th className="num">退款</th><th className="num">手續費</th><th>帳戶</th><th></th></tr></thead>
              <tbody>
                {info.settled.map((x) => {
                  const st = x.settlement!;
                  return (
                    <tr key={x.id}>
                      <td>{st.date}</td>
                      <td>{x.planName}</td>
                      <td className="num"><Money value={st.deposit} /></td>
                      <td className="note-cell wide-note">{st.deductions.filter((d) => d.deducted).map((d) => `${d.name}${d.days !== undefined ? ` ${d.days} 日` : ''} ${fmt(d.deducted)}`).join('、') || '無'}</td>
                      <td className="num"><Money value={st.refundTotal} /></td>
                      <td className="num"><Money value={st.refund} /></td>
                      <td className="num">{st.fee ? <><Money value={st.fee} />{st.feeMode === 'combined' && <span className="muted">（併入退款）</span>}</> : ''}</td>
                      <td>{accName(st.accountId)}</td>
                      <td><button className="link danger" onClick={() => cancel(x)}>取消結算</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {confirming && r && (
        <SettleModal
          info={info}
          renovation={r}
          deductions={deductions}
          month={month}
          onCancel={() => setConfirming(false)}
          onDone={() => { setConfirming(false); setDays({}); }}
        />
      )}
    </Section>
  );
}

/** 結算確認視窗：顯示保證金、各項扣款與應退金額，選擇列入哪個月份，分開輸入退款與匯款手續費。 */
function SettleModal({ info, renovation, deductions, month, onCancel, onDone }: {
  info: UnitDeposit; renovation: Renovation; deductions: ReturnType<typeof computeDeductions>; month: string; onCancel: () => void; onDone: () => void;
}) {
  const { data, update, isClosed } = useStore();
  const s = data.settings;
  const cfg = renovationSettings(s);
  const deposit = info.openTotal;
  const deducted = deductions.reduce((t, d) => t + d.deducted, 0);
  const total = Math.max(0, deposit - deducted);
  const next = addMonths(month, 1);
  const [target, setTarget] = useState<'this' | 'next'>(isClosed(`${month}-01`) ? 'next' : 'this');
  const [fee, setFee] = useState(0);
  const [feeMode, setFeeMode] = useState<RenovationFeeMode>(cfg.feeMode);
  const [accountId, setAccountId] = useState(resolveDepositAccountId(s) || s.accounts[0]?.id || '');
  const [err, setErr] = useState('');
  const refund = total - fee;
  const date = target === 'this' ? todayStr() : `${next}-01`;

  function confirmSettle() {
    if (fee < 0 || fee > total) return setErr(`匯款手續費要在 0～${fmt(total)} 元之間`);
    if (refund + fee !== total) return setErr('退款金額加匯款手續費要等於應退金額');
    if (isClosed(date)) return setErr(`${date.slice(0, 7)} 已結帳，請選另一個月份或先解除月結`);
    update(
      (d: AppData) => settleRenovation(d, {
        unitNo: info.unitNo, renovation, planName: renovation.planName, items: renovation.items, startDate: renovation.startDate,
        deposit, receiptIds: info.open.map((x) => x.id), deductions, refund, fee, feeMode, date, accountId,
      }),
      '裝潢保證金結算',
      `${info.unitNo} 保證金 ${deposit} 扣款 ${deducted} 退款 ${refund} 手續費 ${fee}（${feeMode === 'combined' ? '整筆呈現' : '分開呈現'}）`,
    );
    onDone();
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal wide" role="dialog" aria-label="裝潢保證金結算" onClick={(e) => e.stopPropagation()}>
        <h2>裝潢保證金結算：{info.unitNo}</h2>
        <table className="kv">
          <tbody>
            <tr><th>裝潢保證金</th><td><Money value={deposit} strong /> 元</td></tr>
            {deductions.map((d, i) => (
              <tr key={i}><th>扣：{d.name}</th><td>{d.mode === 'daily' ? `${fmt(d.amount)} 元 × ${d.days ?? 0} 日 ＝ ` : ''}<Money value={d.deducted} /> 元</td></tr>
            ))}
            {deductions.length === 0 && <tr><th>扣款</th><td>無費率，不扣任何費用</td></tr>}
            <tr><th>扣款合計</th><td><Money value={deducted} /> 元</td></tr>
            <tr className="total"><th>應退金額</th><td><Money value={total} strong /> 元</td></tr>
          </tbody>
        </table>
        <div className="form-row">
          <label>
            列入報表
            <select value={target} onChange={(e) => setTarget(e.target.value as 'this' | 'next')}>
              <option value="this" disabled={isClosed(`${month}-01`)}>本月（{month}）</option>
              <option value="next">下個月（{next}）</option>
            </select>
          </label>
          <label>
            退款金額
            <input type="number" className="short-num" value={refund} readOnly title="應退金額扣掉匯款手續費" />
          </label>
          <label>
            匯款手續費
            <input type="number" min={0} className="short-num" value={fee || ''} placeholder="0" onChange={(e) => setFee(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
          </label>
          <label>
            付款帳戶
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              {s.accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        </div>
        <div className="form-row">
          <span className="muted">手續費在財報上</span>
          <div className="seg" role="radiogroup" aria-label="手續費在財報上的呈現方式">
            <button role="radio" aria-checked={feeMode === 'separate'} className={feeMode === 'separate' ? 'primary' : ''} onClick={() => setFeeMode('separate')}>單獨呈現「{cfg.feeLabel}」</button>
            <button role="radio" aria-checked={feeMode === 'combined'} className={feeMode === 'combined' ? 'primary' : ''} onClick={() => setFeeMode('combined')}>併入「{cfg.refundLabel}」整筆呈現</button>
          </div>
        </div>
        <p className="hint">
          {feeMode === 'combined' || !fee
            ? `確認後在 ${date} 建立支出「${cfg.refundLabel}」${fmt(refund + fee)} 元${fee ? `（含匯款手續費 ${fmt(fee)} 元）` : ''}，列入 ${date.slice(0, 7)} 的月報。`
            : `確認後在 ${date} 建立支出「${cfg.refundLabel}」${fmt(refund)} 元與「${cfg.feeLabel}」${fmt(fee)} 元，列入 ${date.slice(0, 7)} 的月報。`}
          報表上不顯示戶別，同一個月有多戶結算時，同一個科目合併成一筆。預設整筆都是退款，有輸入手續費時從退款扣掉。
        </p>
        {err && <p className="err">{err}</p>}
        <div className="form-row modal-actions">
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={confirmSettle}><Icon name="check" />確認結算</button>
        </div>
      </div>
    </div>
  );
}

/** 保證金費率方案：每個方案有多個項目（單筆或每日）；沒有項目就是無費率。修改方案不影響已套用的戶別。 */
function PlanEditor() {
  const { data, update } = useStore();
  const cfg = renovationSettings(data.settings);
  const save = (plans: RenovationPlan[], action: string, detail: string) =>
    update((d) => ({ ...d, settings: { ...d.settings, renovation: { ...renovationSettings(d.settings), plans } } }), action, detail);
  const setPlan = (id: string, patch: Partial<RenovationPlan>, action: string, detail: string) => save(cfg.plans.map((p) => (p.id === id ? { ...p, ...patch } : p)), action, detail);
  const setItem = (plan: RenovationPlan, itemId: string, patch: Partial<RenovationRateItem>) =>
    setPlan(plan.id, { items: plan.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }, '修改保證金費率', `${plan.name}`);

  return (
    <Section title={`保證金費率方案（${cfg.plans.length}）`} actions={<button onClick={() => save([...cfg.plans, { id: newId('rp_'), name: `方案 ${cfg.plans.length + 1}`, items: [] }], '新增保證金方案', '')}>新增方案</button>}>
      <p className="hint">
        每個方案可以有好幾個項目，例如保護費（單筆）、清潔費（每日）；單筆結算時直接扣，每日在結算時輸入天數計算。單筆跟每日可以混搭。
        沒有項目的方案就是「無費率」（扣款 0）。各戶套用時會記下當時的內容，之後修改方案不影響已套用的戶別。這些方案和管理費的費率方案無關。
      </p>
      {cfg.plans.map((plan) => (
        <div key={plan.id} className="plan-block">
          <div className="form-row">
            <label>
              方案名稱
              <input defaultValue={plan.name} key={plan.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== plan.name && setPlan(plan.id, { name: e.target.value.trim() }, '修改保證金方案名稱', e.target.value.trim())} />
            </label>
            <span className="tag">{plan.items.length ? `${plan.items.length} 個項目` : '無費率'}</span>
            <button className="link danger" disabled={cfg.plans.length <= 1} onClick={() => confirm(`刪除方案「${plan.name}」？已套用的戶別不受影響。`) && save(cfg.plans.filter((p) => p.id !== plan.id), '刪除保證金方案', plan.name)}>刪除方案</button>
          </div>
          <table className="compact-inputs status-table">
            <thead><tr><th>項目</th><th>計算方式</th><th className="num">金額</th><th></th></tr></thead>
            <tbody>
              {plan.items.map((i) => (
                <tr key={i.id}>
                  <td><input defaultValue={i.name} key={i.name} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== i.name && setItem(plan, i.id, { name: e.target.value.trim() })} /></td>
                  <td>
                    <select value={i.mode} onChange={(e) => setItem(plan, i.id, { mode: e.target.value as RenovationRateItem['mode'] })}>
                      <option value="once">{modeLabel.once}（直接扣）</option>
                      <option value="daily">{modeLabel.daily}（× 天數）</option>
                    </select>
                  </td>
                  <td><input type="number" min={0} className="short-num" defaultValue={i.amount} key={`a${i.amount}`} onBlur={(e) => Number(e.target.value) !== i.amount && setItem(plan, i.id, { amount: Math.max(0, Math.round(Number(e.target.value) || 0)) })} /></td>
                  <td><button className="link danger" onClick={() => setPlan(plan.id, { items: plan.items.filter((x) => x.id !== i.id) }, '刪除保證金費率', `${plan.name} ${i.name}`)}>刪除</button></td>
                </tr>
              ))}
              <tr className="add-row">
                <td colSpan={4}>
                  <button onClick={() => setPlan(plan.id, { items: [...plan.items, { id: newId('ri_'), name: plan.items.length ? '清潔費' : '保護費', mode: plan.items.length ? 'daily' : 'once', amount: 0 }] }, '新增保證金費率', plan.name)}>新增項目</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}
    </Section>
  );
}

/** 報表科目名稱：收到保證金、結算退款、退款手續費；改名時已建立的分錄一起改，報表同步更新。 */
function LabelEditor() {
  const { data, update } = useStore();
  const cfg: RenovationSettings = renovationSettings(data.settings);
  const fields: { kind: RenovationLabelKind; label: string; value: string }[] = [
    { kind: 'deposit', label: '收到保證金', value: cfg.depositLabel },
    { kind: 'refund', label: '結算退款', value: cfg.refundLabel },
    { kind: 'fee', label: '退款匯款手續費（單獨呈現時）', value: cfg.feeLabel },
  ];
  return (
    <Section title="報表科目名稱">
      <p className="hint">
        收到的保證金列為收入，結算的退款與手續費列為支出；改名後已建立的分錄、報表與「基本設定」的固定支出勾選會一起更新。
        報表上不顯示戶別，同一個月多戶結算時同一個科目合併成一筆。退款和手續費要不要列為固定支出，請到「基本設定 → 收支科目」勾選。
      </p>
      <div className="form-row">
        {fields.map((f) => (
          <label key={f.kind}>
            {f.label}
            <input defaultValue={f.value} key={f.value} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== f.value && update((d) => renameRenovationLabel(d, f.kind, e.target.value), `修改${f.label}科目名稱`, `${f.value} → ${e.target.value.trim()}`)} />
          </label>
        ))}
      </div>
    </Section>
  );
}
