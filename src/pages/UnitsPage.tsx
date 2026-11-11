import { useMemo, useState } from 'react';
import FirstSetupGuide from '../components/FirstSetupGuide';
import { Go, useNavArg } from '../components/nav';
import OpeningPrepaid from '../components/OpeningPrepaid';
import OwnerHistory from '../components/OwnerHistory';
import MonthDues from '../components/MonthDues';
import { useSelection } from '../components/useSelection';
import { isEnterKey, Money, Section } from '../components/ui';
import { normUnit } from '../lib/allocation';
import { newId } from '../lib/defaults';
import { activeUnits, assignAmount, assignCycle, assignExtra, assignPlan, cycleLabel, CYCLES, extraItem, planFee, removeExtra, setUnitItemBaseline, removePlan, setUnitArea, sortUnits, unitBaseline, updatePlan } from '../lib/fees';
import { ownerHistory, ownerMatches } from '../lib/owners';
import { FeePlan, Settings, Unit } from '../lib/types';
import { useStore } from '../store';

type Tab = 'units' | 'dues' | 'prepaid';
const CUSTOM = '__custom';
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

export default function UnitsPage({ go }: { go: Go }) {
  const { data, update } = useStore();
  const s = data.settings;
  const live = activeUnits(s.units);
  const navArg = useNavArg();
  const [tab, setTab] = useState<Tab>(navArg === 'units' || navArg === 'prepaid' ? navArg : 'dues');
  const [ownerUnit, setOwnerUnit] = useState<Unit | null>(null);
  const [q, setQ] = useState('');
  const [planFilter, setPlanFilter] = useState('');
  const [batchPlan, setBatchPlan] = useState('');
  const [batchAmount, setBatchAmount] = useState('');
  const [newUnit, setNewUnit] = useState('');
  const [batchExtra, setBatchExtra] = useState('');
  const [batchQty, setBatchQty] = useState('1');
  const [batchCycle, setBatchCycle] = useState(1);
  const [batchStart, setBatchStart] = useState(1);

  const save = (fn: (st: Settings) => Partial<Settings>, action: string, detail = '') =>
    update((d) => ({ ...d, settings: { ...d.settings, ...fn(d.settings) } }), action, detail);

  const units = useMemo(() => sortUnits(activeUnits(s.units)), [s.units]);
  const kw = q.trim().toUpperCase();
  const shown = units
    .filter((u) => !planFilter || (planFilter === CUSTOM ? !u.planId : u.planId === planFilter || !!u.extras?.some((e) => e.planId === planFilter)))
    .filter((u) => !kw || u.unitNo.toUpperCase().includes(kw) || ownerMatches(u, kw));
  const { sel, setSel, toggle, selectShown, selectedShown } = useSelection(shown);

  const labelOf = (ids: Set<string>) => {
    const list = units.filter((u) => ids.has(u.id)).map((u) => u.unitNo);
    return list.length > 6 ? `${list.slice(0, 6).join('、')} 等 ${list.length} 戶` : list.join('、');
  };

  function applyBatchPlan() {
    const plan = s.feePlans.find((p) => p.id === batchPlan);
    if (!plan || !sel.size) return;
    save((st) => ({ units: assignPlan(st.units, sel, plan) }), '批次套用費率方案', `${plan.name}：${labelOf(sel)}`);
  }

  function applyBatchAmount() {
    const amount = Number(batchAmount);
    if (!sel.size || !Number.isFinite(amount) || batchAmount === '') return;
    save((st) => ({ units: assignAmount(st.units, sel, amount) }), '批次設定月費', `${amount}：${labelOf(sel)}`);
    setBatchAmount('');
  }

  function removeSelected() {
    if (!sel.size || !confirm(`排除勾選的 ${sel.size} 個戶別？\n排除後不列入應繳、欠費與銷帳，之後匯入範本也會自動略過；可在「基本設定 → 已排除的戶別」加回。已匯入的繳費紀錄不會刪除。`)) return;
    const at = new Date().toISOString();
    save((st) => ({ units: st.units.map((u) => (sel.has(u.id) ? { ...u, deletedAt: at } : u)) }), '排除戶別', labelOf(sel));
    setSel(new Set());
  }

  function addUnit() {
    const unitNo = newUnit.trim();
    if (!unitNo) return;
    const existing = s.units.find((u) => normUnit(u.unitNo) === normUnit(unitNo));
    if (existing && !existing.deletedAt) return alert(`戶別 ${unitNo} 已存在`);
    if (existing) {
      if (!confirm(`戶別 ${existing.unitNo} 之前已排除，要加回嗎？`)) return;
      save((st) => ({ units: st.units.map((u) => (u.id === existing.id ? { ...u, deletedAt: undefined } : u)) }), '加回戶別', existing.unitNo);
      return setNewUnit('');
    }
    save((st) => ({ units: sortUnits([...st.units, { id: newId('u_'), unitNo, owner: '', monthlyFee: 0, note: '' }]) }), '新增戶別', unitNo);
    setNewUnit('');
  }

  const setUnit = (u: Unit, patch: Partial<Unit>, action = '修改戶別') =>
    save((st) => ({ units: st.units.map((x) => (x.id === u.id ? { ...x, ...patch } : x)) }), action, u.unitNo);

  function applyBatchExtra() {
    const plan = s.feePlans.find((p) => p.id === batchExtra);
    const qty = Math.max(1, Math.round(Number(batchQty) || 1));
    if (!plan || !sel.size) return;
    save((st) => ({ units: assignExtra(st.units, sel, plan.id, qty, st.feePlans) }), '套用加收', `${plan.name} ×${qty}：${labelOf(sel)}`);
  }

  function removeBatchExtra() {
    const plan = s.feePlans.find((p) => p.id === batchExtra);
    if (!plan || !sel.size) return;
    save((st) => ({ units: removeExtra(st.units, sel, plan.id) }), '移除加收', `${plan.name}：${labelOf(sel)}`);
  }

  function applyBatchCycle() {
    if (!sel.size) return;
    save((st) => ({ units: assignCycle(st.units, sel, batchCycle, batchStart) }), '設定繳費週期', `${cycleLabel({ cycle: batchCycle, cycleStart: batchStart })}：${labelOf(sel)}`);
  }

  const setUnitCycle = (u: Unit, cycle: number, start: number) =>
    save((st) => ({ units: assignCycle(st.units, new Set([u.id]), cycle, start) }), '設定繳費週期', `${u.unitNo} ${cycleLabel({ cycle, cycleStart: start })}`);

  function setUnitPlan(u: Unit, planId: string) {
    const plan = s.feePlans.find((p) => p.id === planId);
    if (plan) setUnit(u, { planId: plan.id, monthlyFee: plan.amount }, '套用費率方案');
    else setUnit(u, { planId: undefined }, '改為個別金額');
  }

  const total = live.reduce((sum, u) => sum + unitBaseline(u, s.feePlans), 0);
  const missing = s.totalUnits ? s.totalUnits - live.length : 0;

  return (
    <>
      <div className="page-head">
        <h1>戶別與月費</h1>
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={tab === 'dues'} className={tab === 'dues' ? 'primary' : ''} onClick={() => setTab('dues')}>每月應繳</button>
          <button role="tab" aria-selected={tab === 'units'} className={tab === 'units' ? 'primary' : ''} onClick={() => setTab('units')}>基準與費率</button>
          <button role="tab" aria-selected={tab === 'prepaid'} className={tab === 'prepaid' ? 'primary' : ''} onClick={() => setTab('prepaid')}>期初預收款</button>
        </div>
        <div className="actions">
          <button onClick={() => go('import', 'dues')}>匯入每月應繳報表 →</button>
        </div>
      </div>
      <div className={`banner ${missing ? 'warn' : ''}`}>
        <span>
          已建立 {live.length} 戶{s.totalUnits ? `／總戶數 ${s.totalUnits} 戶` : ''}{missing > 0 ? `，還差 ${missing} 戶` : missing < 0 ? `，多 ${-missing} 戶` : ''}
          ，每月應繳基準合計 <Money value={total} strong /> 元（匯入智生活帳單時，用來區分本月應繳與帳單內含的逾期）。
        </span>
        <button onClick={() => go('arrears')}>{s.totalUnits ? '修改總戶數' : '設定總戶數'}</button>
      </div>

      {(live.length === 0 || !data.dues.length) && <FirstSetupGuide go={go} here={tab === 'units' ? 'units' : undefined} />}
      {tab === 'dues' ? (
        live.length > 0 && <MonthDues go={go} />
      ) : tab === 'prepaid' ? (
        live.length > 0 && <OpeningPrepaid />
      ) : (
        <>
          <PlanEditor
            plans={s.feePlans}
            units={live}
            onFilter={(id) => setPlanFilter(id)}
            onSave={(fn, action, detail) => save(fn, action, detail)}
          />

          <Section title={`戶別（顯示 ${shown.length} 戶，已勾選 ${sel.size} 戶）`}>
            <div className="form-row">
              <input placeholder="搜尋戶別代碼或所有權人，例如 A01、35號2樓" value={q} onChange={(e) => setQ(e.target.value)} />
              <select value={planFilter} onChange={(e) => setPlanFilter(e.target.value)}>
                <option value="">全部方案</option>
                {s.feePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                <option value={CUSTOM}>個別金額（未套用方案）</option>
              </select>
              <button onClick={() => selectShown(selectedShown < shown.length)}>{selectedShown < shown.length ? `勾選全部 ${shown.length} 戶` : '取消勾選'}</button>
              {sel.size > 0 && <button onClick={() => setSel(new Set())}>清除全部勾選</button>}
            </div>
            <div className="batch-bar">
              <span>對勾選的 {sel.size} 戶：</span>
              <select value={batchPlan} onChange={(e) => setBatchPlan(e.target.value)}>
                <option value="">選擇方案…</option>
                {s.feePlans.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.basis === 'area' ? `每坪 ${p.amount}` : p.amount.toLocaleString('zh-TW')}）</option>)}
              </select>
              <button className="primary" disabled={!sel.size || !batchPlan} onClick={applyBatchPlan}>套用方案</button>
              <span className="divider" />
              <input type="number" placeholder="每月應繳基準" value={batchAmount} onChange={(e) => setBatchAmount(e.target.value)} />
              <button disabled={!sel.size || batchAmount === ''} onClick={applyBatchAmount}>設定個別金額</button>
              <span className="divider" />
              <button className="danger" disabled={!sel.size} onClick={removeSelected} title="不需要管理的戶別（例如管理室、公設）">排除</button>
            </div>
            <div className="batch-bar">
              <span>加收：</span>
              <select value={batchExtra} onChange={(e) => setBatchExtra(e.target.value)}>
                <option value="">{s.feePlans.length ? '選擇加收方案，例如機車位清潔費…' : '先在上方新增方案'}</option>
                {s.feePlans.map((p) => <option key={p.id} value={p.id}>{p.name}（{p.basis === 'area' ? `每坪 ${p.amount}` : p.amount.toLocaleString('zh-TW')}）</option>)}
              </select>
              <input type="number" min={1} className="short" title="數量，例如 2 個機車位" value={batchQty} onChange={(e) => setBatchQty(e.target.value)} />
              <button disabled={!sel.size || !batchExtra} onClick={applyBatchExtra}>加入／更新數量</button>
              <button disabled={!sel.size || !batchExtra} onClick={removeBatchExtra}>移除</button>
              <span className="divider" />
              <span>繳費週期：</span>
              <select value={batchCycle} onChange={(e) => setBatchCycle(Number(e.target.value))}>
                {CYCLES.map((c) => <option key={c.months} value={c.months}>{c.label}</option>)}
              </select>
              {batchCycle > 1 && (
                <select value={batchStart} onChange={(e) => setBatchStart(Number(e.target.value))} title="週期從幾月開始">
                  {MONTHS.map((m) => <option key={m} value={m}>{m} 月起</option>)}
                </select>
              )}
              <button disabled={!sel.size} onClick={applyBatchCycle}>套用週期</button>
            </div>
            <p className="hint">
              按住 Shift 再點勾選框可以一次勾選一整段。點所有權人可查看變更紀錄或新增變更（只影響生效月份與之後）。不需要管理的戶別（例如管理室）勾選後按「排除」。基準＝方案（或個別金額）＋加收（例如機車位清潔費，可設數量），只在匯入智生活帳單時拿來比對：
              本期應繳採用基準，帳單超過基準的部分視為帳單內含的逾期。已匯入的月份會保留當時的基準，之後調漲或調降不會影響之前的比對。
              季繳、年繳等請設定繳費週期與起始月份（例如年繳 7 月起），帳單會拆到週期內每個月；智生活只會在週期的第一個月開帳單。
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th><input type="checkbox" aria-label="勾選全部" checked={shown.length > 0 && selectedShown === shown.length} onChange={(e) => selectShown(e.target.checked)} /></th>
                    <th>戶別</th><th>所有權人</th><th>坪數</th><th>費率方案</th><th className="num">方案金額</th><th>加收</th><th>繳費週期</th><th className="num">每月基準</th><th>備註</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((u, i) => (
                    <tr key={u.id} className={sel.has(u.id) ? 'selected' : ''}>
                      <td><input type="checkbox" checked={sel.has(u.id)} onClick={(e) => toggle(e, i)} onChange={() => {}} /></td>
                      <td>{u.unitNo}</td>
                      <td>
                        <span className="owner-cell">
                          <button className="link" title="查看／變更所有權人紀錄" onClick={() => setOwnerUnit(u)}>{u.owner || '設定所有權人'}</button>
                          {ownerHistory(u).length > 1 && <span className="tag warn" title="所有權人有變更紀錄">變更 {ownerHistory(u).length - 1} 次</span>}
                        </span>
                      </td>
                      <td><input type="number" className="short" defaultValue={u.area ?? ''} key={`a${u.area}`} onBlur={(e) => {
                        const area = Number(e.target.value) || undefined;
                        if (area !== u.area) save((st) => ({ units: setUnitArea(st.units, st.feePlans, u.id, area) }), '修改坪數', `${u.unitNo} ${area ?? ''}`);
                      }} /></td>
                      <td>
                        <select value={u.planId ?? ''} onChange={(e) => setUnitPlan(u, e.target.value)}>
                          <option value="">個別金額</option>
                          {s.feePlans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                      </td>
                      <td className="num">
                        {u.planId ? <Money value={u.monthlyFee} /> : (
                          <input type="number" className="short-num" defaultValue={u.monthlyFee} key={`f${u.monthlyFee}`} onBlur={(e) => Number(e.target.value) !== u.monthlyFee && setUnit(u, { monthlyFee: Number(e.target.value) || 0 }, '修改每月應繳基準')} />
                        )}
                      </td>
                      <td>
                        <div className="due-items">
                          {(u.extras ?? []).map((e, j) => {
                            const p = e.planId ? s.feePlans.find((x) => x.id === e.planId) : undefined;
                            const item = extraItem(e, s.feePlans);
                            if (!item) return null;
                            const amount = p ? planFee(p, u) * (e.qty || 1) : e.amount ?? 0;
                            return (
                              <span key={e.planId ?? `c${j}`} className="due-chip" title={p ? '套用方案' : '自訂金額（匯入時更新的基準）'}>
                                {item}{p && e.qty > 1 ? ` ×${e.qty}` : ''}{p ? '' : '（自訂）'} {amount.toLocaleString('zh-TW')}
                                <button className="link danger" title="移除" onClick={() => save((st) => ({ units: st.units.map((x) => (x.id === u.id ? setUnitItemBaseline(x, item, 0, st.feePlans) : x)) }), '移除加收', `${u.unitNo} ${item}`)}>×</button>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <select value={u.cycle ?? 1} onChange={(e) => setUnitCycle(u, Number(e.target.value), u.cycleStart ?? 1)}>
                          {CYCLES.map((c) => <option key={c.months} value={c.months}>{c.label}</option>)}
                        </select>
                        {(u.cycle ?? 1) > 1 && (
                          <select value={u.cycleStart ?? 1} title="週期從幾月開始" onChange={(e) => setUnitCycle(u, u.cycle ?? 1, Number(e.target.value))}>
                            {MONTHS.map((m) => <option key={m} value={m}>{m} 月起</option>)}
                          </select>
                        )}
                      </td>
                      <td className="num"><Money value={unitBaseline(u, s.feePlans)} strong /></td>
                      <td><input defaultValue={u.note} key={`n${u.note}`} onBlur={(e) => e.target.value !== u.note && setUnit(u, { note: e.target.value })} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="form-row">
              <input placeholder="新增戶別代碼，例如 (A01-02)35號2樓之1" value={newUnit} onChange={(e) => setNewUnit(e.target.value)} onKeyDown={(e) => isEnterKey(e) && addUnit()} />
              <button onClick={addUnit}>新增戶別</button>
            </div>
          </Section>
        </>
      )}
      {ownerUnit && <OwnerHistory unit={ownerUnit} onClose={() => setOwnerUnit(null)} />}
    </>
  );
}

function PlanEditor({
  plans,
  units,
  onFilter,
  onSave,
}: {
  plans: FeePlan[];
  units: Unit[];
  onFilter: (id: string) => void;
  onSave: (fn: (st: Settings) => Partial<Settings>, action: string, detail?: string) => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [basis, setBasis] = useState<'fixed' | 'area'>('fixed');
  const uses = (p: FeePlan) => [
    ...units.filter((u) => u.planId === p.id).map((u) => ({ u, qty: 1 })),
    ...units.flatMap((u) => (u.extras ?? []).filter((e) => e.planId === p.id).map((e) => ({ u, qty: e.qty || 1 }))),
  ];
  const count = (id: string) => uses(plans.find((p) => p.id === id)!).length;
  const totalQty = (p: FeePlan) => uses(p).reduce((sum, x) => sum + x.qty, 0);
  const totalArea = (p: FeePlan) => Math.round(uses(p).reduce((sum, x) => sum + (x.u.area ?? 0) * x.qty, 0) * 100) / 100;
  const subtotal = (p: FeePlan) => uses(p).reduce((sum, x) => sum + planFee(p, x.u) * x.qty, 0);
  const noArea = (id: string) => uses(plans.find((p) => p.id === id)!).filter((x) => !x.u.area).length;
  const unitLabel = (p: FeePlan) => (p.basis === 'area' ? '元／坪' : '元／月');

  function add() {
    const a = Number(amount);
    if (!name.trim() || amount === '' || !Number.isFinite(a)) return;
    const plan: FeePlan = { id: newId('plan_'), name: name.trim(), amount: a, basis };
    onSave((st) => ({ feePlans: [...st.feePlans, plan] }), '新增費率方案', `${plan.name} ${a}${basis === 'area' ? ' 元／坪' : ''}`);
    setName('');
    setAmount('');
  }

  return (
    <Section title={`費率方案（${plans.length} 個）`}>
      <p className="hint">
        定義各種金額，例如「一般住戶」「店面」，或「機車位清潔費」「汽車位清潔費」。金額可選「依坪數計算」設定每坪單價（每坪單價 × 坪數，四捨五入到元）。
        下方每戶套用一個方案，另外可加收其他方案並設定數量（例如 2 個機車位）。「套用戶數」是幾戶，「總數量」是數量加總（例如有 2 個車位的戶算 2），方便和實際車位數核對。
        基準只在匯入智生活帳單時拿來比對（把帳單拆成本期應繳與帳單內含的逾期）；修改金額只影響之後匯入的月份，已匯入的月份不受影響。
      </p>
      {plans.length > 0 && (
        <table>
          <thead><tr><th>方案名稱</th><th>計算方式</th><th className="num">金額／單價</th><th className="num">套用戶數</th><th className="num" title="每戶的數量加總，例如有 2 個車位的戶算 2；依坪數的方案為坪數加總">總數量</th><th className="num">每月小計</th><th></th></tr></thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id}>
                <td><input defaultValue={p.name} key={`n${p.name}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.name && onSave((st) => updatePlan(st, { ...p, name: e.target.value.trim() }), '修改方案名稱', e.target.value)} /></td>
                <td>
                  <select value={p.basis ?? 'fixed'} onChange={(e) => {
                    const next = { ...p, basis: e.target.value as 'fixed' | 'area' };
                    if (confirm(`將「${p.name}」改為${next.basis === 'area' ? '依坪數計算（每坪 ' + p.amount + ' 元）' : '固定金額（每月 ' + p.amount + ' 元）'}？套用的 ${count(p.id)} 戶基準會重新計算（已匯入的月份不變）。`)) onSave((st) => updatePlan(st, next), '修改方案計算方式', `${p.name}：${next.basis === 'area' ? '依坪數' : '固定金額'}`);
                  }}>
                    <option value="fixed">固定金額</option>
                    <option value="area">依坪數計算</option>
                  </select>
                </td>
                <td className="num">
                  <input type="number" step="any" className="short-num" defaultValue={p.amount} key={`a${p.amount}`}
                    onBlur={(e) => {
                      const a = Number(e.target.value);
                      if (e.target.value === '' || a === p.amount || !Number.isFinite(a)) return;
                      if (!confirm(`將「${p.name}」改為${p.basis === 'area' ? '每坪' : '每月'} ${a.toLocaleString('zh-TW')} 元？套用的 ${count(p.id)} 戶基準會一起更新（只影響之後匯入的月份，已匯入的月份不變）。`)) return void (e.target.value = String(p.amount));
                      onSave((st) => updatePlan(st, { ...p, amount: a }), '修改方案金額', `${p.name}：${p.amount} → ${a}`);
                    }} /> <span className="muted">{unitLabel(p)}</span>
                </td>
                <td className="num">
                  <button className="link" onClick={() => onFilter(p.id)}>{count(p.id)} 戶</button>
                  {p.basis === 'area' && noArea(p.id) > 0 && <span className="tag warn" title="這些戶別沒有坪數，月費為 0">{noArea(p.id)} 戶缺坪數</span>}
                </td>
                <td className="num">{p.basis === 'area' ? `${totalArea(p).toLocaleString('zh-TW')} 坪` : `${totalQty(p).toLocaleString('zh-TW')} 個`}</td>
                <td className="num"><Money value={subtotal(p)} /></td>
                <td><button className="link danger" onClick={() => confirm(`刪除方案「${p.name}」？套用的戶別會保留目前金額，改為個別金額。`) && onSave((st) => removePlan(st, p.id), '刪除費率方案', p.name)}>刪除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="form-row">
        <input placeholder="方案名稱，例如 一般住戶、機車位清潔費" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={basis} onChange={(e) => setBasis(e.target.value as 'fixed' | 'area')}>
          <option value="fixed">固定金額</option>
          <option value="area">依坪數計算</option>
        </select>
        <input type="number" step="any" placeholder={basis === 'area' ? '每坪單價' : '每月金額'} value={amount} onChange={(e) => setAmount(e.target.value)} onKeyDown={(e) => isEnterKey(e) && add()} />
        <button onClick={add} disabled={!name.trim() || amount === ''}>新增方案</button>
      </div>
    </Section>
  );
}

