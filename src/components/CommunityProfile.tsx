import { useEffect, useState } from 'react';
import { isEnterKey } from './ui';
import { loadImage, MAX_UPLOAD_BYTES, needsCrop, renderSquare } from '../lib/image';
import { useStore } from '../store';
import LogoCropper from './LogoCropper';

/** 社區名稱與圖示；removable 時才顯示「移除圖示」（只在基本設定）。 */
export default function CommunityProfile({ removable = false }: { removable?: boolean }) {
  const { data, update } = useStore();
  const s = data.settings;
  const [name, setName] = useState(s.communityName);
  const [cropImg, setCropImg] = useState<HTMLImageElement | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => setName(s.communityName), [s.communityName]);

  function commitName() {
    const v = name.trim();
    setName(v);
    if (v !== s.communityName) update((d) => ({ ...d, settings: { ...d.settings, communityName: v } }), '修改社區名稱', v);
  }

  const setLogo = (logo: string, action: string) => update((d) => ({ ...d, settings: { ...d.settings, logo } }), action, '');

  async function onFile(file: File | undefined) {
    setErr('');
    if (!file) return;
    if (!file.type.startsWith('image/')) return setErr('請選擇圖片檔（PNG、JPG、WebP…）');
    if (file.size > MAX_UPLOAD_BYTES) return setErr('圖片超過 15MB，請先縮小再上傳');
    try {
      const img = await loadImage(file);
      if (needsCrop(img.naturalWidth, img.naturalHeight)) setCropImg(img);
      else setLogo(renderSquare(img, { sx: 0, sy: 0, size: img.naturalWidth }), '設定社區圖示');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="profile">
      <label className="logo-slot" title={s.logo ? '點擊更換社區圖示' : '點擊上傳社區圖示'}>
        {s.logo ? <img src={s.logo} alt="社區圖示" /> : <span>上傳<br />社區圖示</span>}
        <input type="file" accept="image/*" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      <div className="profile-main">
        <input
          className="profile-name"
          value={name}
          placeholder="點這裡輸入社區名稱"
          aria-label="社區名稱"
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => isEnterKey(e) && e.currentTarget.blur()}
        />
        <div className="profile-hint">
          帳務管理系統
          {removable && s.logo && <button className="link danger" onClick={() => confirm('移除社區圖示？') && setLogo('', '移除社區圖示')}>移除圖示</button>}
        </div>
        {err && <div className="err">{err}</div>}
      </div>
      {cropImg && (
        <LogoCropper
          img={cropImg}
          onCancel={() => setCropImg(null)}
          onDone={(url) => {
            setLogo(url, '設定社區圖示');
            setCropImg(null);
          }}
        />
      )}
    </div>
  );
}
