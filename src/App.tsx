import { useEffect, useState } from 'react';
import { appTitle } from './lib/defaults';
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
import FileBanner from './components/FileBanner';
import GuideTour, { GUIDE_VERSION } from './components/GuideTour';
import { Go, NavArgContext } from './components/nav';
import { Icon, IconName } from './components/icons';

const PAGES = [
  { key: 'home', label: '總覽', el: Dashboard, icon: 'home', group: '' },
  { key: 'ledger', label: '收支記帳', el: LedgerPage, icon: 'book', group: '日常記帳' },
  { key: 'petty', label: '零用金', el: PettyCashPage, icon: 'wallet', group: '日常記帳' },
  { key: 'accounts', label: '帳戶與轉帳', el: AccountsPage, icon: 'bank', group: '日常記帳' },
  { key: 'import', label: '匯入智生活報表', el: ImportPage, icon: 'upload', group: '管理費' },
  { key: 'payments', label: '繳費紀錄', el: PaymentsPage, icon: 'receipt', group: '管理費' },
  { key: 'deposits', label: '撥款對帳', el: DepositsPage, icon: 'check', group: '管理費' },
  { key: 'arrears', label: '欠費／銷帳', el: ArrearsPage, icon: 'alert', group: '管理費' },
  { key: 'month', label: '月結／在途存款', el: MonthReportPage, icon: 'calendar', group: '報表' },
  { key: 'statement', label: '收支報表', el: StatementPage, icon: 'chart', group: '報表' },
  { key: 'units', label: '戶別與月費', el: UnitsPage, icon: 'building', group: '設定' },
  { key: 'settings', label: '基本設定', el: SettingsPage, icon: 'settings', group: '設定' },
  { key: 'backup', label: '備份與還原', el: BackupPage, icon: 'archive', group: '設定' },
] as const satisfies readonly { key: string; label: string; icon: IconName; group: string; el: unknown }[];

export type PageKey = (typeof PAGES)[number]['key'];

export default function App() {
  const { data, ready, lastSavedAt, saveError, update, service, shutdown, stopped } = useStore();
  const [guide, setGuide] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [page, setPage] = useState<PageKey>('home');
  const [navArg, setNavArg] = useState('');
  const go: Go = (p, arg = '') => {
    setPage(p);
    setNavArg(arg);
  };
  const { communityName, logo, theme } = data.settings;
  const dark = theme !== 'light';

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

  if (!ready) return <div className="loading">載入中…</div>;
  if (stopped) {
    return (
      <div className="stopped-screen">
        <div>
          <h1>系統已結束</h1>
          <p className="hint">資料已儲存，可以關閉這個分頁。要再使用請執行「社區帳務管理.exe」。</p>
        </div>
      </div>
    );
  }
  const current = PAGES.find((p) => p.key === page)!;
  const Current = current.el;
  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">
          {logo ? <img className="brand-logo" src={logo} alt="" /> : <span className="brand-mark"><Icon name="building" /></span>}
          <div>
            <div className="brand-title">{communityName || '社區帳務管理'}</div>
            <div className="brand-sub">{communityName ? '帳務管理系統' : '尚未設定社區名稱'}</div>
          </div>
        </div>
        {PAGES.map((p, i) => (
          <div key={p.key} className="nav-item">
            {p.group && p.group !== PAGES[i - 1]?.group && <div className="nav-group">{p.group}</div>}
            <button className={page === p.key ? 'nav active' : 'nav'} onClick={() => go(p.key)}>
              <Icon name={p.icon} />
              <span>{p.label}</span>
            </button>
          </div>
        ))}
        {service && <button className="shutdown" disabled={stopping} onClick={stopSystem}><Icon name="power" /><span>{stopping ? '正在結束…' : '結束系統'}</span></button>}
      </nav>
      <main className="main">
        <header className="topbar">
          <h1><Icon name={current.icon} /> {current.label}</h1>
          <div className="topbar-right">
            <div className="save-state">
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
      {guide && <GuideTour onClose={closeGuide} />}
    </div>
  );
}
