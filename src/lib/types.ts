export const SCHEMA_VERSION = 1;

export type FieldKey =
  | 'unitNo'
  | 'payerName'
  | 'billPeriod'
  | 'item'
  | 'paidDate'
  | 'channel'
  | 'amount'
  | 'fee'
  | 'depositDate'
  | 'depositAmount'
  | 'txnNo'
  | 'status'
  | 'note';

export type ColumnMapping = Partial<Record<FieldKey, string>>;

export interface Account {
  id: string;
  name: string;
  accountNo: string;
  kind: 'bank' | 'cash';
  fund: '管理費' | '公共基金' | '其他';
  openingBalance: number;
  openingDate: string;
  /** 不列入帳戶間轉帳的轉出／轉入選項（例如零用金）。 */
  excludeTransfer?: boolean;
}

export interface Unit {
  id: string;
  unitNo: string;
  /** 目前的所有權人（owners 最後一筆）。 */
  owner: string;
  /** 所有權人紀錄（依起始月份排序）；變更只影響起始月份與之後，之前的月份仍顯示原所有權人。 */
  owners?: OwnerPeriod[];
  monthlyFee: number;
  note: string;
  /** 套用的費率方案；未設定表示個別金額。 */
  planId?: string;
  /** 智生活的戶別 Id（匯入範本第一欄），保留以便對應。 */
  zsId?: string;
  address?: string;
  /** 排除時間；排除的戶別不列入應繳與欠費，保留在設定中，可以再加回。 */
  deletedAt?: string;
  area?: number;
  /** 主方案以外的加收方案（例如機車位清潔費）與數量。 */
  extras?: UnitExtra[];
  /** 繳費週期（月數）：1 月繳、3 季繳、6 半年繳、12 年繳；未設定為月繳。 */
  cycle?: number;
  /** 週期起始月份（1～12），例如年繳從 7 月開始；未設定為 1 月。 */
  cycleStart?: number;
}

/** 某段期間的所有權人：from 起（YYYY-MM；空字串表示最早），到下一筆的起始月份之前。最早一筆也套用到更早的月份。 */
export interface OwnerPeriod {
  from: string;
  owner: string;
  source?: 'import' | 'manual';
  /** 記錄時間。 */
  at?: string;
}

/** 加收：套用方案 × 數量，或自訂某個繳費項目的金額（例如從帳單更新基準時金額不是方案的倍數）。 */
export interface UnitExtra {
  planId?: string;
  item?: string;
  amount?: number;
  qty: number;
}

export interface FeePlan {
  id: string;
  name: string;
  /** 固定金額方案為每月金額；依坪數方案為每坪單價。 */
  amount: number;
  basis?: 'fixed' | 'area';
}

export interface SignatureSlot {
  id: string;
  label: string;
  row: 1 | 2;
}

export interface Settings {
  communityName: string;
  logo: string;
  accounts: Account[];
  depositAccountId: string;
  mapping: ColumnMapping;
  excludeStatusKeywords: string[];
  units: Unit[];
  feePlans: FeePlan[];
  /** 智生活帳單項目（去掉「11月」等月份前綴）對應到：繳費項目名稱、BILL_ARREARS（帳單內含逾期）或 BILL_ASIS（照帳單，不比對基準）。 */
  billItemMap: Record<string, string>;
  totalUnits: number;
  billingStartMonth: string;
  incomeCategories: string[];
  expenseCategories: string[];
  /** 零用金科目，最後固定為「其他」（選其他時自行輸入項目）。 */
  pettyCategories: string[];
  /** 零用金總額（定額零用金）。 */
  pettyCashFund: number;
  /** 列為「固定收入／固定支出」的科目（其餘為非固定），月報表依此分組。 */
  fixedCategories: string[];
  signatures: SignatureSlot[];
  /** 已看過的使用說明動畫版本；低於目前版本時開啟會自動播放。 */
  guideSeen?: number;
}

export interface MonthAmount {
  month: string;
  amount: number;
}

export interface Payment {
  id: string;
  batchId: string;
  unitNo: string;
  payerName: string;
  billPeriod: string;
  item: string;
  paidDate: string;
  channel: string;
  amount: number;
  fee: number;
  reportDepositDate: string;
  depositDate: string;
  depositConfirmed: boolean;
  txnNo: string;
  status: string;
  note: string;
  voided: boolean;
  /** 手動指定的逐月銷帳；未設定時由系統自動分配。 */
  allocations?: MonthAmount[];
  /** 報表上的入帳金額（已處理內含／外加手續費）；沒有時以繳費金額扣手續費計算。 */
  depositAmount?: number;
}

/** 某門牌某月份的一筆應繳（帳單）項目；手動輸入或從帳單檔匯入，不會自動產生。 */
export interface Due {
  id: string;
  unitNo: string;
  month: string;
  item: string;
  amount: number;
  source: 'manual' | 'import';
  note: string;
  updatedAt: string;
  /** 智生活帳單上的金額（可能含逾期）；本月應繳 amount 依戶別基準拆出。 */
  billAmount?: number;
  /** 「前期欠款」或季繳／年繳的週期月份由哪個月份的帳單拆出。 */
  fromBill?: string;
  /**
   * fee 與基準比對的繳費項目；asis 照帳單（減免…）；arrears 帳單內含逾期（金額 0，只記帳單金額）；
   * prepaid 預繳沖銷由系統預收款銷帳（金額 0，只記帳單金額）。
   */
  kind?: 'fee' | 'asis' | 'arrears' | 'prepaid';
}

export interface ImportBatch {
  id: string;
  fileName: string;
  sheetName: string;
  importedAt: string;
  totalRows: number;
  added: number;
  duplicates: number;
  skipped: number;
}

/** 零用金支出（獨立記錄，不直接列入收支表；每月使用總額以「零用金撥補」列為支出）。 */
export interface PettyCashEntry {
  id: string;
  date: string;
  /** 零用金科目；選「其他」時 item 為自行輸入的項目。 */
  category?: string;
  item: string;
  amount: number;
  payee: string;
  note: string;
}

export interface LedgerEntry {
  id: string;
  date: string;
  type: 'income' | 'expense' | 'transfer';
  category: string;
  accountId: string;
  toAccountId: string;
  amount: number;
  counterparty: string;
  voucherNo: string;
  note: string;
  /** 由零用金頁產生的撥補支出所屬月份。 */
  pettyMonth?: string;
}

export interface MonthClose {
  month: string;
  closedAt: string;
  inTransit: number;
  deposited: number;
  note: string;
}

export interface AuditEntry {
  at: string;
  action: string;
  detail: string;
}

export interface AppData {
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
  settings: Settings;
  payments: Payment[];
  dues: Due[];
  pettyCash: PettyCashEntry[];
  batches: ImportBatch[];
  entries: LedgerEntry[];
  closes: MonthClose[];
  audit: AuditEntry[];
}
