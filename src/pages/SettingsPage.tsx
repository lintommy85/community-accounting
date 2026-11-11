import { useState } from 'react';
import type { PageKey } from '../App';
import { isEnterKey, Section } from '../components/ui';
import CommunityProfile from '../components/CommunityProfile';
import HouseholdSetup from '../components/HouseholdSetup';
import { openGuide } from '../components/GuideTour';
import Signatures from '../components/Signatures';
import { MAX_SIGNATURES, newId, PETTY_OTHER, resolveDepositAccountId, withPettyOther } from '../lib/defaults';
import { activeUnits, deletedUnits, extraItem, feeItemNames, MGMT_ITEM, sortUnits } from '../lib/fees';
import { BILL_ARREARS, BILL_ASIS, BILL_DEPOSIT, BILL_FINE, BILL_PREPAID, billTargetLabel } from '../lib/bills';

const SPECIAL_TARGETS: string[] = [BILL_PREPAID, BILL_ARREARS, BILL_ASIS, BILL_FINE, BILL_DEPOSIT];
import { Account, PettyCashEntry, Settings, SignatureSlot } from '../lib/types';
import { useStore } from '../store';
import { FEE_OTHER_FIXED, FEE_SUBJECT } from '../lib/statement';
import { renovationAfterCategoryRename, renovationSettings } from '../lib/renovation';
import { moveItem, useDragReorder } from '../components/useDragReorder';


export default function SettingsPage({ go }: { go: (p: PageKey) => void }) {
  const { data, update, service } = useStore();
  const s = data.settings;
  const set = (patch: Partial<Settings>, action = '修改設定', detail = Object.keys(patch).join(',')) =>
    update((d) => ({ ...d, settings: { ...d.settings, ...patch } }), action, detail);



  return (
    <>
      <h1>基本設定</h1>
      <Section title="使用說明">
        <div className="form-row">
          <button className="primary" onClick={openGuide}>重新播放使用說明動畫</button>
          {service && <button onClick={() => window.open('/guide', '_blank')}>開啟完整使用說明（圖文版）</button>}
        </div>
        <p className="hint">動畫介紹每月的工作流程；完整說明也可以直接開啟程式資料夾裡的「使用說明.html」。</p>
      </Section>
      <Section title="社區名稱與圖示">
        <CommunityProfile removable />
        <p className="hint">輸入後系統標題、瀏覽器分頁、所有報表、催繳單與匯出檔名都會使用這個名稱。圖示不是正方形或大於 256×256 時會出現裁切畫面。</p>
      </Section>

      <AccountsEditor settings={s} onSave={set} />

      <Section title={`匯入時排除的狀態（${s.excludeStatusKeywords.length}）`}>
        <p className="hint">匯入智生活入帳報表時，「狀態」欄含有下列任一文字的列不會匯入（例如未繳、退款）。</p>
        <ExcludeStatusTable list={s.excludeStatusKeywords} onSave={(list, action, detail) => set({ excludeStatusKeywords: list }, action, detail)} />
      </Section>

      <Section title="戶數與銷帳">
        <HouseholdSetup />
      </Section>

      <Section title={`戶別（${activeUnits(s.units).length}${s.totalUnits ? `／${s.totalUnits}` : ''} 戶）`}>
        <p className="hint">戶別、所有權人、費率方案與每月應繳金額，請到「戶別與月費」頁面設定（可勾選批次套用）；智生活管理費匯入範本請到「匯入智生活報表 → 每月應繳報表」匯入。</p>
        <button className="primary" onClick={() => go('units')}>前往戶別與月費</button>
      </Section>

      <DeletedUnits />

      <SignatureEditor slots={s.signatures} onSave={(signatures, detail) => set({ signatures }, '修改簽章欄', detail)} />

      <Section title="收支科目">
        <p className="hint">按住左邊的 ⋮⋮ 上下拖拉調整順序；「收支記帳」選科目與報表都依這個順序排列。勾選「固定」的科目在列印的財務收支總表中列為固定收入／固定支出，其餘為非固定。改名時，未月結月份的分錄會一起改成新名稱。</p>
        <div className="two-col">
          <CategoryTable kind="income" title="收入科目" />
          <CategoryTable kind="expense" title="支出科目" />
        </div>
        <div className="petty-categories">
          <CategoryTable kind="petty" title="零用金科目" />
          <p className="hint">零用金科目用於「零用金」頁的項目下拉選單，零用金明細不會出現在收支表；每月撥補以支出「零用金撥補」列入。</p>
        </div>
      </Section>

      <BillItemMapEditor />
    </>
  );
}

/** 帳單項目怎麼對應：已記錄的對應加上名稱相同的自動對應，一起列出對應到的繳費項目、費率方案與套用戶數；可修改、刪除、新增。 */
function BillItemMapEditor() {
  const { data, update } = useStore();
  const s = data.settings;
  const map = s.billItemMap ?? {};
  const feeItems = feeItemNames(s);
  const units = activeUnits(s.units);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [msg, setMsg] = useState('');
  const save = (next: Record<string, string>, action: string, detail: string) =>
    update((d) => ({ ...d, settings: { ...d.settings, billItemMap: next } }), action, detail);
  const options = (current: string) => (
    <>
      <optgroup label="基準費率的繳費項目">
        {current && !feeItems.includes(current) && !SPECIAL_TARGETS.includes(current) && <option value={current}>{current}（已不存在）</option>}
        {feeItems.map((f) => <option key={f} value={f}>{f}</option>)}
      </optgroup>
      {SPECIAL_TARGETS.map((t) => <option key={t} value={t}>{billTargetLabel(t)}</option>)}
    </>
  );

  // 已記錄的對應，加上和繳費項目同名、沒有另外記錄的（匯入時自動對應）
  const rows: { bill: string; target: string; saved: boolean }[] = [
    ...Object.entries(map).map(([bill, t]) => ({ bill, target: t, saved: true })),
    ...feeItems.filter((f) => !(f in map)).map((f) => ({ bill: f, target: f, saved: false })),
  ];
  const kindOrder = (t: string) => (SPECIAL_TARGETS.includes(t) ? 1 + SPECIAL_TARGETS.indexOf(t) : 0);
  const itemOrder = (t: string) => (feeItems.includes(t) ? feeItems.indexOf(t) : feeItems.length);
  rows.sort((a, b) => kindOrder(a.target) - kindOrder(b.target) || itemOrder(a.target) - itemOrder(b.target) || a.bill.localeCompare(b.bill, 'zh-Hant'));

  /** 繳費項目來自哪個費率方案、怎麼算、幾戶套用。 */
  function planInfo(t: string): { plan: string; usage: string; missing?: boolean } {
    if (t === BILL_ARREARS) return { plan: '不列為應繳，先對系統既有的欠款', usage: '' };
    if (t === BILL_PREPAID) return { plan: '從這戶的預收款扣除（含期初預收款）', usage: '' };
    if (t === BILL_ASIS) return { plan: '照帳單金額列入，不比對基準', usage: '' };
    if (t === BILL_FINE) return { plan: '不列入應繳，只記在帳卡；繳款直接入帳，報表列「罰款收入」', usage: '' };
    if (t === BILL_DEPOSIT) return { plan: '不列入應繳，只記在帳卡；繳款直接入帳，到「裝潢保證金」結算退款', usage: '' };
    const plan = s.feePlans.find((x) => x.name === t);
    if (plan) {
      const main = units.filter((u) => u.planId === plan.id).length;
      const extras = units.flatMap((u) => (u.extras ?? []).filter((e) => e.planId === plan.id));
      const qty = extras.reduce((sum, e) => sum + (e.qty || 1), 0);
      const usage = [main ? `主方案 ${main} 戶` : '', extras.length ? `加收 ${extras.length} 戶${qty !== extras.length ? `，共 ${qty} 個` : ''}` : ''].filter(Boolean).join('；');
      return { plan: `${plan.name}（${plan.basis === 'area' ? `依坪數，每坪 ${plan.amount.toLocaleString('zh-TW')} 元` : `固定 ${plan.amount.toLocaleString('zh-TW')} 元`}）`, usage: usage || '還沒有戶別套用' };
    }
    if (t === MGMT_ITEM) {
      const own = units.filter((u) => !u.planId && u.monthlyFee > 0).length;
      return { plan: '主要費用：每戶的個別金額（和主方案視為同一項）', usage: own ? `個別金額 ${own} 戶` : '沒有個別金額的戶別' };
    }
    const custom = units.filter((u) => (u.extras ?? []).some((e) => !e.planId && extraItem(e, s.feePlans) === t)).length;
    if (custom) return { plan: '自訂加收項目（沒有費率方案）', usage: `${custom} 戶` };
    return { plan: '找不到這個繳費項目，請改對應或刪除', usage: '', missing: true };
  }

  const kindTag = (t: string) =>
    t === BILL_ARREARS ? <span className="tag warn">逾期</span>
      : t === BILL_PREPAID ? <span className="tag ok">沖銷</span>
        : t === BILL_ASIS ? <span className="tag">照帳單</span>
          : t === BILL_FINE ? <span className="tag danger">罰款</span>
            : t === BILL_DEPOSIT ? <span className="tag purple">裝潢保證金</span>
              : <span className="tag info">繳費項目</span>;

  function add() {
    const v = name.trim();
    if (!v || !target) return;
    if (map[v]) return setMsg(`「${v}」已經有對應，請直接在上面修改`);
    save({ ...map, [v]: target }, '新增帳單項目對應', `${v}→${target}`);
    setName('');
    setTarget('');
    setMsg('');
  }

  return (
    <Section title={`帳單項目對應（${rows.length}）`}>
      <p className="hint">
        匯入「每月應繳報表」時，帳單上的每個項目（去掉「11月」等月份）都會照這張表對應：對應到繳費項目的，跟這戶在「基準與費率」的該項基準比對；
        對應到逾期、沖銷、照帳單、罰款、裝潢保證金的照右邊的方式處理（罰款、裝潢保證金不列入應繳，只記在那戶的帳卡）。和繳費項目同名的會自動對應（來源「自動」），名稱有「逾期」「未繳」「欠繳」「欠款」「前期」的（例如「逾期汽車清潔費」「10月逾期」）直接對應到逾期，不用選；其餘的在第一次匯入時選擇，選過的記在這裡（來源「已記錄」）。
        修改或刪除只影響之後的匯入；已匯入的月份要重新匯入一次才會套用。刪除後下次匯入會再請你選擇。
      </p>
      <div className="table-wrap">
        <table className="compact-inputs bill-map-table">
          <thead><tr><th>帳單項目</th><th>類型</th><th>對應到</th><th>費率方案／處理方式</th><th>套用戶數</th><th>來源</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const info = planInfo(r.target);
              return (
                <tr key={r.bill} className={info.missing ? 'attention' : ''}>
                  <td><strong>{r.bill}</strong></td>
                  <td>{kindTag(r.target)}</td>
                  <td>
                    <select value={r.target} onChange={(e) => save({ ...map, [r.bill]: e.target.value }, '修改帳單項目對應', `${r.bill}→${e.target.value}`)}>
                      {options(r.target)}
                    </select>
                  </td>
                  <td className={info.missing ? 'warn' : ''}>{info.plan}</td>
                  <td className="muted">{info.usage}</td>
                  <td>{r.saved ? <span className="tag ok">已記錄</span> : <span className="tag" title="帳單項目和繳費項目同名，匯入時自動對應">自動</span>}</td>
                  <td>
                    {r.saved && (
                      <button className="link danger" onClick={() => confirm(`刪除「${r.bill}」的對應？${feeItems.includes(r.bill) ? '刪除後會改回自動對應到同名的繳費項目。' : '下次匯入時會再請你選擇。'}`) && save(Object.fromEntries(Object.entries(map).filter(([x]) => x !== r.bill)), '刪除帳單項目對應', r.bill)}>
                        刪除
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            <tr className="add-row">
              <td><input placeholder="帳單項目，例如 預繳沖銷" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => isEnterKey(e) && add()} /></td>
              <td></td>
              <td>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="">— 請選擇 —</option>
                  {options('')}
                </select>
              </td>
              <td className="muted">{target ? planInfo(target).plan : ''}</td>
              <td></td>
              <td></td>
              <td><button onClick={add} disabled={!name.trim() || !target}>新增</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p className="empty">還沒有繳費項目或對應紀錄。先到「戶別與月費 → 基準與費率」建立費率方案，第一次匯入每月應繳報表時會請你選擇其他項目的對應。</p>}
      {msg && <p className="hint">{msg}</p>}
    </Section>
  );
}


function SignatureEditor({ slots, onSave }: { slots: SignatureSlot[]; onSave: (s: SignatureSlot[], detail: string) => void }) {
  const patch = (id: string, p: Partial<SignatureSlot>) => onSave(slots.map((x) => (x.id === id ? { ...x, ...p } : x)), '修改');
  const { handleProps, rowProps } = useDragReorder((from, to) => onSave(moveItem(slots, from, to), '調整順序'));
  return (
    <Section
      title={`報表簽章欄（${slots.length}／${MAX_SIGNATURES}）`}
      actions={
        <button disabled={slots.length >= MAX_SIGNATURES} onClick={() => onSave([...slots, { id: newId('sig_'), label: '', row: slots.length >= 5 ? 2 : 1 }], '新增')}>
          新增簽章欄
        </button>
      }
    >
      <p className="hint">印在「收支報表」與「月結報表」最下方，以表格呈現：上方為職稱、下方留白簽名。最多 {MAX_SIGNATURES} 位，可分成兩行；按住 ⋮⋮ 拖拉調整左右順序。</p>
      {slots.length > 0 && (
        <table className="sig-editor">
          <thead><tr><th></th><th>職稱</th><th>放在</th><th></th></tr></thead>
          <tbody>
            {slots.map((x, i) => (
              <tr key={x.id} {...rowProps(i)}>
                <td><span {...handleProps(i)}>⋮⋮</span></td>
                <td><input value={x.label} placeholder="例如：主任委員" onChange={(e) => patch(x.id, { label: e.target.value })} /></td>
                <td>
                  <select value={x.row} onChange={(e) => patch(x.id, { row: Number(e.target.value) as 1 | 2 })}>
                    <option value={1}>第 1 行</option>
                    <option value={2}>第 2 行</option>
                  </select>
                </td>
                <td><button className="link danger" onClick={() => onSave(slots.filter((y) => y.id !== x.id), `刪除 ${x.label}`)}>刪除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="hint">預覽：</p>
      <Signatures />
    </Section>
  );
}

function AccountsEditor({ settings: s, onSave }: { settings: Settings; onSave: (patch: Partial<Settings>, action?: string, detail?: string) => void }) {
  const banks = s.accounts.filter((a) => a.kind === 'bank');
  const depositId = resolveDepositAccountId(s);
  const setAccount = (id: string, patch: Partial<Account>, action = '修改帳戶') =>
    onSave({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, ...patch } : a)) }, action, Object.keys(patch).join(','));
  const add = () =>
    onSave({ accounts: [...s.accounts, { id: newId('acc_'), name: `銀行帳戶${banks.length + 1}`, accountNo: '', kind: 'bank', fund: '管理費', openingBalance: 0, openingDate: '', excludeTransfer: false }] }, '新增帳戶');

  return (
    <Section title="銀行帳戶與期初餘額" actions={<button onClick={add}>新增帳戶</button>}>
      <p className="hint">
        「自訂名稱」會顯示在報表上（例如「管理費－永豐」）；「完整帳號」請輸入存摺上的完整帳號。依公寓大廈管理條例第 18 條，公共基金應設專戶。
        期初日期填開始使用本系統的前一天，期初餘額填當天存摺餘額（可為負數）。
        勾選「排除轉帳」的帳戶（預設為零用金）不會出現在帳戶間轉帳的轉出／轉入選項。
      </p>
      <div className="table-wrap">
      <table className="compact-inputs">
        <thead>
          <tr><th>自訂名稱</th><th>完整帳號</th><th>類型</th><th>基金別</th><th className="num">期初餘額</th><th>期初日期</th><th>管理費轉入</th><th>排除轉帳</th><th></th></tr>
        </thead>
        <tbody>
          {s.accounts.map((a) => (
            <tr key={a.id} className={a.id === depositId ? 'selected' : ''}>
              <td><input defaultValue={a.name} key={`n${a.name}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== a.name && setAccount(a.id, { name: e.target.value.trim() })} /></td>
              <td>
                {a.kind === 'bank' ? (
                  <input className="account-no" defaultValue={a.accountNo} key={`no${a.accountNo}`} placeholder="例如 107-018-0012345-6" inputMode="numeric"
                    onBlur={(e) => e.target.value.trim() !== a.accountNo && setAccount(a.id, { accountNo: e.target.value.trim() }, '修改銀行帳號')} />
                ) : <span className="muted">—</span>}
              </td>
              <td><select value={a.kind} onChange={(e) => setAccount(a.id, { kind: e.target.value as Account['kind'], excludeTransfer: e.target.value === 'cash' })}><option value="bank">銀行</option><option value="cash">現金／零用金</option></select></td>
              <td><select value={a.fund} onChange={(e) => setAccount(a.id, { fund: e.target.value as Account['fund'] })}><option>管理費</option><option>公共基金</option><option>其他</option></select></td>
              <td className="num"><input type="number" className="short-num" defaultValue={a.openingBalance} key={`b${a.openingBalance}`} onBlur={(e) => Number(e.target.value) !== a.openingBalance && setAccount(a.id, { openingBalance: Number(e.target.value) || 0 })} /></td>
              <td><input type="date" value={a.openingDate} onChange={(e) => setAccount(a.id, { openingDate: e.target.value })} /></td>
              <td>
                {a.kind !== 'bank' ? '' : banks.length === 1 ? <span className="tag ok">唯一帳戶，自動</span> : (
                  <label className="check"><input type="radio" name="deposit-account" checked={a.id === depositId} onChange={() => onSave({ depositAccountId: a.id }, '指定管理費轉入帳戶', a.name)} /> 轉入此帳戶</label>
                )}
              </td>
              <td><label className="check" title="勾選後，帳戶間轉帳不會出現這個帳戶"><input type="checkbox" checked={!!a.excludeTransfer} onChange={(e) => setAccount(a.id, { excludeTransfer: e.target.checked }, e.target.checked ? '帳戶排除轉帳' : '帳戶可轉帳')} /> 排除</label></td>
              <td>{s.accounts.length > 1 && a.id !== depositId && <button className="link danger" onClick={() => confirm(`刪除帳戶「${a.name}」？`) && onSave({ accounts: s.accounts.filter((x) => x.id !== a.id) }, '刪除帳戶', a.name)}>刪除</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      {banks.length === 0 && <p className="err">請至少建立一個銀行帳戶，智生活撥款的管理費才有入帳帳戶。</p>}
      {banks.length > 1 && !depositId && <p className="err">有 {banks.length} 個銀行帳戶，請在「管理費轉入」欄指定智生活撥款的管理費要轉入哪一個帳戶。</p>}
      {depositId && (
        <p className="hint">
          管理費撥款轉入：<strong>{s.accounts.find((a) => a.id === depositId)?.name}</strong>
          {s.accounts.find((a) => a.id === depositId)?.accountNo ? `（${s.accounts.find((a) => a.id === depositId)?.accountNo}）` : '（尚未輸入帳號）'}
          {banks.length === 1 ? '，只有一個銀行帳戶時自動使用。' : ''}
        </p>
      )}
    </Section>
  );
}

function CategoryTable({ kind, title }: { kind: 'income' | 'expense' | 'petty'; title: string }) {
  const { data, update, isClosed } = useStore();
  const petty = kind === 'petty';
  const field = kind === 'income' ? 'incomeCategories' : kind === 'expense' ? 'expenseCategories' : 'pettyCategories';
  const list = petty ? data.settings.pettyCategories.filter((c) => c !== PETTY_OTHER) : data.settings[field];
  const finish = (next: string[]) => (petty ? withPettyOther(next) : next);
  const pettyCat = (e: PettyCashEntry) => e.category ?? e.item;
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const fixed = new Set(data.settings.fixedCategories);
  const reno = renovationSettings(data.settings);
  const toggleFixed = (c: string) =>
    update(
      (d) => ({
        ...d,
        settings: {
          ...d.settings,
          fixedCategories: d.settings.fixedCategories.includes(c) ? d.settings.fixedCategories.filter((x) => x !== c) : [...d.settings.fixedCategories, c],
        },
      }),
      fixed.has(c) ? '改為非固定科目' : '改為固定科目',
      c,
    );
  const usage = (c: string) =>
    petty ? data.pettyCash.filter((e) => pettyCat(e) === c).length : data.entries.filter((e) => e.type === kind && e.category === c).length;
  const save = (next: string[], action: string, detail: string) =>
    update((d) => ({ ...d, settings: { ...d.settings, [field]: finish(next) } }), action, detail);

  function add() {
    const v = name.trim();
    if (!v) return;
    if (list.includes(v) || (petty && v === PETTY_OTHER)) return setMsg(`「${v}」已存在`);
    save([...list, v], `新增${title}`, v);
    setName('');
    setMsg('');
  }

  function rename(i: number, value: string) {
    const v = value.trim();
    const old = list[i];
    if (!v || v === old) return;
    if (list.includes(v) || (petty && v === PETTY_OTHER)) return setMsg(`「${v}」已存在`);
    const affected = petty
      ? data.pettyCash.filter((e) => pettyCat(e) === old && !isClosed(e.date))
      : data.entries.filter((e) => e.type === kind && e.category === old && !isClosed(e.date));
    update(
      (d) => ({
        ...d,
        settings: {
          ...d.settings,
          [field]: finish(list.map((c, j) => (j === i ? v : c))),
          fixedCategories: d.settings.fixedCategories.map((c) => (c === old ? v : c)),
          renovation: petty ? d.settings.renovation : renovationAfterCategoryRename(d.settings, kind, old, v),
        },
        entries: petty ? d.entries : d.entries.map((e) => (e.type === kind && e.category === old && !isClosed(e.date) ? { ...e, category: v } : e)),
        pettyCash: petty
          ? d.pettyCash.map((e) => (pettyCat(e) === old && !isClosed(e.date) ? { ...e, category: v, item: e.item === old ? v : e.item } : e))
          : d.pettyCash,
      }),
      `修改${title}`,
      `${old} → ${v}（分錄 ${affected.length} 筆）`,
    );
    setMsg(affected.length ? `已改名，並更新 ${affected.length} 筆未月結的分錄。` : '');
  }

  function remove(i: number) {
    const c = list[i];
    const n = usage(c);
    if (!confirm(n ? `「${c}」已有 ${n} 筆分錄使用。刪除後這些分錄仍保留原科目名稱，只是之後不會出現在選單中。確定刪除？` : `刪除科目「${c}」？`)) return;
    save(list.filter((_, j) => j !== i), `刪除${title}`, c);
  }

  const { handleProps, rowProps } = useDragReorder((from, to) => {
    const next = moveItem(list, from, to);
    save(next, `調整${title}順序`, next.join('、'));
  });

  return (
    <div>
      <h3 className="sub-title">{title}（{list.length + (petty ? 1 : 0)}）</h3>
      {kind === 'income' && (
        <label className="check fee-fixed">
          <input type="checkbox" checked={fixed.has(FEE_SUBJECT)} onChange={() => toggleFixed(FEE_SUBJECT)} /> 匯入的管理費：本期收入列為固定收入
        </label>
      )}
      {kind === 'income' && (
        <label className="check fee-fixed">
          <input type="checkbox" checked={fixed.has(FEE_OTHER_FIXED)} onChange={() => toggleFixed(FEE_OTHER_FIXED)} /> 匯入的管理費：逾期、預收、暫收也列為固定收入
        </label>
      )}
      {kind === 'expense' && (
        <>
          <label className="check fee-fixed">
            <input type="checkbox" checked={fixed.has(reno.refundLabel)} onChange={() => toggleFixed(reno.refundLabel)} /> 裝潢保證金退款「{reno.refundLabel}」列為固定支出
          </label>
          <label className="check fee-fixed">
            <input type="checkbox" checked={fixed.has(reno.feeLabel)} onChange={() => toggleFixed(reno.feeLabel)} /> 裝潢保證金退款手續費「{reno.feeLabel}」列為固定支出
          </label>
        </>
      )}
      <table className="compact-inputs category-table">
        <thead><tr><th></th><th>科目名稱</th>{!petty && <th title="月報表的「固定收入／固定支出」">固定</th>}<th className="num">使用筆數</th><th></th></tr></thead>
        <tbody>
          {list.map((c, i) => (
            <tr key={c} {...rowProps(i)}>
              <td><span {...handleProps(i)}>⋮⋮</span></td>
              <td><input defaultValue={c} onBlur={(e) => rename(i, e.target.value)} onKeyDown={(e) => isEnterKey(e) && e.currentTarget.blur()} aria-label={`${title}名稱`} /></td>
              {!petty && <td><input type="checkbox" checked={fixed.has(c)} onChange={() => toggleFixed(c)} aria-label={`${c} 為固定科目`} /></td>}
              <td className="num">{usage(c) || ''}</td>
              <td><button className="link danger" onClick={() => remove(i)}>刪除</button></td>
            </tr>
          ))}
          {petty && (
            <tr className="locked-row">
              <td></td>
              <td>{PETTY_OTHER}<span className="muted">（固定在最後，選它時可自行輸入項目）</span></td>
              <td className="num">{usage(PETTY_OTHER) || ''}</td>
              <td></td>
            </tr>
          )}
          <tr className="add-row">
            <td></td>
            <td><input placeholder={`新增${title}`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => isEnterKey(e) && add()} /></td>
            {!petty && <td></td>}
            <td></td>
            <td><button onClick={add} disabled={!name.trim()}>新增</button></td>
          </tr>
        </tbody>
      </table>
      {msg && <p className="hint">{msg}</p>}
    </div>
  );
}

function ExcludeStatusTable({ list, onSave }: { list: string[]; onSave: (list: string[], action: string, detail: string) => void }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  function add() {
    const v = text.trim();
    if (!v) return;
    if (list.includes(v)) return setMsg(`「${v}」已存在`);
    onSave([...list, v], '新增排除狀態', v);
    setText('');
    setMsg('');
  }

  function rename(i: number, value: string) {
    const v = value.trim();
    if (!v || v === list[i]) return;
    if (list.includes(v)) return setMsg(`「${v}」已存在`);
    onSave(list.map((x, j) => (j === i ? v : x)), '修改排除狀態', `${list[i]} → ${v}`);
    setMsg('');
  }

  return (
    <>
      <table className="compact-inputs status-table">
        <thead><tr><th>狀態文字</th><th></th></tr></thead>
        <tbody>
          {list.map((x, i) => (
            <tr key={x}>
              <td><input defaultValue={x} aria-label="狀態文字" onBlur={(e) => rename(i, e.target.value)} onKeyDown={(e) => isEnterKey(e) && e.currentTarget.blur()} /></td>
              <td><button className="link danger" onClick={() => onSave(list.filter((_, j) => j !== i), '刪除排除狀態', x)}>刪除</button></td>
            </tr>
          ))}
          <tr className="add-row">
            <td><input placeholder="新增狀態文字，例如 已退款" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => isEnterKey(e) && add()} /></td>
            <td><button onClick={add} disabled={!text.trim()}>新增</button></td>
          </tr>
        </tbody>
      </table>
      {msg && <p className="hint">{msg}</p>}
    </>
  );
}

function DeletedUnits() {
  const { data, update } = useStore();
  const list = sortUnits(deletedUnits(data.settings.units));
  const key = (x: string) => x.replace(/\s+/g, '').toUpperCase();
  const usage = (unitNo: string) => ({
    payments: data.payments.filter((p) => !p.voided && key(p.unitNo) === key(unitNo)).length,
    dues: data.dues.filter((d) => key(d.unitNo) === key(unitNo)).length,
  });
  const restore = (id: string, unitNo: string) =>
    update((d) => ({ ...d, settings: { ...d.settings, units: d.settings.units.map((u) => (u.id === id ? { ...u, deletedAt: undefined } : u)) } }), '加回戶別', unitNo);
  const purge = (id: string, unitNo: string) =>
    confirm(`永久刪除戶別 ${unitNo}？之後就無法從這裡加回（已匯入的繳費與應繳紀錄不會刪除）。`) &&
    update((d) => ({ ...d, settings: { ...d.settings, units: d.settings.units.filter((u) => u.id !== id) } }), '永久刪除戶別', unitNo);

  return (
    <Section title={`已排除的戶別（${list.length}）`}>
      {list.length === 0 ? (
        <p className="empty">沒有已排除的戶別。在「戶別與月費」排除、或匯入範本時勾選排除的戶別會列在這裡，方便確認與加回。</p>
      ) : (
        <>
          <p className="hint">已排除的戶別不列入每月應繳、欠費與銷帳，之後匯入範本也會自動略過（匯入時也可以取消勾選排除）；按「加回」即恢復使用。</p>
          <div className="table-wrap short">
            <table>
              <thead><tr><th>戶別代碼</th><th>所有權人</th><th>排除時間</th><th className="num">繳費紀錄</th><th className="num">應繳紀錄</th><th></th></tr></thead>
              <tbody>
                {list.map((u) => {
                  const n = usage(u.unitNo);
                  return (
                    <tr key={u.id}>
                      <td>{u.unitNo}</td>
                      <td>{u.owner}</td>
                      <td>{new Date(u.deletedAt!).toLocaleString('zh-TW')}</td>
                      <td className="num">{n.payments || ''}</td>
                      <td className="num">{n.dues || ''}</td>
                      <td className="row-actions">
                        <button className="link" onClick={() => restore(u.id, u.unitNo)}>加回</button>
                        <button className="link danger" onClick={() => purge(u.id, u.unitNo)}>永久刪除</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
