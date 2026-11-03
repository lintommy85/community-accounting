import { CSSProperties, ReactNode, useEffect, useState } from 'react';

/** 使用說明動畫的版本；內容大改時加 1，使用者下次開啟會再播放一次。 */
export const GUIDE_VERSION = 1;

/** 從任何頁面重新播放使用說明動畫。 */
export const openGuide = () => window.dispatchEvent(new Event('ledger:guide'));

const d = (sec: number) => ({ '--d': `${sec}s` }) as CSSProperties;

interface Step {
  title: string;
  text: ReactNode;
  scene: ReactNode;
}

const STEPS: Step[] = [
  {
    title: '歡迎使用社區帳務管理',
    text: <>所有資料都存在這台電腦的 <b>data 資料夾</b>，不會上傳網路。左邊選單由上到下，大致就是每個月的工作順序。</>,
    scene: (
      <div className="g-scene g-welcome">
        <div className="g-house g-pop" style={d(0)}>
          <span className="g-roof" />
          <span className="g-body">管委會</span>
        </div>
        <div className="g-arrow g-fade" style={d(0.5)}>→</div>
        <div className="g-folder g-pop" style={d(0.8)}>
          <span className="g-tab" />data
          <div className="g-file g-drop" style={d(1.3)}>ledger.json</div>
        </div>
      </div>
    ),
  },
  {
    title: '設定基準與費率',
    text: <>到「戶別與月費 → 基準與費率」建立費率方案（例如坪數費、汽車位清潔費），每戶套用方案、加收清潔費。<b>基準只在匯入報表時拿來比對</b>，調整費率不會影響已匯入的月份。</>,
    scene: (
      <div className="g-scene g-plans">
        {['坪數費 2,670', '汽車位清潔費 500', '機車位清潔費 100'].map((t, i) => (
          <div key={t} className="g-chip g-fly" style={{ ...d(0.3 + i * 0.5), '--y': `${i * 44}px` } as CSSProperties}>{t}</div>
        ))}
        <div className="g-unit g-pop" style={d(0)}>
          <div className="g-unit-title">A03-11 戶</div>
          <div className="g-unit-total g-fade" style={d(2)}>每月基準 3,270</div>
        </div>
      </div>
    ),
  },
  {
    title: '匯入每月應繳報表',
    text: <>從智生活系統下載「管理費匯入範本」，到「匯入智生活報表 → 每月應繳報表」匯入。帳單項目要先<b>對應到基準</b>；和基準不同的逐戶列出，選好「更新基準」或「不更新」才能匯入。</>,
    scene: (
      <div className="g-scene g-bill">
        <div className="g-xlsx g-drop" style={d(0)}>智生活<br />管理費範本.xlsx</div>
        <div className="g-map">
          {[['11月坪數費', '坪數費'], ['11月汽車位清潔費', '汽車位清潔費'], ['10月未繳管理費', '逾期']].map(([a, b], i) => (
            <div key={a} className="g-map-row g-slide" style={d(0.6 + i * 0.45)}>
              <span>{a}</span><span className="g-link">→</span><span className="g-ok">{b}</span>
            </div>
          ))}
          <div className="g-check g-pop" style={d(2.2)}>✓ 對應完成，可以匯入</div>
        </div>
      </div>
    ),
  },
  {
    title: '匯入入帳報表，自動銷帳',
    text: <>從智生活下載「管理費入帳報表」匯入，系統依期別自動銷帳；金額和帳單不同會請你確認要銷哪個月。月底前還沒撥入銀行的款項，自動列為<b>在途存款</b>。</>,
    scene: (
      <div className="g-scene g-pay">
        {['3,270', '3,397', '6,540'].map((t, i) => (
          <div key={t} className="g-coin g-fly-down" style={{ ...d(0.2 + i * 0.5), '--x': `${i * 90}px` } as CSSProperties}>{t}</div>
        ))}
        <div className="g-months">
          {['1月', '2月', '在途'].map((m, i) => (
            <div key={m} className={`g-month g-pop ${m === '在途' ? 'transit' : ''}`} style={d(1.4 + i * 0.3)}>{m}<span>{m === '在途' ? '下月入帳' : '✓ 銷帳'}</span></div>
          ))}
        </div>
      </div>
    ),
  },
  {
    title: '收支記帳與零用金',
    text: <>利息、修繕等其他收支在「收支記帳」登錄；零用金逐筆記在「零用金」，每月一鍵產生「零用金撥補」，收支表只會出現撥補這一筆。</>,
    scene: (
      <div className="g-scene g-ledger">
        {[['利息收入', '+128', 'in'], ['電梯保養', '−6,300', 'out'], ['零用金撥補', '−1,850', 'out'], ['停車位收入', '+4,000', 'in']].map(([a, b, c], i) => (
          <div key={a} className={`g-line g-slide ${c}`} style={d(0.2 + i * 0.4)}><span>{a}</span><b>{b}</b></div>
        ))}
      </div>
    ),
  },
  {
    title: '月結與報表列印',
    text: <>「月結／在途存款」檢查後按「結帳鎖定」；「收支報表」可列印彩色月報（財務收支總表）、收支報表與管理費銷帳，簽章欄可在基本設定自訂。</>,
    scene: (
      <div className="g-scene g-report">
        <div className="g-sheet g-pop" style={d(0)}>
          <div className="g-sheet-title">財務收支總表</div>
          <div className="g-bar in g-grow" style={{ ...d(0.5), '--w': '88%' } as CSSProperties}>收入</div>
          <div className="g-bar out g-grow" style={{ ...d(0.9), '--w': '62%' } as CSSProperties}>支出</div>
          <div className="g-bar net g-grow" style={{ ...d(1.3), '--w': '26%' } as CSSProperties}>結餘</div>
          <div className="g-sign g-fade" style={d(1.8)}><span>主委</span><span>財委</span><span>監委</span></div>
        </div>
      </div>
    ),
  },
  {
    title: '備份與結束系統',
    text: <>data 資料夾每天自動備份，換電腦時把整個資料夾帶走即可。系統在背景執行，<b>要結束時按左下角「結束系統」</b>；之後可在「基本設定」重新播放這段說明。</>,
    scene: (
      <div className="g-scene g-end">
        <div className="g-folder g-pop" style={d(0)}><span className="g-tab" />data</div>
        <div className="g-arrow g-fade" style={d(0.5)}>→</div>
        <div className="g-usb g-pop" style={d(0.8)}>備份</div>
        <div className="g-power g-pop" style={d(1.4)}>⏻<span>結束系統</span></div>
      </div>
    ),
  },
];

/** 第一次開啟時播放的使用說明動畫（逐頁介紹每月工作流程）。 */
export default function GuideTour({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => Math.min(STEPS.length - 1, x + 1));
      else if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1));
      else if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop guide-backdrop">
      <div className="modal guide" role="dialog" aria-label="使用說明">
        <div className="guide-stage" key={i}>{step.scene}</div>
        <div className="guide-body">
          <div className="guide-count">{i + 1}／{STEPS.length}</div>
          <h2 key={`t${i}`} className="g-fade" style={d(0)}>{step.title}</h2>
          <p key={`p${i}`} className="g-fade" style={d(0.15)}>{step.text}</p>
        </div>
        <div className="guide-dots">
          {STEPS.map((s, j) => <button key={s.title} className={j === i ? 'on' : ''} aria-label={`第 ${j + 1} 頁`} onClick={() => setI(j)} />)}
        </div>
        <div className="form-row guide-actions">
          <button className="link" onClick={onClose}>略過</button>
          <span style={{ flex: 1 }} />
          <button disabled={i === 0} onClick={() => setI(i - 1)}>上一步</button>
          {last ? <button className="primary" onClick={onClose}>開始使用</button> : <button className="primary" onClick={() => setI(i + 1)}>下一步</button>}
        </div>
      </div>
    </div>
  );
}
