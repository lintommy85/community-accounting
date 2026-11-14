import { localDateTime } from '../lib/dates';
import { DueInfo, dueText } from '../lib/registry';
import { TrackRecord } from '../lib/types';

/** 到期狀態標籤：過期紅色、快到期黃色。 */
export function DueTag({ due }: { due: DueInfo }) {
  if (due.state === 'unset') return <span className="tag">未設定</span>;
  const cls = due.state === 'overdue' ? 'tag danger' : due.state === 'soon' ? 'tag warn' : 'tag ok';
  return <span className={cls}>{dueText(due)}</span>;
}

/** 修改紀錄：每次儲存時的到期日（或申報月份）、內容與修改時間；可以逐筆刪除。 */
export function HistoryTable({ records, valueLabel, onDelete }: { records: TrackRecord[]; valueLabel: string; onDelete: (id: string) => void }) {
  if (!records.length) return <p className="empty">還沒有修改紀錄。</p>;
  return (
    <div className="table-wrap">
      <table className="history-table">
        <thead><tr><th>{valueLabel}</th><th>內容</th><th>修改時間</th><th></th></tr></thead>
        <tbody>
          {records.map((r, i) => (
            <tr key={r.id}>
              <td>{r.value || '未填'}{i === 0 && <span className="tag info">最近一次</span>}</td>
              <td className="note-cell wide-note">{r.detail}</td>
              <td>{localDateTime(r.at)}</td>
              <td><button className="link danger" onClick={() => confirm(`刪除這筆修改紀錄（${r.value || '未填'}，${localDateTime(r.at)}）？`) && onDelete(r.id)}>刪除</button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
