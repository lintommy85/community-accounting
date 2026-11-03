import type { Go } from './nav';
import { activeUnits, unitBaseline } from '../lib/fees';
import { useStore } from '../store';

/** 全新狀態（還沒有戶別或應繳）時的建立步驟，完成的步驟自動打勾。 */
export default function FirstSetupGuide({ go, here }: { go?: Go; here?: 'import' | 'units' }) {
  const { data } = useStore();
  const s = data.settings;
  const units = activeUnits(s.units);
  const steps: { title: string; text: string; done: boolean; action?: [string, () => void] }[] = [
    {
      title: '從智生活下載「管理費匯入範本」',
      text: '智生活後台 → 繳費單列表 → 匯出管理費匯入範本（Excel）。一戶一列，有戶別代碼、所有權人與各收費項目。',
      done: units.length > 0,
    },
    {
      title: '匯入範本，建立戶別與所有權人',
      text: '「匯入智生活報表 → 每月應繳報表」選擇檔案，下方會列出檔案內所有戶別：預設全部建立，不需要管理的戶別（例如管理室、公設）勾選「排除」，再按「建立戶別」。',
      done: units.length > 0,
      action: here === 'import' ? undefined : ['前往匯入', () => go?.('import', 'dues')],
    },
    {
      title: '設定基準與費率',
      text: '「戶別與月費 → 基準與費率」新增費率方案（例如坪數費依坪數、汽車位清潔費固定金額），勾選戶別套用方案、填坪數、加收清潔費、設定季繳／年繳。',
      done: units.some((u) => unitBaseline(u, s.feePlans) > 0),
      action: here === 'units' ? undefined : ['前往基準與費率', () => go?.('units', 'units')],
    },
    {
      title: '再匯入同一份範本，建立每月應繳',
      text: '帳單項目對應到基準後，和基準不同的逐戶選「更新基準」或「不更新」，確認匯入就會建立每月應繳。之後每個月都只做這一步。',
      done: data.dues.length > 0,
      action: here === 'import' ? undefined : ['前往匯入', () => go?.('import', 'dues')],
    },
    {
      title: '確認總戶數與帳務起始月',
      text: '「基本設定 → 戶數與銷帳」確認總戶數（用來檢查戶別有沒有漏）與帳務起始月（之前的月份不銷帳）。',
      done: !!s.totalUnits && !!s.billingStartMonth,
      action: ['前往基本設定', () => go?.('settings')],
    },
  ];
  const next = steps.findIndex((x) => !x.done);
  const nextAction = steps.findIndex((x) => !x.done && x.action);
  return (
    <section className="setup-guide">
      <h3>{units.length ? '還有幾個步驟就能開始每月作業' : '目前沒有任何戶別，請依下列步驟建立資料'}</h3>
      <ol>
        {steps.map((x, i) => (
          <li key={x.title} className={x.done ? 'done' : i === next ? 'current' : ''}>
            <span className="mark">{x.done ? '✓' : i + 1}</span>
            <div>
              <strong>{x.title}</strong>
              <p>{x.text}</p>
            </div>
            {go && x.action && !x.done && <button className={i === nextAction ? 'primary' : ''} onClick={x.action[1]}>{x.action[0]}</button>}
          </li>
        ))}
      </ol>
      <p className="hint">沒有智生活範本時，也可以在「戶別與月費 → 基準與費率」最下方逐戶「新增戶別」；所有權人點表格內的名字設定。</p>
    </section>
  );
}
