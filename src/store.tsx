import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { emptyData } from './lib/defaults';
import {
  createDataFile,
  detectService,
  loadService,
  saveService,
  ServiceInfo,
  shutdownService,
  ensurePermission,
  fileApiSupported,
  getLinkedHandle,
  loadLocal,
  normalizeData,
  openDataFile,
  saveLocal,
  unlinkDataFile,
  writeHandle,
} from './lib/storage';
import { AppData } from './lib/types';

export type FileStatus = 'service' | 'unsupported' | 'none' | 'needPermission' | 'linked' | 'error';

interface Store {
  data: AppData;
  ready: boolean;
  update: (fn: (d: AppData) => AppData, action: string, detail?: string) => void;
  replaceAll: (d: AppData, action: string) => void;
  fileStatus: FileStatus;
  fileName: string;
  service: ServiceInfo | null;
  lastSavedAt: string;
  saveError: string;
  linkNewFile: () => Promise<void>;
  linkExistingFile: () => Promise<void>;
  reconnectFile: () => Promise<void>;
  unlinkFile: () => Promise<void>;
  isClosed: (date: string) => boolean;
  /** 存檔後結束本機服務；結束後 stopped 為 true。 */
  shutdown: () => Promise<void>;
  stopped: boolean;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('StoreProvider missing');
  return s;
}

type Handle = Awaited<ReturnType<typeof getLinkedHandle>>;

export function StoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(emptyData);
  const [ready, setReady] = useState(false);
  const [fileStatus, setFileStatus] = useState<FileStatus>(fileApiSupported() ? 'none' : 'unsupported');
  const [fileName, setFileName] = useState('');
  const [lastSavedAt, setLastSavedAt] = useState('');
  const [saveError, setSaveError] = useState('');
  const [service, setService] = useState<ServiceInfo | null>(null);
  const handleRef = useRef<Handle>(undefined);
  const dirty = useRef(false);
  const [stopped, setStopped] = useState(false);

  useEffect(() => {
    (async () => {
      const svc = await detectService();
      if (svc) {
        try {
          const fromService = await loadService();
          setService(svc);
          setFileName(svc.dataFile);
          setFileStatus('service');
          if (fromService) setData(fromService);
          else {
            const local = await loadLocal().catch(() => null);
            dirty.current = true;
            setData(local ?? emptyData());
          }
        } catch (e) {
          setFileName(svc.dataFile);
          setFileStatus('error');
          setSaveError(`無法讀取 ${svc.dataFile}：${e instanceof Error ? e.message : String(e)}。可到「備份與還原」從 data\\backups 的備份檔還原。`);
        }
        setReady(true);
        return;
      }
      const local = await loadLocal().catch(() => null);
      let current = local ?? emptyData();
      const h = await getLinkedHandle();
      if (h) {
        handleRef.current = h;
        setFileName(h.name);
        if (await ensurePermission(h, false)) {
          try {
            const fromFile = normalizeData(JSON.parse(await (await h.getFile()).text()));
            if (!local || fromFile.updatedAt > local.updatedAt) current = fromFile;
            setFileStatus('linked');
          } catch {
            setFileStatus('error');
          }
        } else {
          setFileStatus('needPermission');
        }
      }
      setData(current);
      setReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!ready || !dirty.current) return;
    const t = setTimeout(async () => {
      try {
        if (fileStatus === 'service') await saveService(data);
        else {
          await saveLocal(data);
          if (handleRef.current && fileStatus === 'linked') await writeHandle(handleRef.current, data);
        }
        setLastSavedAt(new Date().toLocaleTimeString('zh-TW'));
        setSaveError('');
        dirty.current = false;
      } catch (e) {
        setSaveError(e instanceof Error ? e.message : String(e));
      }
    }, 400);
    return () => clearTimeout(t);
  }, [data, ready, fileStatus]);

  const update = useCallback((fn: (d: AppData) => AppData, action: string, detail = '') => {
    setData((prev) => {
      const next = fn(prev);
      const at = new Date().toISOString();
      dirty.current = true;
      return { ...next, updatedAt: at, audit: [...next.audit, { at, action, detail }].slice(-5000) };
    });
  }, []);

  const replaceAll = useCallback(
    (d: AppData, action: string) => update(() => d, action, `繳費 ${d.payments.length} 筆、分錄 ${d.entries.length} 筆`),
    [update],
  );

  const linkNewFile = async () => {
    const h = await createDataFile(data);
    handleRef.current = h;
    setFileName(h.name);
    setFileStatus('linked');
    setLastSavedAt(new Date().toLocaleTimeString('zh-TW'));
  };

  const linkExistingFile = async () => {
    const { handle, data: loaded } = await openDataFile();
    handleRef.current = handle;
    setFileName(handle.name);
    setFileStatus('linked');
    dirty.current = true;
    setData(loaded);
  };

  const reconnectFile = async () => {
    const h = handleRef.current;
    if (!h) return;
    if (!(await ensurePermission(h, true))) return;
    const fromFile = normalizeData(JSON.parse(await (await h.getFile()).text()));
    if (fromFile.updatedAt > data.updatedAt) setData(fromFile);
    else {
      dirty.current = true;
      setData({ ...data });
    }
    setFileStatus('linked');
  };

  const unlinkFile = async () => {
    await unlinkDataFile();
    handleRef.current = undefined;
    setFileName('');
    setFileStatus(fileApiSupported() ? 'none' : 'unsupported');
  };

  const shutdown = useCallback(async () => {
    if (dirty.current) {
      await saveService(data);
      dirty.current = false;
    }
    await shutdownService();
    setStopped(true);
  }, [data]);

  const isClosed = useCallback((date: string) => data.closes.some((c) => date.startsWith(c.month)), [data.closes]);

  return (
    <Ctx.Provider
      value={{
        data,
        ready,
        update,
        replaceAll,
        fileStatus,
        fileName,
        service,
        lastSavedAt,
        saveError,
        linkNewFile,
        linkExistingFile,
        reconnectFile,
        unlinkFile,
        isClosed,
        shutdown,
        stopped,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
