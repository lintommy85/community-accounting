import { useEffect, useMemo, useState } from 'react';
import { appTitle } from './lib/defaults';
import { todayStr } from './lib/dates';
import { depositGroups } from './lib/ledger';
import { useStore } from './store';
import Dashboard from './pages/Dashboard';
import ImportPage from './pages/ImportPage';
import PaymentsPage from './pages/PaymentsPage';
import DepositsPage from './pages/DepositsPage';
import MonthReportPage from './pages/MonthReportPage';
import ArrearsPage from './pages/ArrearsPage';
import StatementPage from './pages/StatementPage';
import AccountsPage from './pages/AccountsPage';
import PettyCashPage from './pages/PettyCashPage';
import UnitsPage from './pages/UnitsPage';
import LedgerPage from './pages/LedgerPage';
import SettingsPage from './pages/SettingsPage';
import BackupPage from './pages/BackupPage';
import RenovationPage from './pages/RenovationPage';
import FileBanner from './components/FileBanner';
import GuideTour, { GUIDE_VERSION } from './components/GuideTour';
import { Go, NavArgContext } from './components/nav';
import { Icon, IconName } from './components/icons';

const PAGES = [
  { key: 'home', label: '總覽', desc: '本月收支、在途存款與待辦事項', el: Dashboard, icon: 'home', group: '' },
  { key: 'ledger', label: '收支記帳', desc: '登錄管理費以外的收入與支出', el: LedgerPage, icon: 'book', group: '日常記帳' },
  { key: 'petty', label: '零用金', desc: '零用金收支與每月撥補', el: PettyCashPage, icon: 'wallet', group: '日常記帳' },
  { key: 'renovation', label: '裝潢保證金', desc: '各戶裝潢保證金的收款、費率方案與結算退款', el: RenovationPage, icon: 'hammer', group: '日常記帳' },
  { key: 'accounts', label: '帳戶與轉帳', desc: '各帳戶餘額、變動紀錄與帳戶間轉帳', el: AccountsPage, icon: 'bank', group: '日常記帳' },
  { key: 'import', label: '匯入智生活報表', desc: '匯入每月應繳報表與管理費入帳報表', el: ImportPage, icon: 'upload', group: '管理費' },
  { key: 'payments', label: '繳費紀錄', desc: '住戶每一筆繳費與銷帳月份', el: PaymentsPage, icon: 'receipt', group: '管理費' },
  { key: 'deposits', label: '撥款對帳', desc: '拿存摺核對智生活撥入銀行的款項', el: DepositsPage, icon: 'check', group: '管理費' },
  { key: 'arrears', label: '欠費／銷帳', desc: '各戶逐月應繳、已銷與未繳', el: ArrearsPage, icon: 'alert', group: '管理費' },
  { key: 'month', label: '月結／在途存款', desc: '檢查當月帳務、匯出報表並結帳鎖定', el: MonthReportPage, icon: 'calendar', group: '報表' },
  { key: 'statement', label: '收支報表', desc: '月報、年報與列印簽核', el: StatementPage, icon: 'chart', group: '報表' },
  { key: 'units', label: '戶別與月費', desc: '每月應繳、基準費率與期初預收款', el: UnitsPage, icon: 'building', group: '設定' },
  { key: 'settings', label: '基本設定', desc: '社區資料、銀行帳戶、科目與簽章欄', el: SettingsPage, icon: 'settings', group: '設定' },
  { key: 'backup', label: '備份與還原', desc: '下載備份、還原資料與匯入紀錄', el: BackupPage, icon: 'archive', group: '設定' },
] as const satisfies readonly { key: string; label: string; desc: string; icon: IconName; group: string; el: unknown }[];

export type PageKey = (typeof PAGES)[number]['key'];

const COLLAPSE_KEY = 'ledger-sidebar-collapsed';

/** 側欄是否收合：記在這台電腦的瀏覽器裡；沒有紀錄時，視窗太窄就先收合。 */
function initialCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(COLLAPSE_KEY);
    if (saved !== null) return saved === '1';
  } catch {
    // 無法使用 localStorage 時依視窗寬度決定
  }
  return window.innerWidth < 1024;
}

interface Tip {
  text: string;
  top: number;
  left: number;
}

export default function App() {
  const { data, ready, lastSavedAt, saveError, update, service, shutdown, stopped } = useStore();
  const [guide, setGuide] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [page, setPage] = useState<PageKey>('home');
  const [navArg, setNavArg] = useState('');
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [tip, setTip] = useState<Tip | null>(null);
  const go: Go = (p, arg = '') => {
    setPage(p);
    setNavArg(arg);
  };
  const { communityName, logo, theme } = data.settings;
  const dark = theme !== 'light';
  const today = todayStr();
  // 側欄徽章：已到預計撥款日、但還沒拿存摺核對的撥款筆數
  const overdueDeposits = useMemo(() => depositGroups(data.payments).filter((g) => g.depositDate <= today && !g.confirmed).length, [data.payments, today]);
  const badges: Partial<Record<PageKey, { count: number; text: string }>> = { deposits: { count: overdueDeposits, text: '筆撥款還沒核對存摺' } };

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    document.title = appTitle({ communityName });
  }, [communityName]);

  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!logo) return link?.remove();
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = logo;
  }, [logo]);

  useEffect(() => {
    if (ready && (data.settings.guideSeen ?? 0) < GUIDE_VERSION) setGuide(true);
  }, [ready]);

  // 應用程式視窗（Windows 以 Edge／Chrome 應用程式模式開啟）在結束系統後自動關閉；一般瀏覽器分頁關不掉就留著提示
  useEffect(() => {
    if (!stopped) return;
    const t = setTimeout(() => window.close(), 1500);
    return () => clearTimeout(t);
  }, [stopped]);

  useEffect(() => {
    const open = () => setGuide(true);
    window.addEventListener('ledger:guide', open);
    return () => window.removeEventListener('ledger:guide', open);
  }, []);

  function closeGuide() {
    setGuide(false);
    if ((data.settings.guideSeen ?? 0) < GUIDE_VERSION) update((d) => ({ ...d, settings: { ...d.settings, guideSeen: GUIDE_VERSION } }), '看完使用說明動畫');
  }

  async function stopSystem() {
    if (!confirm('結束系統？資料會先存好，之後要使用請再執行「社區帳務管理.exe」。')) return;
    setStopping(true);
    try {
      await shutdown();
    } catch (e) {
      setStopping(false);
      alert(`無法結束系統：${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function toggleSidebar() {
    const next = !collapsed;
    setTip(null);
    setCollapsed(next);
    // 只有自己按過才記住；沒按過時每次依視窗寬度決定
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      // 記不住也沒關係
    }
  }

  /** 側欄收合成只剩圖示時，滑鼠移上去（或用鍵盤移到）在右邊顯示名稱。 */
  const tipProps = (text: string) => {
    if (!collapsed) return {};
    const show = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setTip({ text, top: r.top + r.height / 2, left: r.right + 12 });
    };
    return {
      onMouseEnter: (e: { currentTarget: HTMLElement }) => show(e.currentTarget),
      onMouseLeave: () => setTip(null),
      onFocus: (e: { currentTarget: HTMLElement }) => show(e.currentTarget),
      onBlur: () => setTip(null),
    };
  };

  if (!ready) return <div className="loading">載入中…</div>;
  if (stopped) {
    return (
      <div className="stopped-screen">
        <div className="stopped-card">
          <span className="stopped-icon"><Icon name="power" /></span>
          <h1>系統已結束</h1>
          <p className="hint">資料已儲存，視窗會自動關閉；沒有關閉的話請直接關掉這個視窗。要再使用請執行「社區帳務管理.exe」。</p>
        </div>
      </div>
    );
  }
  const current = PAGES.find((p) => p.key === page)!;
  const Current = current.el;
  return (
    <div className={collapsed ? 'layout collapsed' : 'layout'}>
      <nav className="sidebar" aria-label="功能選單">
        <div className="brand">
          {logo ? <img className="brand-logo" src={logo} alt="" /> : <span className="brand-mark"><Icon name="building" /></span>}
          <div className="brand-text">
            <div className="brand-title">{communityName || '社區帳務管理'}</div>
            <div className="brand-sub">{communityName ? '帳務管理系統' : '尚未設定社區名稱'}</div>
          </div>
          <button className="side-toggle" onClick={toggleSidebar} aria-label={collapsed ? '展開選單' : '收合選單'} aria-expanded={!collapsed} {...tipProps('展開選單')}>
            <Icon name={collapsed ? 'panelOpen' : 'panelClose'} />
          </button>
        </div>
        <div className="nav-list">
          {PAGES.map((p, i) => {
            const badge = badges[p.key];
            const count = badge?.count ?? 0;
            return (
              <div key={p.key} className="nav-item">
                {p.group && p.group !== PAGES[i - 1]?.group && <div className="nav-group">{p.group}</div>}
                <button
                  className={page === p.key ? 'nav active' : 'nav'}
                  onClick={() => go(p.key)}
                  aria-label={count ? `${p.label}，${count} ${badge!.text}` : p.label}
                  aria-current={page === p.key ? 'page' : undefined}
                  {...tipProps(count ? `${p.label}（${count} ${badge!.text}）` : p.label)}
                >
                  <Icon name={p.icon} />
                  <span className="nav-label">{p.label}</span>
                  {count > 0 && <span className="nav-badge" title={collapsed ? undefined : `${count} ${badge!.text}`}>{count > 99 ? '99+' : count}</span>}
                </button>
              </div>
            );
          })}
        </div>
        {service && (
          <div className="side-foot">
            <button className="shutdown" disabled={stopping} onClick={stopSystem} aria-label="結束系統" {...tipProps('結束系統')}>
              <span className="shutdown-tile">{stopping ? <span className="spinner" /> : <Icon name="power" />}</span>
              <span className="shutdown-text">
                <strong>{stopping ? '正在結束…' : '結束系統'}</strong>
                <small>存好資料後關閉視窗</small>
              </span>
            </button>
          </div>
        )}
      </nav>
      <main className="main">
        <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-icon"><Icon name={current.icon} /></span>
            <div>
              <h1>{current.label}</h1>
              <p className="topbar-sub">{current.desc}</p>
            </div>
          </div>
          <div className="topbar-right">
            <div className={saveError ? 'save-state failed' : 'save-state'}>
              {saveError ? <span className="err">儲存失敗：{saveError}</span> : lastSavedAt ? <><span className="dot" /> 已儲存 {lastSavedAt}</> : ''}
            </div>
            <div className="theme-switch" role="group" aria-label="畫面配色">
              <button className={dark ? '' : 'on'} onClick={() => dark && update((d) => ({ ...d, settings: { ...d.settings, theme: 'light' } }), '切換畫面配色', '淺色')}><Icon name="sun" />淺色</button>
              <button className={dark ? 'on' : ''} onClick={() => !dark && update((d) => ({ ...d, settings: { ...d.settings, theme: 'dark' } }), '切換畫面配色', '深色')}><Icon name="moon" />深色</button>
            </div>
          </div>
        </header>
        <FileBanner onGo={go} />
        <NavArgContext.Provider value={navArg}>
          <Current key={`${page}:${navArg}`} go={go} />
        </NavArgContext.Provider>
      </main>
      {tip && <div className="nav-tip" role="tooltip" style={{ top: tip.top, left: tip.left }}>{tip.text}</div>}
      {guide && <GuideTour onClose={closeGuide} />}
    </div>
  );
}
