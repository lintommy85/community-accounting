import { useEffect, useState } from 'react';
import { FileDrop, Section } from '../components/ui';
import { Icon } from '../components/icons';
import { emptyData } from '../lib/defaults';
import { backupFileName, downloadBlob, listServiceBackups, normalizeData, openServiceDataDir, toBackupJson } from '../lib/storage';
import { exportAllToExcel } from '../lib/xlsxio';
import { useStore } from '../store';

export default function BackupPage() {
  const store = useStore();
  const { data, update, replaceAll, fileStatus, fileName, service } = store;
  const [msg, setMsg] = useState('');
  const run = (fn: () => Promise<void>) => fn().catch((e) => e?.name !== 'AbortError' && setMsg(`失敗：${e?.message ?? e}`));

  function downloadBackup() {
    downloadBlob(new Blob([toBackupJson(data)], { type: 'application/json' }), backupFileName(data));
    update((d) => d, '下載備份', `繳費 ${data.payments.length} 筆`);
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    try {
      const restored = normalizeData(JSON.parse(await file.text()));
      const ok = confirm(
        `確定用備份檔「${file.name}」覆蓋目前資料？\n\n備份內容：社區「${restored.settings.communityName}」、繳費 ${restored.payments.length} 筆、分錄 ${restored.entries.length} 筆、最後修改 ${restored.updatedAt.slice(0, 16).replace('T', ' ')}\n目前資料：繳費 ${data.payments.length} 筆、分錄 ${data.entries.length} 筆\n\n建議先下載目前資料的備份。`,
      );
      if (!ok) return;
      replaceAll(restored, '還原備份');
      setMsg(`已還原備份「${file.name}」。`);
    } catch (e) {
      setMsg(`還原失敗：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function removeBatch(batchId: string, label: string) {
    const n = data.payments.filter((p) => p.batchId === batchId).length;
    if (!confirm(`刪除「${label}」匯入的 ${n} 筆繳費紀錄？（已結帳月份的紀錄不會刪除）`)) return;
    update(
      (d) => ({
        ...d,
        payments: d.payments.filter((p) => p.batchId !== batchId || d.closes.some((c) => p.paidDate.startsWith(c.month))),
        batches: d.batches.filter((b) => b.id !== batchId),
      }),
      '刪除匯入批次',
      label,
    );
  }

  function wipe() {
    if (prompt('這會清除所有資料與設定。請先下載備份。\n確定要清除請輸入「清除」：') !== '清除') return;
    replaceAll(emptyData(), '清除全部資料');
  }

  return (
    <>
      <h1>備份與還原</h1>
      {msg && <div className="banner">{msg}</div>}
      {service ? <ServiceDataSection /> : (
      <Section title="資料檔（自動存檔）">
        <p className="hint">
          連結資料檔後，每次修改都會自動寫入這個 .json 檔。建議存放在 OneDrive／Google 雲端硬碟同步資料夾或隨身碟。
          <strong>建議改用「社區帳務管理.exe」開啟系統，資料會自動存在程式旁的 data 資料夾。</strong>
        </p>
        {fileStatus === 'unsupported' ? (
          <p className="err">此瀏覽器不支援自動存檔到檔案，請改用 Microsoft Edge 或 Google Chrome，或定期使用下方「下載完整備份」。</p>
        ) : (
          <div className="form-row">
            <span>目前狀態：{fileStatus === 'linked' ? `已連結「${fileName}」` : fileStatus === 'needPermission' ? `「${fileName}」等待授權` : '未連結'}</span>
            {fileStatus === 'needPermission' && <button onClick={() => run(store.reconnectFile)}>授權</button>}
            <button className="primary" onClick={() => run(store.linkNewFile)}>建立新資料檔</button>
            <button onClick={() => run(store.linkExistingFile)}>開啟既有資料檔</button>
            {fileStatus !== 'none' && <button onClick={() => run(store.unlinkFile)}>取消連結</button>}
          </div>
        )}
      </Section>
      )}

      <Section title="備份">
        <div className="form-row">
          <button className="primary" onClick={downloadBackup}><Icon name="download" />下載完整備份（.json，可還原）</button>
          <button onClick={() => downloadBlob(exportAllToExcel(data), backupFileName(data, 'xlsx'))}><Icon name="download" />匯出全部資料為 Excel（交接／查閱用）</button>
        </div>
        <p className="hint">完整備份包含所有繳費紀錄、收支分錄、戶別、帳戶、通路規則、欄位對應、月結紀錄與操作紀錄。建議每次月結後下載一份，並另存到隨身碟或雲端。</p>
      </Section>

      <Section title="還原">
        <FileDrop title="選擇備份檔或資料檔來還原" hint="副檔名是 .json，也可以把檔案拖曳到這裡" accept=".json" onFile={restore} />
      </Section>

      <Section title="匯入紀錄">
        {data.batches.length === 0 ? <p className="empty">尚未匯入。</p> : (
          <table>
            <thead><tr><th>時間</th><th>檔名</th><th>工作表</th><th className="num">新增</th><th className="num">重複</th><th className="num">略過</th><th></th></tr></thead>
            <tbody>
              {[...data.batches].reverse().map((b) => (
                <tr key={b.id}>
                  <td>{new Date(b.importedAt).toLocaleString('zh-TW')}</td><td>{b.fileName}</td><td>{b.sheetName}</td>
                  <td className="num">{b.added}</td><td className="num">{b.duplicates}</td><td className="num">{b.skipped}</td>
                  <td><button className="link danger" onClick={() => removeBatch(b.id, b.fileName)}>刪除此批</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="操作紀錄（最近 200 筆）">
        <div className="table-wrap short">
          <table>
            <tbody>
              {data.audit.slice(-200).reverse().map((a, i) => (
                <tr key={i}><td>{new Date(a.at).toLocaleString('zh-TW')}</td><td>{a.action}</td><td>{a.detail}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="危險區">
        <button className="danger" onClick={wipe}>清除全部資料</button>
      </Section>
    </>
  );
}

function ServiceDataSection() {
  const { service, lastSavedAt, saveError } = useStore();
  const [backups, setBackups] = useState<{ name: string; size: number; modified: string }[] | null>(null);
  useEffect(() => {
    listServiceBackups().then(setBackups).catch(() => setBackups([]));
  }, [lastSavedAt]);
  if (!service) return null;
  return (
    <Section title="資料儲存位置（自動存檔）" actions={<button onClick={() => openServiceDataDir()}>開啟資料夾</button>}>
      <table className="kv">
        <tbody>
          <tr><th>資料檔</th><td><code>{service.dataFile}</code></td></tr>
          <tr><th>每日備份</th><td><code>{service.dataDir}{service.dataDir.includes('\\') ? '\\' : '/'}backups</code>（每天第一次存檔前保留前一版，最多 60 份；目前 {backups?.length ?? service.backups} 份）</td></tr>
          <tr><th>存檔狀態</th><td>{saveError ? <span className="err">{saveError}</span> : lastSavedAt ? `已儲存 ${lastSavedAt}` : '每次修改後自動儲存'}</td></tr>
          <tr><th>程式版本</th><td>{service.version}</td></tr>
        </tbody>
      </table>
      <p className="hint">
        每次修改都會自動存到 data 資料夾。<strong>換電腦時，把整個「社區帳務管理」資料夾（含 data）壓縮帶走</strong>，在新電腦解壓縮後執行「社區帳務管理.exe」即可。
        更新新版本時，把新版壓縮檔解壓縮到同一個資料夾覆蓋程式即可，新版壓縮檔不含 data 資料夾，不會蓋掉資料。
      </p>
      {backups && backups.length > 0 && (
        <details>
          <summary>最近的每日備份（{backups.length}）</summary>
          <ul className="backup-list">
            {backups.slice(0, 10).map((b) => <li key={b.name}>{b.name}　{(b.size / 1024).toFixed(0)} KB　{new Date(b.modified).toLocaleString('zh-TW')}</li>)}
          </ul>
          <p className="hint">要回到某一天的資料：在「還原」選擇 data\backups 裡的檔案即可。</p>
        </details>
      )}
    </Section>
  );
}
