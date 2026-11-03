import { useMemo, useState } from 'react';
import { Money, Section } from '../components/ui';
import { FIELD_LABELS, newId, REQUIRED_FIELDS } from '../lib/defaults';
import { monthOf } from '../lib/dates';
import BillImport from '../components/BillImport';
import ImportReview, { ReviewDecision } from '../components/ImportReview';
import { Go, useNavArg } from '../components/nav';
import { AmountCheck, findAmountMismatches } from '../lib/allocation';
import { MergeResult, mergeRows } from '../lib/ledger';
import { extractRows, gridToTable, guessMapping, missingRequired, detectHeaderRow, sheetMeta } from '../lib/parser';
import { AppData, ColumnMapping, FieldKey } from '../lib/types';
import { readWorkbook, SheetGrid } from '../lib/xlsxio';
import { useStore } from '../store';

export default function ImportPage({ go }: { go: Go }) {
  const { data, update, isClosed } = useStore();
  const [fileName, setFileName] = useState('');
  const [sheets, setSheets] = useState<SheetGrid[]>([]);
  const [sheetIdx, setSheetIdx] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const navArg = useNavArg();
  const [tab, setTab] = useState<'deposit' | 'dues'>(navArg === 'dues' ? 'dues' : 'deposit');
  const [review, setReview] = useState<{ batchId: string; result: MergeResult; checks: AmountCheck[]; dryData: AppData } | null>(null);

  const sheet = sheets[sheetIdx];
  const table = useMemo(() => (sheet ? gridToTable(sheet.sheetName, sheet.grid, headerRow) : null), [sheet, headerRow]);

  const preview = useMemo(() => {
    if (!table || missingRequired(mapping).length) return null;
    const meta = sheetMeta(sheet.grid, headerRow);
    const { rows, issues } = extractRows(table, mapping, data.settings.excludeStatusKeywords, { depositDate: meta.depositDate });
    const net = rows.reduce((s, r) => s + (r.depositAmount ?? r.amount - r.fee), 0);
    const digits = (x: string) => x.replace(/\D/g, '');
    const payoutAccount = meta.payoutAccount
      ? data.settings.accounts.find((a) => a.accountNo && digits(a.accountNo) === digits(meta.payoutAccount))
      : undefined;
    const closedRows = rows.filter((r) => isClosed(r.paidDate));
    const openRows = rows.filter((r) => !isClosed(r.paidDate));
    const dry = mergeRows(data.payments, openRows, 'preview');
    const mismatches = findAmountMismatches({ ...data, payments: dry.payments }, new Set(dry.payments.filter((p) => p.batchId === 'preview').map((p) => p.id))).length;
    const months = Array.from(new Set(rows.map((r) => monthOf(r.paidDate)))).sort();
    return {
      rows,
      openRows,
      issues,
      closedRows,
      dry,
      months,
      total: rows.reduce((s, r) => s + r.amount, 0),
      net,
      mismatches,
      meta,
      payoutAccount,
      withDepositDate: rows.filter((r) => r.reportDepositDate).length,
    };
  }, [table, sheet, headerRow, mapping, data.payments, data.settings, isClosed]);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    setDone('');
    try {
      const wb = await readWorkbook(file);
      if (!wb.length) throw new Error('檔案中沒有工作表');
      const best = wb.reduce((bi, s, i) => (s.grid.length > wb[bi].grid.length ? i : bi), 0);
      const hr = detectHeaderRow(wb[best].grid);
      const t = gridToTable(wb[best].sheetName, wb[best].grid, hr);
      setFileName(file.name);
      setSheets(wb);
      setSheetIdx(best);
      setHeaderRow(hr);
      setMapping(guessMapping(t.headers, data.settings.mapping));
    } catch (e) {
      setError(`讀取失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function changeSheet(i: number) {
    const hr = detectHeaderRow(sheets[i].grid);
    setSheetIdx(i);
    setHeaderRow(hr);
    setMapping(guessMapping(gridToTable(sheets[i].sheetName, sheets[i].grid, hr).headers, data.settings.mapping));
  }

  function changeHeaderRow(n: number) {
    setHeaderRow(n);
    setMapping(guessMapping(gridToTable(sheet.sheetName, sheet.grid, n).headers, data.settings.mapping));
  }

  const earliest = [...(preview?.months ?? []), ...data.dues.map((d) => d.month)].reduce((m, x) => (!m || x < m ? x : m), '');
  const earlyMonth = preview && data.settings.billingStartMonth && earliest && earliest < data.settings.billingStartMonth ? earliest : '';
  const d0 = (m: string) => m || '（自動）';

  function doImport() {
    if (!preview || !table) return;
    const batchId = newId('b_');
    const result = mergeRows(data.payments, preview.openRows, batchId);
    const newIds = new Set(result.payments.filter((p) => p.batchId === batchId).map((p) => p.id));
    const dryData = { ...data, payments: result.payments };
    const checks = findAmountMismatches(dryData, newIds);
    if (checks.length) return setReview({ batchId, result, checks, dryData });
    commit(batchId, result, new Map());
  }

  function commit(batchId: string, result: MergeResult, decisions: Map<string, ReviewDecision>) {
    if (!preview || !table) return;
    const payments = result.payments.map((p) => {
      const d = decisions.get(p.id);
      if (!d) return p;
      return {
        ...p,
        ...(d.allocations ? { allocations: d.allocations } : {}),
        note: d.note ? [p.note, `匯入確認：${d.note}`].filter(Boolean).join('；') : p.note,
      };
    });
    const manual = Array.from(decisions.values()).filter((d) => d.allocations).length;
    update(
      (d) => ({
        ...d,
        payments,
        settings: remember ? { ...d.settings, mapping } : d.settings,
        batches: [
          ...d.batches,
          {
            id: batchId,
            fileName,
            sheetName: table.sheetName,
            importedAt: new Date().toISOString(),
            totalRows: table.rows.length,
            added: result.added,
            duplicates: result.duplicates,
            skipped: preview.issues.length + preview.closedRows.length,
          },
        ],
      }),
      '匯入報表',
      `${fileName}：新增 ${result.added}、重複 ${result.duplicates}、更新 ${result.updated}${decisions.size ? `、金額確認 ${decisions.size}（手動銷帳 ${manual}）` : ''}`,
    );
    setDone(
      `匯入完成：新增 ${result.added} 筆，重複略過 ${result.duplicates} 筆，更新 ${result.updated} 筆（入帳日或金額有變動）` +
        (decisions.size ? `；${decisions.size} 筆金額與當期應繳不同已確認（手動指定銷帳 ${manual} 筆）。` : '。'),
    );
    setReview(null);
    setSheets([]);
  }

  return (
    <>
      <div className="page-head">
        <h1>匯入智生活報表</h1>
        <div className="actions">
          <button className={tab === 'deposit' ? 'primary' : ''} onClick={() => setTab('deposit')}>入帳報表</button>
          <button className={tab === 'dues' ? 'primary' : ''} onClick={() => setTab('dues')}>每月應繳報表</button>
        </div>
      </div>
      {tab === 'dues' ? (
        <Section title="每月應繳報表（智生活管理費匯入範本）">
          <BillImport go={go} />
        </Section>
      ) : (
        <>
          <Section title="1. 選擇檔案">
            <p className="hint">
              請從智生活管理後台「管理費 → 入帳報表」下載繳費明細（Excel 或 CSV）。同一份檔案重複匯入不會重複計算；
              入帳日使用報表上方的「預計入帳日」（或明細的入帳日欄位）；沒有入帳日的款項視為尚未入帳（列入在途存款），之後重新匯入有入帳日的報表會自動更新。每月應繳（管理費匯入範本）請切換到「每月應繳報表」分頁匯入。
            </p>
            <label className="drop">
              <input type="file" accept=".xlsx,.xls,.csv,.txt" onChange={(e) => onFile(e.target.files?.[0])} />
              <span>點這裡選擇檔案，或把檔案拖曳到這裡</span>
            </label>
            {error && <p className="err">{error}</p>}
            {done && (
              <p className="ok">
                {done} <button className="link" onClick={() => go('month')}>查看月結／在途存款</button>
              </p>
            )}
          </Section>

          {table && (
            <Section title="2. 確認欄位對應">
              <div className="form-row">
                <label>
                  工作表
                  <select value={sheetIdx} onChange={(e) => changeSheet(Number(e.target.value))}>
                    {sheets.map((s, i) => (
                      <option key={s.sheetName} value={i}>{s.sheetName}（{s.grid.length} 列）</option>
                    ))}
                  </select>
                </label>
                <label>
                  標題在第幾列
                  <input type="number" min={1} value={headerRow + 1} onChange={(e) => changeHeaderRow(Math.max(0, Number(e.target.value) - 1))} />
                </label>
                <label className="check">
                  <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> 記住這次的欄位對應
                </label>
              </div>
              <div className="mapping">
                {(Object.keys(FIELD_LABELS) as FieldKey[]).map((f) => (
                  <label key={f}>
                    <span>{FIELD_LABELS[f]}{REQUIRED_FIELDS.includes(f) && <em> *</em>}</span>
                    <select value={mapping[f] ?? ''} onChange={(e) => setMapping({ ...mapping, [f]: e.target.value || undefined })}>
                      <option value="">（無）</option>
                      {table.headers.filter((h) => !/戶別\s*id/i.test(h)).map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {missingRequired(mapping).length > 0 && (
                <p className="err">請指定必填欄位：{missingRequired(mapping).map((f) => FIELD_LABELS[f]).join('、')}</p>
              )}
            </Section>
          )}

          {preview && (
            <Section
              title="3. 預覽與匯入"
              actions={
                <button className="primary" disabled={preview.dry.added === 0 && preview.dry.updated === 0} onClick={doImport}>
                  確認匯入 {preview.dry.added} 筆
                </button>
              }
            >
              <ul className="summary">
                <li>可匯入 {preview.rows.length} 筆，繳費合計 <Money value={preview.total} /> 元、入帳合計 <Money value={preview.net} /> 元，繳費月份：{preview.months.join('、')}</li>
                {preview.meta.depositDate && !mapping.depositDate && <li>報表預計入帳日 <strong>{preview.meta.depositDate}</strong>，本檔所有款項以此日入帳</li>}
                {preview.meta.payoutAmount !== null && (
                  <li className={Math.round(preview.meta.payoutAmount) === Math.round(preview.net) ? 'ok' : 'warn'}>
                    報表撥款金額 <Money value={preview.meta.payoutAmount} /> 元，{Math.round(preview.meta.payoutAmount) === Math.round(preview.net) ? '與明細入帳合計相符' : `與明細入帳合計差 ${(preview.meta.payoutAmount - preview.net).toLocaleString('zh-TW')} 元，請確認`}
                    {preview.meta.count !== null && preview.meta.count !== preview.rows.length + preview.issues.length ? `（報表筆數 ${preview.meta.count}，可匯入 ${preview.rows.length}）` : ''}
                  </li>
                )}
                {preview.meta.payoutAccount && (
                  <li className={preview.payoutAccount ? '' : 'warn'}>
                    撥款帳號 {preview.meta.payoutAccount}
                    {preview.payoutAccount ? ` → 帳戶「${preview.payoutAccount.name}」` : '：不在「基本設定 → 銀行帳戶」中，請確認管理費轉入帳戶的完整帳號'}
                  </li>
                )}
                <li>新增 {preview.dry.added} 筆；已存在 {preview.dry.duplicates} 筆（略過）{preview.dry.updated ? `；其中 ${preview.dry.updated} 筆入帳日或金額有變動，會更新` : ''}</li>
                <li>{preview.withDepositDate === preview.rows.length ? '全部都有入帳日' : `${preview.rows.length - preview.withDepositDate} 筆沒有入帳日，視為尚未入帳（在途存款）`}</li>
                {earlyMonth && (
                  <li className="err">
                    帳務起始月是 {data.settings.billingStartMonth}，但有更早的繳費或應繳（{earlyMonth}）；起始月之前的應繳不會銷帳（確認視窗的應繳會顯示 0）。
                    <button className="primary" onClick={() => update((d) => ({ ...d, settings: { ...d.settings, billingStartMonth: earlyMonth } }), '修改帳務起始月', `${d0(data.settings.billingStartMonth)} → ${earlyMonth}`)}>把起始月改成 {earlyMonth}</button>
                  </li>
                )}
                {preview.mismatches > 0 && <li className="warn">{preview.mismatches} 筆繳費金額與帳單金額不同（多繳或少繳），按「確認匯入」後會逐筆請你確認要銷哪幾個月</li>}
                {preview.closedRows.length > 0 && <li className="warn">{preview.closedRows.length} 筆屬於已月結月份，將略過（如需補登請先解除該月結帳）</li>}
                {preview.issues.length > 0 && (
                  <li className="warn">
                    {preview.issues.length} 列未匯入：
                    {preview.issues.slice(0, 8).map((i) => `第${i.rowNumber}列 ${i.reason}`).join('；')}
                    {preview.issues.length > 8 ? '…' : ''}
                  </li>
                )}
              </ul>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>列</th><th>戶別</th><th>所有權人</th><th>期別</th><th>項目</th><th>繳費日</th><th>繳費方式</th><th className="num">金額</th><th className="num">手續費</th><th className="num">入帳金額</th><th>入帳日</th></tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 50).map((r) => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td><td>{r.unitNo}</td><td>{r.payerName}</td><td>{r.billPeriod}</td><td>{r.item}</td>
                        <td>{r.paidDate}</td><td>{r.channel}</td>
                        <td className="num"><Money value={r.amount} /></td><td className="num">{r.fee ? <Money value={r.fee} /> : ''}</td><td className="num"><Money value={r.depositAmount ?? r.amount - r.fee} /></td>
                        <td>{r.reportDepositDate || <span className="tag warn">尚未入帳</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 50 && <p className="hint">僅顯示前 50 筆。</p>}
              </div>
            </Section>
          )}
        </>
      )}
      {review && (
        <ImportReview
          checks={review.checks}
          dryData={review.dryData}
          onCancel={() => setReview(null)}
          onDone={(decisions) => commit(review.batchId, review.result, decisions)}
        />
      )}
    </>
  );
}
