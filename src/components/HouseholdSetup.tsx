import { useState } from 'react';
import { billingStart, firstBillMonth, unitNosFromPayments } from '../lib/allocation';
import { newId } from '../lib/defaults';
import { useStore } from '../store';

/** 設定總戶數、銷帳起始月，並可從繳費紀錄帶入戶別。 */
export default function HouseholdSetup({ onDone }: { onDone?: () => void }) {
  const { data, update } = useStore();
  const s = data.settings;
  const [total, setTotal] = useState(String(s.totalUnits || ''));
  // 預設用第一個匯入帳單的月份；帳單拆出的前期欠款和更早的繳款不算（否則會被帶到上個月）
  const firstBill = firstBillMonth(data.dues);
  const [start, setStart] = useState(s.billingStartMonth || firstBill || billingStart(data));
  const [importUnits, setImportUnits] = useState(true);
  const [msg, setMsg] = useState('');
  const found = unitNosFromPayments(data.payments, s.units);

  function save() {
    const n = Math.floor(Number(total));
    if (!n || n < 1) return setMsg('請輸入總戶數');
    if (!start) return setMsg('請選擇銷帳起始月份');
    const added = importUnits ? found.map((unitNo) => ({ id: newId('u_'), unitNo, owner: '', monthlyFee: 0, note: '' })) : [];
    update(
      (d) => ({
        ...d,
        settings: {
          ...d.settings,
          totalUnits: n,
          billingStartMonth: start,
          units: [...d.settings.units, ...added].sort((a, b) => a.unitNo.localeCompare(b.unitNo, 'zh-Hant', { numeric: true })),
        },
      }),
      '設定總戶數',
      `${n} 戶，起始 ${start}${added.length ? `，帶入戶別 ${added.length} 戶` : ''}`,
    );
    setMsg('');
    onDone?.();
  }

  return (
    <div className="setup">
      <div className="form-row">
        <label>總戶數 <input type="number" min={1} value={total} onChange={(e) => setTotal(e.target.value)} placeholder="例如 120" /></label>
        <label>銷帳起始月份 <input type="month" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      </div>
      {found.length > 0 && (
        <label className="check">
          <input type="checkbox" checked={importUnits} onChange={(e) => setImportUnits(e.target.checked)} />
          從繳費紀錄帶入 {found.length} 個尚未建立的戶別（基準請到「戶別與月費 → 基準與費率」設定，或匯入每月應繳報表時選「更新基準」）
        </label>
      )}
      {firstBill && start < firstBill && (
        <p className="banner warn">
          第一個匯入的每月應繳是 {firstBill}，起始月份設得比它早，那些月份沒有應繳；期別在 {firstBill} 以前的繳款仍當成起始月前的帳單，不銷帳。建議設為 {firstBill}。
        </p>
      )}
      <p className="hint">
        銷帳起始月份之前的月份不計應繳（例如開始使用本系統的月份，通常是第一個匯入的每月應繳月份）。總戶數用來檢查戶別是否都已建立；
        戶別由「匯入智生活報表 → 每月應繳報表」匯入智生活管理費匯入範本建立（匯入時可勾選要排除的戶別）；入帳報表裡有尚未建立的戶別時，這裡會出現「從繳費紀錄帶入」。
      </p>
      <div className="form-row">
        <button className="primary" onClick={save}>儲存</button>
        {onDone && s.totalUnits > 0 && <button onClick={onDone}>取消</button>}
        {msg && <span className="err">{msg}</span>}
      </div>
    </div>
  );
}
