import { forwardRef } from 'react';
import { ArrearsLine, arrearsReportLines, suggestArrearsLabel } from '../lib/arrears';
import { useStore } from '../store';
import { Icon } from './icons';
import { isEnterKey, Money, Section } from './ui';

const fmt = (n: number) => n.toLocaleString('zh-TW');

/** 收支報表 → 逾期款項：每筆逾期銷帳要歸類到報表科目（例如「10月逾期汽車清潔費」），同一科目可以選擇在月報合併成一筆。 */
const ArrearsPanel = forwardRef<HTMLElement, { month: string; lines: ArrearsLine[]; onPrint: () => void }>(function ArrearsPanel({ month, lines, onPrint }, ref) {
  const { data, update } = useStore();
  const labels = data.arrearsLabels ?? {};
  const merge = data.settings.arrearsMerge ?? {};
  const unclassified = lines.filter((l) => !l.label);
  const total = lines.reduce((t, l) => t + l.amount, 0);
  const used = [...new Set([...Object.values(labels), ...lines.map(suggestArrearsLabel)])].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const groups = arrearsReportLines(lines.filter((l) => l.label), {}).map((g) => ({ ...g, merged: merge[g.label] !== false }));

  const setLabels = (patch: Record<string, string>, action: string, detail: string) =>
    update((d) => {
      const next = { ...(d.arrearsLabels ?? {}) };
      for (const [k, v] of Object.entries(patch)) {
        if (v.trim()) next[k] = v.trim();
        else delete next[k];
      }
      return { ...d, arrearsLabels: next };
    }, action, detail);
  const fillSuggestions = () =>
    setLabels(Object.fromEntries(unclassified.map((l) => [l.key, suggestArrearsLabel(l)])), '套用逾期款項建議科目', `${month} ${unclassified.length} 筆`);
  const setMerge = (label: string, on: boolean) =>
    update((d) => ({ ...d, settings: { ...d.settings, arrearsMerge: { ...(d.settings.arrearsMerge ?? {}), [label]: on } } }), '設定逾期科目合併', `${label} ${on ? '合併' : '逐筆列出'}`);

  return (
    <section ref={ref} className="no-print arrears-anchor">
      <Section
        title={`${month} 逾期款項（${lines.length} 筆，合計 ${fmt(total)} 元）`}
        actions={
          <>
            {unclassified.length > 0 && <button onClick={fillSuggestions}>未歸類的套用建議名稱</button>}
            <button onClick={onPrint}><Icon name="printer" />列印逾期銷帳明細</button>
          </>
        }
      >
        {unclassified.length > 0 ? (
          <div className="banner err">
            <span><strong>還有 {unclassified.length} 筆逾期款項沒有歸類報表科目</strong>（下表黃色的列），歸類前不能列印月報。可以逐筆輸入，或按「未歸類的套用建議名稱」。</span>
          </div>
        ) : (
          <div className="banner ok"><span>本月逾期款項都已歸類，月報會依下方的科目列出（報表上不顯示戶別）。</span></div>
        )}
        <p className="hint">本月繳款銷到以前月份的應繳都列在這裡，依那個月的應繳項目拆開。「報表科目」是月報（財務收支總表）上顯示的名稱，例如「10月逾期汽車清潔費」；科目相同的可以在下方選擇合併成一筆或逐筆列出。</p>
        <div className="table-wrap">
          <table className="compact-inputs arrears-table">
            <thead><tr><th>戶別</th><th>所有權人</th><th>繳費日</th><th>逾期月份</th><th>應繳項目</th><th className="num">金額</th><th>那個月的應繳</th><th>報表科目</th></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key} className={l.label ? '' : 'attention'}>
                  <td>{l.unitNo}</td>
                  <td>{l.owner}</td>
                  <td>{l.paidDate}</td>
                  <td>{l.month}</td>
                  <td>{l.item}</td>
                  <td className="num"><Money value={l.amount} /></td>
                  <td className="muted small">{l.beforeStart ? '帳務起始月前的帳單（系統沒有這個月的應繳）' : l.dueItems.map((x) => `${x.item} ${fmt(x.amount)}`).join('、')}</td>
                  <td>
                    <input
                      list="arrears-labels"
                      className={l.label ? '' : 'needs-input'}
                      defaultValue={l.label}
                      key={`${l.key}:${l.label}`}
                      placeholder={`例如 ${suggestArrearsLabel(l)}`}
                      aria-label={`${l.unitNo} ${l.month} ${l.item} 的報表科目`}
                      onBlur={(e) => e.target.value.trim() !== l.label && setLabels({ [l.key]: e.target.value }, '歸類逾期款項', `${l.unitNo} ${l.month} ${l.item} → ${e.target.value.trim() || '（清除）'}`)}
                      onKeyDown={(e) => isEnterKey(e) && e.currentTarget.blur()}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="arrears-labels">{used.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        {groups.length > 0 && (
          <>
            <h3 className="sub-title">月報上的逾期科目</h3>
            <table className="compact-inputs status-table">
              <thead><tr><th>報表科目</th><th className="num">筆數</th><th className="num">金額</th><th>相同科目</th></tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.label}>
                    <td>{g.label}</td>
                    <td className="num">{g.count}</td>
                    <td className="num"><Money value={g.amount} /></td>
                    <td>
                      <label className="check inline">
                        <input type="checkbox" checked={g.merged} onChange={(e) => setMerge(g.label, e.target.checked)} /> 合併成一筆
                      </label>
                      {!g.merged && g.count > 1 && <span className="muted small">　月報逐筆列出 {g.count} 筆</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Section>
    </section>
  );
});

export default ArrearsPanel;
