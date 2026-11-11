import { defaultAccounts, defaultSettings, emptyData, fileBase, presetFilings, withPettyOther } from './defaults';
import { AppData, SCHEMA_VERSION } from './types';

const DB_NAME = 'community-accounting';
const STORE = 'kv';
export const BACKUP_MARKER = 'community-accounting-backup';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kv<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export const idbGet = <T>(key: string) => kv<T | undefined>('readonly', (s) => s.get(key));
export const idbSet = (key: string, value: unknown) => kv<void>('readwrite', (s) => s.put(value, key));
export const idbDel = (key: string) => kv<void>('readwrite', (s) => s.delete(key));

/** 補齊舊版資料缺少的欄位，讓不同版本的備份檔都能還原。 */
export function normalizeData(raw: unknown): AppData {
  const src = (raw && typeof raw === 'object' && 'data' in (raw as object) && (raw as { app?: string }).app === BACKUP_MARKER
    ? (raw as { data: unknown }).data
    : raw) as Partial<AppData> | null;
  if (!src || typeof src !== 'object' || !('settings' in src) || !Array.isArray(src.payments)) {
    throw new Error('檔案格式不正確，不是本系統的資料或備份檔。');
  }
  const base = emptyData();
  const settings = { ...defaultSettings(), ...src.settings };
  if (!settings.accounts?.length) settings.accounts = defaultAccounts();
  settings.pettyCategories = withPettyOther(settings.pettyCategories ?? []);
  settings.accounts = settings.accounts.map((a) => ({ ...a, accountNo: a.accountNo ?? '', excludeTransfer: a.excludeTransfer ?? a.kind === 'cash' }));
  return {
    ...base,
    ...src,
    schemaVersion: SCHEMA_VERSION,
    settings,
    // 舊版會依撥款規則預估入帳日；現在入帳日只採用報表，未經報表或存摺確認的預估日期一律清除
    payments: (src.payments ?? []).map((p) =>
      p.depositDate && !p.reportDepositDate && !p.depositConfirmed && p.batchId !== 'manual' ? { ...p, depositDate: '' } : p,
    ),
    dues: src.dues ?? [],
    pettyCash: src.pettyCash ?? [],
    batches: src.batches ?? [],
    entries: src.entries ?? [],
    closes: src.closes ?? [],
    audit: src.audit ?? [],
    renovations: src.renovations ?? [],
    renovationOpenings: src.renovationOpenings ?? [],
    arrearsLabels: src.arrearsLabels ?? {},
    contracts: src.contracts ?? [],
    assets: src.assets ?? [],
    filings: src.filings ?? presetFilings(),
  };
}

export function toBackupJson(data: AppData): string {
  return JSON.stringify({ app: BACKUP_MARKER, exportedAt: new Date().toISOString(), data }, null, 1);
}

export async function loadLocal(): Promise<AppData | null> {
  const raw = await idbGet<AppData>('data');
  return raw ? normalizeData(raw) : null;
}

export const saveLocal = (data: AppData) => idbSet('data', data);

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function backupFileName(data: AppData, ext = 'json'): string {
  const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  return `${fileBase(data.settings)}-帳務備份-${stamp}.${ext}`;
}

type Handle = FileSystemFileHandle & {
  queryPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (o: { mode: 'readwrite' }) => Promise<PermissionState>;
};

type PickerWindow = Window & {
  showSaveFilePicker?: (o: unknown) => Promise<Handle>;
  showOpenFilePicker?: (o: unknown) => Promise<Handle[]>;
};

const JSON_TYPES = [{ description: '社區帳務資料檔', accept: { 'application/json': ['.json'] } }];

export const fileApiSupported = () => typeof (window as PickerWindow).showSaveFilePicker === 'function';

export async function getLinkedHandle(): Promise<Handle | undefined> {
  try {
    return await idbGet<Handle>('fileHandle');
  } catch {
    return undefined;
  }
}

export async function ensurePermission(h: Handle, request: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if ((await h.queryPermission?.(opts)) === 'granted') return true;
  if (!request) return false;
  return (await h.requestPermission?.(opts)) === 'granted';
}

export async function writeHandle(h: Handle, data: AppData) {
  const w = await h.createWritable();
  await w.write(toBackupJson(data));
  await w.close();
}

export async function createDataFile(data: AppData): Promise<Handle> {
  const h = await (window as PickerWindow).showSaveFilePicker!({
    suggestedName: `${fileBase(data.settings)}-帳務資料.json`,
    types: JSON_TYPES,
  });
  await writeHandle(h, data);
  await idbSet('fileHandle', h);
  return h;
}

export async function openDataFile(): Promise<{ handle: Handle; data: AppData }> {
  const [h] = await (window as PickerWindow).showOpenFilePicker!({ types: JSON_TYPES });
  const data = normalizeData(JSON.parse(await (await h.getFile()).text()));
  await idbSet('fileHandle', h);
  return { handle: h, data };
}

export const unlinkDataFile = () => idbDel('fileHandle');

export interface ServiceInfo {
  app: string;
  version: string;
  dataDir: string;
  dataFile: string;
  hasData: boolean;
  backups: number;
}

const SERVICE_HEADERS = { 'X-Ledger-Client': '1' };

/** 透過「社區帳務管理.exe」開啟時，資料存放在程式旁的 data 資料夾。 */
export async function detectService(): Promise<ServiceInfo | null> {
  if (!location.protocol.startsWith('http')) return null;
  try {
    const r = await fetch('/api/info', { cache: 'no-store' });
    if (!r.ok) return null;
    const info = (await r.json()) as ServiceInfo;
    return info.app === 'community-accounting' ? info : null;
  } catch {
    return null;
  }
}

export async function loadService(): Promise<AppData | null> {
  const r = await fetch('/api/data', { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`讀取資料失敗（HTTP ${r.status}）`);
  return normalizeData(await r.json());
}

export async function saveService(data: AppData): Promise<void> {
  let r: Response;
  try {
    r = await fetch('/api/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', ...SERVICE_HEADERS }, body: toBackupJson(data) });
  } catch {
    throw new Error('無法連線到社區帳務管理服務，請確認黑色視窗沒有被關閉，或重新執行「社區帳務管理.exe」');
  }
  if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error || `存檔失敗（HTTP ${r.status}）`);
}

export async function listServiceBackups(): Promise<{ name: string; size: number; modified: string }[]> {
  const r = await fetch('/api/backups', { cache: 'no-store' });
  return r.ok ? r.json() : [];
}

export async function openServiceDataDir(): Promise<void> {
  await fetch('/api/open-data-dir', { method: 'POST', headers: SERVICE_HEADERS });
}

/** 結束本機服務（Windows 版在背景執行，沒有視窗可以關）。 */
export async function shutdownService(): Promise<void> {
  await fetch('/api/shutdown', { method: 'POST', headers: SERVICE_HEADERS });
}
