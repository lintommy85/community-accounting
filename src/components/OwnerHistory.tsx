import { useState } from 'react';
import { ownerHistory, removeOwnerPeriod, renameOwnerPeriod, setOwnerFrom } from '../lib/owners';
import { Unit } from '../lib/types';
import { useStore } from '../store';
import { thisMonth } from './ui';

const SOURCE_LABEL = { import: '匯入', manual: '手動' } as const;

/** 所有權人紀錄：變更只影響生效月份與之後，之前的月份仍顯示原所有權人。 */
export default function OwnerHistory({ unit, onClose }: { unit: Unit; onClose: () => void }) {
  const { data, update } = useStore();
  const u = data.settings.units.find((x) => x.id === unit.id) ?? unit;
  const list = ownerHistory(u);
  const [month, setMonth] = useState(thisMonth());
  const [name, setName] = useState('');

  const save = (fn: (x: Unit) => Unit, action: string, detail: string) =>
    update((d) => ({ ...d, settings: { ...d.settings, units: d.settings.units.map((x) => (x.id === u.id ? fn(x) : x)) } }), action, `${u.unitNo} ${detail}`);

  function add() {
    if (!name.trim() || !month) return;
    save((x) => setOwnerFrom(x, month, name, 'manual'), '變更所有權人', `${month} 起 ${name.trim()}`);
    setName('');
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" role="dialog" aria-label="所有權人紀錄" onClick={(e) => e.stopPropagation()}>
        <h2>所有權人紀錄：{u.unitNo}</h2>
        <p className="hint">
          每一筆從「起始月份」開始，到下一筆之前；最早一筆也套用到更早的月份。所有權人變更只影響生效月份與之後，
          之前月份的銷帳明細、帳卡與報表仍顯示原所有權人。名字打錯直接修改即可（不算變更）。
        </p>
        {list.length === 0 ? <p className="empty">還沒有所有權人，請在下方新增。</p> : (
          <table className="compact-inputs owner-history">
            <thead><tr><th>起始月份</th><th>所有權人</th><th>來源</th><th></th></tr></thead>
            <tbody>
              {list.map((p, i) => (
                <tr key={p.from || 'first'}>
                  <td>{p.from ? `${p.from} 起` : '最早'}{i === list.length - 1 && <span className="tag ok">目前</span>}</td>
                  <td>
                    <input defaultValue={p.owner} key={`${p.from}${p.owner}`} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== p.owner && save((x) => renameOwnerPeriod(x, p.from, e.target.value), '修正所有權人名稱', `${p.from || '最早'} ${e.target.value.trim()}`)} />
                  </td>
                  <td className="muted">{p.source ? SOURCE_LABEL[p.source] : ''}{p.at ? ` ${p.at.slice(0, 10)}` : ''}</td>
                  <td>{i > 0 && <button className="link danger" onClick={() => confirm(`刪除 ${p.from} 起的「${p.owner}」？這段期間會改回前一位所有權人。`) && save((x) => removeOwnerPeriod(x, p.from), '刪除所有權人變更', `${p.from} ${p.owner}`)}>刪除</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="form-row">
          <label>生效月份 <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
          <label>新所有權人 <input value={name} placeholder="例如 王小明" onChange={(e) => setName(e.target.value)} /></label>
          <button className="primary" disabled={!name.trim() || !month} onClick={add}>{list.length ? '新增變更' : '設定所有權人'}</button>
        </div>
        <div className="form-row modal-actions">
          <button onClick={onClose}>關閉</button>
        </div>
      </div>
    </div>
  );
}
