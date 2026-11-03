import type { PageKey } from '../App';
import { useStore } from '../store';

export default function FileBanner({ onGo }: { onGo: (p: PageKey) => void }) {
  const { fileStatus, fileName, reconnectFile, saveError } = useStore();
  if (fileStatus === 'service') {
    return saveError ? <div className="banner err">{saveError}</div> : null;
  }
  if (fileStatus === 'linked') return null;
  if (fileStatus === 'needPermission') {
    return (
      <div className="banner warn">
        資料檔「{fileName}」需要重新授權才能自動存檔。
        <button onClick={() => reconnectFile()}>授權並連結</button>
      </div>
    );
  }
  if (fileStatus === 'error') {
    return (
      <div className="banner err">
        無法讀取資料檔「{fileName}」，可能已被移動或刪除。<button onClick={() => onGo('backup')}>前往備份與還原</button>
      </div>
    );
  }
  return (
    <div className="banner">
      {fileStatus === 'unsupported'
        ? '目前瀏覽器不支援自動存檔到檔案，資料只存在瀏覽器內，請定期下載備份（建議使用 Edge 或 Chrome）。'
        : '資料目前只存在瀏覽器內。建議建立「資料檔」，之後每次修改都會自動存到檔案，換電腦時複製這個檔案即可。'}
      <button onClick={() => onGo('backup')}>設定資料檔／備份</button>
    </div>
  );
}
