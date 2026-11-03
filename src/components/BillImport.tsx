import { useMemo, useState } from 'react';
import { normUnit } from '../lib/allocation';
import {
  applyBaselineUpdates,
  BILL_ARREARS,
  BILL_ASIS,
  BILL_PREPAID,
  BillSplit,
  billItemName,
  DiffDecision,
  planBillImport,
  suggestBillItem,
} from '../lib/bills';
import { newId } from '../lib/defaults';
import { applyDueChanges, DueChangeStatus, detectWideLayout, diffDues, DueRow, dueRowsFromTable, dueRowsFromWide, UnitRow } from '../lib/dues';
import { activeUnits, BILL_ALIASES, BILL_FIELD_LABELS, BILL_REQUIRED, BillField, BillMapping, billTable, CYCLES, feeItemNames, guessBillMapping, sortUnits } from '../lib/fees';
import { applyUnitImport, excludedKeys, IncomingStatus, planUnitImport } from '../lib/owners';
import { detectHeaderRow } from '../lib/parser';
import { readWorkbook, SheetGrid } from '../lib/xlsxio';
import { useStore } from '../store';
import FirstSetupGuide from './FirstSetupGuide';
import type { Go } from './nav';
import { Money, thisMonth } from './ui';

/** 智生活的戶別 Id 只保留在資料中，不在畫面上顯示。 */
const HIDDEN_COLUMN = /戶別\s*id/i;

const STATUS_LABEL: Record<DueChangeStatus, string> = { new: '新增', changed: '變動', same: '未變動', removed: '刪除' };
const UNIT_STATUS: Record<IncomingStatus, string> = { new: '新戶別', existing: '已存在', excluded: '原本已排除' };
const fmt = (n: number) => n.toLocaleString('zh-TW');

function splitNote(sp: BillSplit): string {
  const notes: string[] = [];
  if (sp.cycle > 1) notes.push(`${CYCLES.find((c) => c.months === sp.cycle)?.label ?? `${sp.cycle} 個月`}：基準分到 ${sp.cycle} 個月`);
  if (sp.flags.includes('below')) notes.push('帳單繳費項目合計低於基準，本期應繳仍以基準計，請確認');
  if (sp.flags.includes('prior')) notes.push(`帳單內含逾期 ${fmt(sp.carried)}，系統欠款 ${fmt(sp.arrears)}，多出 ${fmt(sp.prior)} 記為前期欠款`);
  if (sp.flags.includes('lessArrears')) notes.push(`系統欠款 ${fmt(sp.arrears)} 比帳單內含逾期 ${fmt(sp.carried)} 多，可能有繳費還沒匯入`);
  if (!notes.length && sp.carried) notes.push(`帳單內含逾期 ${fmt(sp.carried)}，與系統欠款相符`);
  if (sp.prepaid) notes.push(`沖銷 ${fmt(sp.prepaid)} 從這戶的預收款扣除（預收款 ${fmt(sp.prepaidBalance)} → ${fmt(sp.prepaidBalance - sp.prepaid)}）`);
  if (sp.autoPrepaid) notes.push(`這戶有預收款，本期應繳 ${fmt(sp.autoPrepaid)} 會自動從預收款銷帳，等同沖銷（預收款 ${fmt(sp.autoBalance)} → ${fmt(sp.autoBalance - sp.autoPrepaid)}）`);
  if (sp.prepaidBefore) notes.push(`沖銷 ${fmt(sp.prepaidBefore)} 超過這戶的預收款（只有 ${fmt(sp.prepaidBalance)}），不足的部分照帳單減少應繳（啟用前已預繳的請到「戶別與月費 → 期初預收款」輸入後重新匯入）`);
  return notes.join('；');
}

/** 最常見的金額，用來提示同一項目大多數戶別的帳單金額。 */
function mode(values: number[]): number | undefined {
  const c = new Map<number, number>();
  for (const v of values) c.set(v, (c.get(v) ?? 0) + 1);
  return Array.from(c.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];
}

/**
 * 匯入每月應繳報表（智生活「管理費匯入範本」或一列一個項目的帳單明細）：
 * 帳單項目要先對應到基準費率；逐戶逐項與基準比對，不同的選擇是否更新基準，全部選完才能匯入。
 */
export default function BillImport({ go }: { go?: Go }) {
  const { data, update } = useStore();
  const s = data.settings;
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetGrid[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<BillMapping>({});
  const [fallbackMonth, setFallbackMonth] = useState(thisMonth());
  const [excludes, setExcludes] = useState<Map<string, boolean>>(new Map());
  const [ownerPicks, setOwnerPicks] = useState<Map<string, 'change' | 'keep'>>(new Map());
  const [unitFilter, setUnitFilter] = useState<'all' | 'new' | 'exclude'>('all');
  const [unitQ, setUnitQ] = useState('');
  const [showSame, setShowSame] = useState(false);
  const [rebase, setRebase] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [decisions, setDecisions] = useState<Map<string, DiffDecision>>(new Map());
  const [diffItem, setDiffItem] = useState('');
  const [msg, setMsg] = useState('');

  const sheet = sheets[sheetIdx];
  const table = useMemo(() => (sheet ? billTable(sheet.sheetName, sheet.grid, headerRow) : null), [sheet, headerRow]);
  const wide = useMemo(() => (table ? detectWideLayout(table.headers) : null), [table]);
  const missing = wide ? [] : BILL_REQUIRED.filter((f) => !mapping[f]);

  const parsed = useMemo((): { rows: DueRow[]; units: UnitRow[]; issues: { rowNumber: number; reason: string }[] } | null => {
    if (!table) return null;
    if (wide) return dueRowsFromWide(table, wide, fallbackMonth);
    if (missing.length) return null;
    const r = dueRowsFromTable(table, mapping, fallbackMonth);
    const units = Array.from(new Map(r.rows.map((x) => [normUnit(x.unitNo), { unitNo: x.unitNo, owner: x.owner, zsId: '', address: '', month: x.month }])).values());
    return { ...r, units };
  }, [table, wide, mapping, fallbackMonth, missing.length]);

  const firstTime = activeUnits(s.units).length === 0;
  const unitPlan = useMemo(() => (parsed ? planUnitImport(s.units, parsed.units, excludes) : null), [parsed, s.units, excludes]);
  const skipKeys = useMemo(() => (unitPlan ? excludedKeys(s.units, unitPlan) : new Set<string>()), [s.units, unitPlan]);
  const billRows = useMemo(() => (parsed ? parsed.rows.filter((r) => !skipKeys.has(normUnit(r.unitNo))) : []), [parsed, skipKeys]);
  const skippedRows = parsed ? parsed.rows.length - billRows.length : 0;
  const ownerDiffs = unitPlan?.ownerDiffs ?? [];
  const ownerUndecided = ownerDiffs.filter((d) => !ownerPicks.has(d.key));
  const changeOwner = new Set(ownerDiffs.filter((d) => ownerPicks.get(d.key) === 'change').map((d) => d.key));
  const unitChanges = unitPlan ? unitPlan.added + unitPlan.restored + unitPlan.excludedNow + unitPlan.fills + changeOwner.size : 0;
  // 帳單或已匯入的應繳早於帳務起始月：起始月一併往前改（比對逾期時也用新的起始月），否則那些月份不會銷帳
  const startSet = s.billingStartMonth;
  const earliest = [...billRows.map((r) => r.month), ...data.dues.map((d) => d.month)].reduce((m, x) => (!m || x < m ? x : m), '');
  const newStart = startSet && earliest && earliest < startSet ? earliest : '';
  // 比對基準時先套用這次的排除／取消排除（新戶別還沒有基準，這次只建立戶別）
  const planData = useMemo(() => {
    const units = unitPlan ? applyUnitImport(s.units, unitPlan, new Set(), () => '').slice(0, s.units.length) : s.units;
    return { ...data, settings: { ...data.settings, units, ...(newStart ? { billingStartMonth: newStart } : {}) } };
  }, [data, s.units, unitPlan, newStart]);
  const plan = useMemo(() => (parsed ? planBillImport(planData, billRows, { rebase, decisions }) : null), [parsed, planData, billRows, rebase, decisions]);
  const changes = useMemo(() => (plan && !plan.unmapped.length ? diffDues(data.dues, plan.rows, plan.billed) : []), [plan, data.dues]);
  const flagged = (f: BillSplit['flags'][number]) => (plan?.splits ?? []).filter((sp) => sp.flags.includes(f));
  const count = (st: DueChangeStatus) => changes.filter((c) => c.status === st).length;
  const pending = count('new') + count('changed') + count('removed');
  const months = Array.from(new Set((plan?.splits ?? []).map((sp) => sp.month))).sort();

  const feeItems = feeItemNames(s);
  const diffs = plan?.diffs ?? [];
  const undecided = diffs.filter((d) => !decisions.has(d.key));
  const diffItems = Array.from(new Set(diffs.map((d) => d.item)));
  const shownDiffs = diffs.filter((d) => !diffItem || d.item === diffItem);
  const billMode = useMemo(() => {
    const out = new Map<string, number | undefined>();
    for (const item of diffItems) out.set(item, mode(diffs.filter((d) => d.item === item).map((d) => d.bill)));
    return out;
  }, [diffs, diffItems.join('|')]);

  // 依戶別＋帳單月份整理預覽
  const groupStatus = useMemo(() => {
    const m = new Map<string, DueChangeStatus>();
    const rank: Record<DueChangeStatus, number> = { same: 0, new: 2, changed: 1, removed: 1 };
    for (const c of changes) {
      const k = `${normUnit(c.unitNo)}|${c.fromBill ?? c.month}`;
      const prev = m.get(k);
      if (!prev || rank[c.status] > rank[prev]) m.set(k, c.status);
    }
    return m;
  }, [changes]);
  const groups = (plan?.splits ?? [])
    .filter((sp) => !sp.flags.includes('noBase') && !sp.flags.includes('offCycle'))
    .map((sp) => ({ sp, status: groupStatus.get(`${normUnit(sp.unitNo)}|${sp.month}`) ?? 'same' }));
  const shownGroups = groups.filter((g) => showSame || g.status !== 'same');

  function reset() {
    setExcludes(new Map());
    setOwnerPicks(new Map());
    setUnitFilter('all');
    setUnitQ('');
    setPicks({});
    setDecisions(new Map());
    setDiffItem('');
    setRebase(false);
  }

  function load(i: number, wb = sheets) {
    const hr = detectHeaderRow(wb[i].grid, BILL_ALIASES);
    setSheetIdx(i);
    setHeaderRow(hr);
    setMapping(guessBillMapping(billTable(wb[i].sheetName, wb[i].grid, hr).headers));
    reset();
  }

  async function onFile(file: File | undefined) {
    setMsg('');
    if (!file) return;
    try {
      const wb = await readWorkbook(file);
      if (!wb.length) throw new Error('檔案中沒有工作表');
      setFileName(file.name);
      setSheets(wb);
      load(wb.reduce((bi, x, i) => (x.grid.length > wb[bi].grid.length ? i : bi), 0), wb);
    } catch (e) {
      setMsg(`讀取失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const pickOf = (name: string) => picks[name] ?? suggestBillItem(name, feeItems);

  function saveItemMap() {
    if (!plan) return;
    const add: Record<string, string> = {};
    for (const name of plan.unmapped) add[name] = pickOf(name);
    update((d) => ({ ...d, settings: { ...d.settings, billItemMap: { ...d.settings.billItemMap, ...add } } }), '設定帳單項目對應', Object.entries(add).map(([k, v]) => `${k}→${v}`).join('、'));
  }

  function decide(keys: string[], value: DiffDecision | null) {
    const next = new Map(decisions);
    for (const k of keys) (value ? next.set(k, value) : next.delete(k));
    setDecisions(next);
  }

  /** withDues：同時匯入應繳；否則只匯入戶別與所有權人（第一次建立戶別、或帳單項目還沒對應時）。 */
  function apply(withDues: boolean) {
    if (!parsed || !unitPlan || ownerUndecided.length) return;
    if (withDues && (!plan || plan.unmapped.length || undecided.length)) return;
    const added = count('new');
    const changed = count('changed');
    const updatedBase = withDues && plan ? plan.baselineUpdates.size : 0;
    const at = new Date().toISOString();
    const up = unitPlan;
    const excludedCount = up.rows.filter((r) => r.exclude && r.status !== 'excluded').length;
    update(
      (d) => {
        let units = applyUnitImport(d.settings.units, up, changeOwner, () => newId('u_'), at);
        if (withDues && plan) units = applyBaselineUpdates({ ...d.settings, units }, plan.baselineUpdates);
        units = sortUnits(units);
        return {
          ...d,
          dues: withDues ? applyDueChanges(d.dues, changes) : d.dues,
          settings: { ...d.settings, units, totalUnits: d.settings.totalUnits || activeUnits(units).length, ...(withDues && newStart ? { billingStartMonth: newStart } : {}) },
        };
      },
      withDues ? '匯入應繳帳單' : '匯入戶別與所有權人',
      `${fileName}${withDues ? `（${months.join('、') || '無應繳金額'}）：新增 ${added}、變動 ${changed}、刪除 ${count('removed')}、未變 ${count('same')}；更新基準 ${updatedBase} 戶；` : '：'}` +
        `戶別新增 ${up.added}、排除 ${excludedCount}、加回 ${up.restored}、所有權人變更 ${changeOwner.size}`,
    );
    const unitMsg = [
      up.added && `新增戶別 ${up.added} 戶`,
      excludedCount && `排除 ${excludedCount} 戶`,
      up.restored && `加回 ${up.restored} 戶`,
      changeOwner.size && `所有權人變更 ${changeOwner.size} 戶（從帳單月份起）`,
      up.fills && `補上所有權人 ${up.fills} 戶`,
    ].filter(Boolean).join('、');
    setMsg(
      withDues
        ? `完成：應繳新增 ${added} 筆、更新 ${changed} 筆${count('removed') ? `、刪除 ${count('removed')} 筆` : ''}（${count('same')} 筆未變動已略過）` +
            (updatedBase ? `；更新 ${updatedBase} 戶的基準費率` : '') +
            (newStart ? `；帳務起始月改為 ${newStart}` : '') +
            (unitMsg ? `；${unitMsg}` : '') +
            (up.added ? '。新戶別請設定基準後再匯入一次。' : '。')
        : `完成：${unitMsg || '戶別沒有變動'}。` +
            (firstTime ? '下一步：到「戶別與月費 → 基準與費率」建立費率方案並套用到每戶，再匯入同一份範本建立每月應繳。' : ''),
    );
    setSheets([]);
    reset();
  }

  const targetLabel = (t: string) =>
    t === BILL_ARREARS ? '逾期（帳單內含，不列應繳）' : t === BILL_PREPAID ? '沖銷（從這戶的預收款扣除）' : t === BILL_ASIS ? '照帳單（減免等，不比對基準）' : `繳費項目：${t}`;

  return (
    <>
      <p className="hint">
        選擇智生活的「管理費匯入範本」（繳費單列表：一戶一列，應繳總額右邊每一欄是一個收費項目，帳單月份取「繳費開始日期」），
        或一列一個項目的帳單明細。戶別一律使用智生活的「戶別代碼」。項目名稱前的月份（例如「11月坪數費」的「11月」）會自動去掉。
      </p>
      <p className="hint">
        匯入前會檢查：① 每個帳單項目都要對應到「基準與費率」的繳費項目（或標記為逾期、照帳單），對應不起來就不能匯入；
        ② 逐戶逐項和基準比對，金額不同的要選擇「更新基準」或「不更新」，全部選完才能匯入。
        逾期項目（例如「10月未繳管理費」）不會再列為應繳，先對應系統既有的欠款，系統沒有的記為上個月的「前期欠款」。
        帳單上的沖銷項目（例如「年繳沖銷」「預繳沖銷」，各社區名稱可能不同，第一次匯入時對應到「沖銷」）不減少應繳，而是從這戶的預收款扣除（住戶年繳、預繳、溢繳的款項，含「期初預收款」）；預收款不夠時，不足的部分才照帳單減少應繳。
      </p>
      {firstTime && !table && <FirstSetupGuide go={go} here="import" />}
      <label className="drop">
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
        <span>選擇智生活管理費匯入範本（繳費單列表）Excel</span>
      </label>
      {msg && <p className={msg.startsWith('讀取失敗') ? 'err' : 'ok'}>{msg}</p>}
      {table && (
        <>
          <div className="form-row">
            <label>工作表
              <select value={sheetIdx} onChange={(e) => load(Number(e.target.value))}>
                {sheets.map((x, i) => <option key={x.sheetName} value={i}>{x.sheetName}（{x.grid.length} 列）</option>)}
              </select>
            </label>
            <label>標題在第幾列
              <input type="number" min={1} value={headerRow + 1} onChange={(e) => {
                const hr = Math.max(0, Number(e.target.value) - 1);
                setHeaderRow(hr);
                setMapping(guessBillMapping(billTable(sheet.sheetName, sheet.grid, hr).headers));
              }} />
            </label>
            <label>{wide ? '繳費開始日期空白時歸到' : '沒有期別的列歸到'}
              <input type="month" value={fallbackMonth} onChange={(e) => setFallbackMonth(e.target.value)} />
            </label>
          </div>
          {wide ? (
            <p className="banner ok">
              已辨識為智生活管理費匯入範本：戶別「{wide.unitCol}」、所有權人「{wide.ownerCol ?? '—'}」，
              收費項目欄：{wide.itemCols.map((c) => c.replace(/\(\d+\)$/, '')).join('、')}（沒有金額的欄位會略過）。
            </p>
          ) : (
            <div className="mapping">
              {(Object.keys(BILL_FIELD_LABELS) as BillField[]).map((f) => (
                <label key={f}>
                  <span>{BILL_FIELD_LABELS[f]}{BILL_REQUIRED.includes(f) && <em> *</em>}</span>
                  <select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
                    <option value="">（無）</option>
                    {table.headers.filter((h) => !HIDDEN_COLUMN.test(h)).map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </label>
              ))}
            </div>
          )}
          {missing.length > 0 && <p className="err">請指定：{missing.map((f) => BILL_FIELD_LABELS[f]).join('、')}</p>}

          {parsed && unitPlan && (
            <>
              {firstTime && (
                <section className="banner ok block">
                  <strong>第一次匯入：這次先建立戶別與所有權人</strong>
                  <span>
                    檔案內的戶別預設全部建立；不需要管理的戶別（例如管理室、公設）請在下表勾選「排除」。按「建立戶別」後，
                    到「戶別與月費 → 基準與費率」建立費率方案並套用到每戶，再回來匯入同一份範本，就會比對基準、建立每月應繳。
                  </span>
                </section>
              )}
              <section className="import-units">
                <h3>
                  檔案內的戶別（{unitPlan.rows.length} 戶）：
                  {[
                    unitPlan.added && `新增 ${unitPlan.added} 戶`,
                    unitPlan.rows.filter((r) => r.status !== 'new' && !r.exclude).length && `已存在 ${unitPlan.rows.filter((r) => r.status !== 'new' && !r.exclude).length} 戶`,
                    unitPlan.rows.filter((r) => r.exclude).length && `排除 ${unitPlan.rows.filter((r) => r.exclude).length} 戶`,
                  ].filter(Boolean).join('、')}
                </h3>
                <p className="hint">
                  預設全部匯入。不需要管理的戶別勾選「排除」：排除的戶別不建立應繳、不列入欠費與銷帳，之後匯入也會自動略過
                  {skippedRows ? `（這次略過 ${skippedRows} 筆應繳）` : ''}。之後要加回，可以在這裡取消勾選，或到「基本設定 → 已排除的戶別」按「加回」。
                </p>
                <div className="form-row">
                  {(['all', 'new', 'exclude'] as const).map((f) => (
                    <button key={f} className={unitFilter === f ? 'primary' : ''} onClick={() => setUnitFilter(f)}>
                      {f === 'all' ? '全部' : f === 'new' ? `新戶別（${unitPlan.added + unitPlan.rows.filter((r) => r.status === 'new' && r.exclude).length}）` : `排除（${unitPlan.rows.filter((r) => r.exclude).length}）`}
                    </button>
                  ))}
                  <input placeholder="搜尋戶別代碼或所有權人" value={unitQ} onChange={(e) => setUnitQ(e.target.value)} />
                </div>
                <div className="table-wrap short">
                  <table>
                    <thead><tr><th>排除</th><th>戶別代碼</th><th>所有權人</th><th>地址</th><th>狀態</th></tr></thead>
                    <tbody>
                      {unitPlan.rows
                        .filter((r) => unitFilter === 'all' || (unitFilter === 'new' ? r.status === 'new' : r.exclude))
                        .filter((r) => !unitQ.trim() || `${r.row.unitNo} ${r.row.owner}`.toUpperCase().includes(unitQ.trim().toUpperCase()))
                        .map((r) => (
                          <tr key={r.key} className={r.exclude ? 'muted-row' : ''}>
                            <td><input type="checkbox" aria-label={`排除 ${r.row.unitNo}`} checked={r.exclude} onChange={(e) => setExcludes(new Map(excludes).set(r.key, e.target.checked))} /></td>
                            <td>{r.row.unitNo}</td><td>{r.row.owner}</td><td>{r.row.address}</td>
                            <td>
                              {r.exclude
                                ? <span className="tag warn">{r.status === 'existing' ? '這次排除' : '排除'}</span>
                                : <span className={`tag ${r.status === 'new' ? 'ok' : ''}`}>{r.status === 'excluded' ? '加回' : UNIT_STATUS[r.status]}</span>}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {ownerDiffs.length > 0 && (
                <section className={`banner block ${ownerUndecided.length ? 'warn' : 'ok'}`}>
                  <strong>{ownerDiffs.length} 戶的所有權人和系統不同{ownerUndecided.length ? `，還有 ${ownerUndecided.length} 戶沒選擇，選完才能匯入` : '，已全部選擇'}</strong>
                  <span>
                    「從帳單月份起變更」：這期與之後的月份顯示新所有權人；之前的月份與報表仍是原所有權人（不會回溯），可在「戶別與月費 → 基準與費率」點所有權人查看變更紀錄。
                    「不變更」：維持系統的所有權人（例如帳單寫法不同但是同一人）。
                  </span>
                  <div className="form-row">
                    <button onClick={() => setOwnerPicks(new Map(ownerDiffs.map((d) => [d.key, 'change'])))}>全部從帳單月份起變更</button>
                    <button onClick={() => setOwnerPicks(new Map(ownerDiffs.map((d) => [d.key, 'keep'])))}>全部不變更</button>
                  </div>
                  <div className="table-wrap short">
                    <table>
                      <thead><tr><th>戶別</th><th>帳單月份</th><th>系統（該月）所有權人</th><th>帳單上的所有權人</th><th>選擇</th></tr></thead>
                      <tbody>
                        {ownerDiffs.map((d) => {
                          const v = ownerPicks.get(d.key);
                          return (
                            <tr key={d.key} className={v ? '' : 'attention'}>
                              <td>{d.unitNo}</td><td>{d.month}</td><td>{d.current}</td><td><strong>{d.incoming}</strong></td>
                              <td>
                                <label className="check inline"><input type="radio" name={`o${d.key}`} checked={v === 'change'} onChange={() => setOwnerPicks(new Map(ownerPicks).set(d.key, 'change'))} /> 從 {d.month} 起變更</label>
                                <label className="check inline"><input type="radio" name={`o${d.key}`} checked={v === 'keep'} onChange={() => setOwnerPicks(new Map(ownerPicks).set(d.key, 'keep'))} /> 不變更</label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {firstTime && (
                <div className="form-row">
                  <button className="primary" disabled={!unitChanges || ownerUndecided.length > 0} onClick={() => apply(false)}>
                    建立戶別（{unitPlan.added} 戶{unitPlan.rows.filter((r) => r.exclude).length ? `，排除 ${unitPlan.rows.filter((r) => r.exclude).length} 戶` : ''}）
                  </button>
                </div>
              )}
            </>
          )}

          {!firstTime && plan && plan.unmapped.length > 0 && (
            <section className="banner err block">
              <strong>有 {plan.unmapped.length} 個帳單項目還沒對應到基準費率，不能匯入。</strong>
              <span>
                請選擇每個項目對應到哪個繳費項目。如果是新的收費（例如新的清潔費），請先到「戶別與月費 → 基準與費率」新增方案（方案名稱就是繳費項目），再回來選擇。
                住戶年繳、預繳或溢繳後，帳單上用來扣抵的負數項目（不論叫「年繳沖銷」「預繳扣抵」或其他名稱）請選「沖銷（從這戶的預收款扣除）」。
                對應會記住，之後匯入自動套用。
              </span>
              <table className="compact-inputs">
                <thead><tr><th>帳單項目</th><th className="num">筆數</th><th className="num">合計金額</th><th>對應到</th></tr></thead>
                <tbody>
                  {plan.unmapped.map((name) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="num">{billRows.filter((r) => billItemName(r.item) === name).length}</td>
                      <td className="num"><Money value={billRows.filter((r) => billItemName(r.item) === name).reduce((t, r) => t + r.amount, 0)} /></td>
                      <td>
                        <select value={pickOf(name)} onChange={(e) => setPicks({ ...picks, [name]: e.target.value })}>
                          <option value="">— 請選擇 —</option>
                          <optgroup label="基準費率的繳費項目">
                            {feeItems.map((f) => <option key={f} value={f}>{f}</option>)}
                          </optgroup>
                          <option value={BILL_ARREARS}>{targetLabel(BILL_ARREARS)}</option>
                          <option value={BILL_PREPAID}>{targetLabel(BILL_PREPAID)}</option>
                          <option value={BILL_ASIS}>{targetLabel(BILL_ASIS)}</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="form-row">
                <button className="primary" disabled={plan.unmapped.some((n) => !pickOf(n))} onClick={saveItemMap}>確認對應</button>
                {unitChanges > 0 && <button disabled={ownerUndecided.length > 0} onClick={() => apply(false)}>先只匯入戶別與所有權人（{unitChanges} 戶）</button>}
              </div>
            </section>
          )}

          {!firstTime && plan && !plan.unmapped.length && parsed && (
            <>
              <ul className="summary">
                {plan.splits.some((sp) => sp.prepaid || sp.autoPrepaid) && (
                  <li>
                    從預收款扣除：{plan.splits.filter((sp) => sp.prepaid || sp.autoPrepaid).length} 戶共 <Money value={plan.splits.reduce((t, sp) => t + sp.prepaid + sp.autoPrepaid, 0)} /> 元
                    （帳單沖銷 <Money value={plan.splits.reduce((t, sp) => t + sp.prepaid, 0)} /> 元、多繳／預繳自動銷帳 <Money value={plan.splits.reduce((t, sp) => t + sp.autoPrepaid, 0)} /> 元，說明欄有扣除前後的預收款）
                  </li>
                )}
                <li>帳單 {plan.splits.length ? `${plan.splits.length} 筆（帳單月份：${months.join('、')}）` : '：目前沒有填任何應繳金額'}</li>
                {newStart && <li className="warn">帳務起始月目前是 {startSet}，有更早的帳單（{newStart}），匯入後起始月會改為 {newStart}（否則這些月份不會銷帳）</li>}
                {changes.length > 0 && <li><strong>應繳新增 {count('new')} 筆、變動 {count('changed')} 筆{count('removed') ? `、刪除 ${count('removed')} 筆` : ''}</strong>、未變動 {count('same')} 筆（略過）</li>}
                {groups.some((g) => g.sp.carried) && <li>帳單內含逾期：{groups.filter((g) => g.sp.carried).length} 戶，共 <Money value={groups.reduce((t, g) => t + g.sp.carried, 0)} /> 元（不重複列為應繳）{flagged('prior').length ? `，其中 ${flagged('prior').length} 戶有系統沒有的欠款，記為前期欠款` : ''}</li>}
                {flagged('below').length > 0 && <li className="warn">{flagged('below').length} 戶帳單低於基準，本期應繳仍以基準計：{flagged('below').slice(0, 6).map((sp) => sp.unitNo).join('、')}{flagged('below').length > 6 ? '…' : ''}</li>}
                {flagged('lessArrears').length > 0 && <li className="warn">{flagged('lessArrears').length} 戶系統欠款比帳單內含的逾期多，可能有繳費還沒匯入：{flagged('lessArrears').slice(0, 6).map((sp) => sp.unitNo).join('、')}{flagged('lessArrears').length > 6 ? '…' : ''}</li>}
                {plan.splits.some((sp) => sp.prepaidBefore) && (
                  <li className="warn">
                    {plan.splits.filter((sp) => sp.prepaidBefore).length} 戶帳單的沖銷超過這戶的預收款，不足的部分這次照帳單減少應繳：
                    {plan.splits.filter((sp) => sp.prepaidBefore).slice(0, 6).map((sp) => sp.unitNo).join('、')}{plan.splits.filter((sp) => sp.prepaidBefore).length > 6 ? '…' : ''}。
                    啟用本系統前已預繳的，請先到「戶別與月費 → 期初預收款」輸入每戶還剩多少預收款再匯入，沖銷就會由預收款銷帳。
                  </li>
                )}
                {flagged('offCycle').length > 0 && <li className="err">{flagged('offCycle').length} 戶這個月不是繳費週期的第一個月，不會匯入，請確認「基準與費率」的繳費週期：{flagged('offCycle').slice(0, 6).map((sp) => sp.unitNo).join('、')}{flagged('offCycle').length > 6 ? '…' : ''}</li>}
                {flagged('noBase').length > 0 && <li className="warn">{flagged('noBase').length} 戶是新戶別，這次只建立戶別、不匯入應繳（到「基準與費率」設定基準後再匯入一次）</li>}
                {parsed.issues.length > 0 && (
                  <li className="warn">{parsed.issues.length} 列未匯入：{parsed.issues.slice(0, 6).map((i) => `第${i.rowNumber}列 ${i.reason}`).join('；')}{parsed.issues.length > 6 ? '…' : ''}</li>
                )}
              </ul>

              {diffs.length > 0 && (
                <section className={`banner block ${undecided.length ? 'warn' : 'ok'}`}>
                  <strong>{diffs.length} 筆帳單金額和基準費率不同{undecided.length ? `，還有 ${undecided.length} 筆沒選擇，選完才能匯入` : '，已全部選擇'}</strong>
                  <span>「更新基準」：這戶這項的基準改成帳單金額，本期應繳照帳單。「不更新」：基準不變，本期應繳照基準，多出的部分視為帳單內含逾期。基準只在匯入時拿來比對。</span>
                  <table>
                    <thead><tr><th>繳費項目</th><th className="num">不同的戶數</th><th className="num">多數戶帳單金額</th><th></th></tr></thead>
                    <tbody>
                      {diffItems.map((item) => {
                        const keys = diffs.filter((d) => d.item === item).map((d) => d.key);
                        return (
                          <tr key={item} className={diffItem === item ? 'selected' : ''}>
                            <td><button className="link" onClick={() => setDiffItem(diffItem === item ? '' : item)}>{item}</button></td>
                            <td className="num">{keys.length}</td>
                            <td className="num">{billMode.get(item) !== undefined ? fmt(billMode.get(item)!) : ''}</td>
                            <td>
                              <button onClick={() => decide(keys, 'update')}>這項全部更新基準</button>
                              <button onClick={() => decide(keys, 'keep')}>這項全部不更新</button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="table-wrap short">
                    <table>
                      <thead><tr><th>戶別</th><th>所有權人</th><th>月份</th><th>繳費項目</th><th className="num">基準</th><th className="num">帳單</th><th className="num">差額</th><th>選擇</th></tr></thead>
                      <tbody>
                        {shownDiffs.slice(0, 600).map((d) => {
                          const v = decisions.get(d.key);
                          return (
                            <tr key={d.key} className={v ? '' : 'attention'}>
                              <td>{d.unitNo}</td><td>{d.owner}</td><td>{d.month}</td><td>{d.item}</td>
                              <td className="num">{d.base ? <Money value={d.base} /> : <span className="muted">未設定</span>}</td>
                              <td className="num">{d.bill ? <Money value={d.bill} /> : <span className="muted">帳單沒有</span>}</td>
                              <td className="num"><Money value={d.bill - d.base} /></td>
                              <td>
                                <label className="check inline"><input type="radio" name={d.key} checked={v === 'update'} onChange={() => decide([d.key], 'update')} /> 更新基準</label>
                                <label className="check inline"><input type="radio" name={d.key} checked={v === 'keep'} onChange={() => decide([d.key], 'keep')} /> 不更新</label>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    {shownDiffs.length > 600 && <p className="hint">只列出前 600 筆，請用上方「這項全部…」批次選擇。</p>}
                  </div>
                </section>
              )}

              <div className="form-row">
                <button className="primary" disabled={(!pending && !unitChanges) || undecided.length > 0 || ownerUndecided.length > 0} onClick={() => apply(true)}>
                  確認匯入{changes.length ? `（應繳新增 ${count('new')}、更新 ${count('changed')}${count('removed') ? `、刪除 ${count('removed')}` : ''}）` : ''}{unitChanges ? `（戶別 ${unitChanges} 戶）` : ''}{plan.baselineUpdates.size ? `（更新基準 ${plan.baselineUpdates.size} 戶）` : ''}
                </button>
                {undecided.length > 0 && <span className="err">還有 {undecided.length} 筆和基準不同、尚未選擇</span>}
                {ownerUndecided.length > 0 && <span className="err">還有 {ownerUndecided.length} 戶所有權人不同、尚未選擇</span>}
                {plan.splits.some((sp) => sp.frozen) && (
                  <label className="check" title="預設沿用當時匯入的基準，調整費率不影響已匯入的月份">
                    <input type="checkbox" checked={rebase} onChange={(e) => { setRebase(e.target.checked); setDecisions(new Map()); }} /> 已匯入過的月份改用目前基準重新比對（{plan.splits.filter((sp) => sp.frozen).length} 戶）
                  </label>
                )}
                {groups.length > 0 && <label className="check"><input type="checkbox" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} /> 預覽也列出未變動的</label>}
              </div>
              {groups.length > 0 && (
                <div className="table-wrap short">
                  <table>
                    <thead><tr><th>戶別</th><th>所有權人</th><th>月份</th><th className="num">帳單合計</th><th className="num">本期應繳（基準）</th><th className="num">帳單內含逾期</th><th>狀態</th><th>說明</th></tr></thead>
                    <tbody>
                      {shownGroups.slice(0, 500).map(({ sp, status }) => (
                        <tr key={`${sp.unitNo}|${sp.month}`} className={sp.flags.some((f) => f === 'below' || f === 'lessArrears') ? 'attention' : ''}>
                          <td>{sp.unitNo}</td><td>{sp.owner}</td><td>{sp.month}</td>
                          <td className="num"><Money value={sp.bill} /></td>
                          <td className="num"><Money value={sp.base} strong /></td>
                          <td className="num">{sp.carried ? <Money value={sp.carried} /> : ''}</td>
                          <td><span className={`tag ${status === 'new' ? 'ok' : status === 'same' ? '' : 'warn'}`}>{STATUS_LABEL[status]}</span></td>
                          <td className="note-cell wide-note">{splitNote(sp)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {shownGroups.length === 0 && <p className="empty">和目前資料完全相同，沒有需要更新的應繳。</p>}
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
