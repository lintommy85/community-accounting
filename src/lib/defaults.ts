import { Account, AppData, FieldKey, SCHEMA_VERSION, Settings } from './types';

export function newId(prefix = ''): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}${Date.now().toString(36)}${rand}`;
}

export const FIELD_LABELS: Record<FieldKey, string> = {
  unitNo: '戶別代碼',
  payerName: '所有權人／住戶',
  billPeriod: '帳單期別',
  item: '收費項目',
  paidDate: '繳費日期',
  channel: '繳費方式',
  amount: '繳費金額',
  fee: '手續費',
  depositDate: '入帳日',
  depositAmount: '入帳金額',
  txnNo: '收據單號／交易序號',
  status: '狀態',
  note: '備註',
};

export const MAX_SIGNATURES = 10;

export const PETTY_OTHER = '其他';
export const DEFAULT_PETTY_CATEGORIES = ['文具', '郵資', '清潔用品', '茶水', '五金材料', '影印', '交通費', '雜支'];

/** 零用金科目一律以「其他」結尾，且只出現一次。 */
export const withPettyOther = (list: string[]) => [...list.filter((c) => c && c !== PETTY_OTHER), PETTY_OTHER];

export const REQUIRED_FIELDS: FieldKey[] = ['paidDate', 'amount'];

export const FIELD_ALIASES: Record<FieldKey, string[]> = {
  unitNo: ['戶別代碼', '戶號', '門牌', '戶別', '住戶編號', '房號', '棟別', '單位', '地址', '門號'],
  payerName: ['所有權人', '住戶姓名', '姓名', '繳款人', '住戶', '區權人', '付款人'],
  billPeriod: ['期別名稱', '期別', '帳單月份', '帳單期間', '繳費期間', '帳期', '費用月份', '所屬月份', '計費期間', '收費期間', '月份'],
  item: ['收費項目', '費用項目', '項目', '帳單名稱', '費用名稱', '帳單類型'],
  paidDate: ['繳費日期', '繳款日期', '付款日期', '收款日期', '繳費時間', '付款時間', '交易日期', '交易時間', '繳費日'],
  channel: ['繳費方式', '付款方式', '繳款方式', '支付方式', '繳費管道', '收款方式', '付款管道', '通路'],
  amount: ['實繳金額', '實收金額', '繳費金額', '繳款金額', '付款金額', '收款金額', '交易金額', '金額'],
  fee: ['代收手續費', '手續費', '交易手續費', '服務費', '金流手續費'],
  depositDate: ['入帳日期', '撥款日期', '撥付日期', '預計撥款日', '預計入帳日', '入帳日', '撥款日', '匯款日期'],
  depositAmount: ['入帳金額', '撥款金額', '實際入帳金額'],
  txnNo: ['收據單號', '收據編號', '交易序號', '交易編號', '訂單編號', '繳費編號', '銷帳編號', '單號', '序號', '流水號'],
  status: ['繳費狀態', '交易狀態', '狀態', '入帳狀態'],
  note: ['備註', '說明', '附註'],
};

export function defaultSettings(): Settings {
  return {
    communityName: '',
    logo: '',
    accounts: defaultAccounts(),
    depositAccountId: 'acc_main',
    mapping: {},
    excludeStatusKeywords: ['未繳', '失敗', '取消', '作廢', '退款', '退費', '逾期未付'],
    units: [],
    feePlans: [],
    billItemMap: {},
    totalUnits: 0,
    billingStartMonth: '',
    incomeCategories: ['利息收入', '停車位收入', '場地租借', '雜項收入'],
    pettyCategories: [...DEFAULT_PETTY_CATEGORIES, PETTY_OTHER],
    pettyCashFund: 0,
    fixedCategories: ['物業管理費', '保全費', '清潔費', '電梯保養', '消防保養', '機電保養', '保險費'],
    signatures: ['主任委員', '財務委員', '監察委員', '製表人'].map((label, i) => ({ id: `sig_${i}`, label, row: 1 as const })),
    expenseCategories: ['物業管理費', '保全費', '清潔費', '水費', '電費', '電梯保養', '消防保養', '機電保養', '修繕費', '保險費', '文具雜支', '銀行手續費', '其他支出'],
  };
}

export function emptyData(): AppData {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
    settings: defaultSettings(),
    payments: [],
    dues: [],
    pettyCash: [],
    batches: [],
    entries: [],
    closes: [],
    audit: [],
    renovations: [],
    renovationOpenings: [],
    arrearsLabels: {},
  };
}

export function defaultAccounts(): Account[] {
  return [
    { id: 'acc_main', name: '管理費帳戶', accountNo: '', kind: 'bank', fund: '管理費', openingBalance: 0, openingDate: '', excludeTransfer: false },
    { id: 'acc_fund', name: '公共基金帳戶', accountNo: '', kind: 'bank', fund: '公共基金', openingBalance: 0, openingDate: '', excludeTransfer: false },
    { id: 'acc_cash', name: '零用金', accountNo: '', kind: 'cash', fund: '管理費', openingBalance: 0, openingDate: '', excludeTransfer: true },
  ];
}

/** 可用於帳戶間轉帳的帳戶（排除在「基本設定 → 銀行帳戶」勾選排除轉帳的帳戶）。 */
export function transferAccounts(s: Pick<Settings, 'accounts'>): Account[] {
  return s.accounts.filter((a) => !a.excludeTransfer);
}

/** 有設定社區名稱時回傳「名稱＋後綴」，否則只回傳後綴，用於畫面標題與報表標題。 */
export function withCommunity(settings: Pick<Settings, 'communityName'>, rest: string): string {
  const name = settings.communityName.trim();
  return name ? `${name} ${rest}` : rest;
}

export function appTitle(settings: Pick<Settings, 'communityName'>): string {
  const name = settings.communityName.trim();
  return name ? `${name}帳務管理` : '社區帳務管理';
}

export function fileBase(settings: Pick<Settings, 'communityName'>): string {
  return (settings.communityName.trim() || '社區').replace(/[\\/:*?"<>|]/g, '_');
}

/**
 * 管理費撥款轉入的帳戶：只有一個銀行帳戶時自動使用它；
 * 有多個銀行帳戶時必須在設定中指定，未指定回傳空字串。
 */
export function resolveDepositAccountId(settings: Pick<Settings, 'accounts' | 'depositAccountId'>): string {
  const banks = settings.accounts.filter((a) => a.kind === 'bank');
  if (banks.length === 1) return banks[0].id;
  return banks.some((a) => a.id === settings.depositAccountId) ? settings.depositAccountId : '';
}

export function formatMoney(n: number): string {
  return Math.round(n).toLocaleString('zh-TW');
}

export function parseAmount(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined) return 0;
  let s = String(value).trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[^\d.]/g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}
