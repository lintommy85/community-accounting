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
  /** 期初預收款：帳務起始月之前已預繳（例如年繳、半年繳）、尚未沖銷的金額，從起始月起依序銷帳。 */
  openingPrepaid?: number;
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
  /** 畫面配色：深色（預設）或淺色；報表一律維持原本的配色。 */
  theme?: 'light' | 'dark';
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
  /** 裝潢保證金：費率方案與報表科目名稱。 */
  renovation?: RenovationSettings;
  /** 逾期款項的報表科目是否合併成一筆（科目 → 是否合併；沒設定為合併）。 */
  arrearsMerge?: Record<string, boolean>;
  /** 到期提醒：到期（或申報期限）前幾個月開始高亮提醒；沒設定時合約、設備證書 3 個月，政府申報 6 個月。 */
  reminders?: Partial<ReminderMonths>;
  /** 月報「預收款項變動」與「應收（未繳）管理費變動」的欄位名稱與可選的帳單項目。 */
  reportFields?: ReportFields;
}

/** 月報欄位設定：labels 是改過的欄位名稱（沒有或空白用預設名稱）；items 是可選的帳單項目，本月帳單上的金額在公式中減掉。 */
export interface ReportFields {
  labels?: Record<string, string>;
  items?: { bill: string; label?: string }[];
}

export interface ReminderMonths {
  contracts: number;
  assets: number;
  filings: number;
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
  kind?: 'fee' | 'asis' | 'arrears' | 'prepaid' | ChargeKind;
}

/** 帳單上不列入應繳的款項：罰款、裝潢保證金（金額 0，只記帳單金額），繳款時另外記在帳卡。 */
export type ChargeKind = 'fine' | 'deposit';

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
  /** 裝潢保證金產生的分錄：deposit 手動登錄收到的保證金、refund 結算退款、fee 退款的匯款手續費。 */
  renovationKind?: 'deposit' | 'refund' | 'fee';
  /** 裝潢保證金分錄所屬的戶別（報表不顯示，只用來在裝潢保證金頁對應）。 */
  renovationUnit?: string;
  /** 結算產生的分錄所屬的裝潢紀錄。 */
  renovationId?: string;
}

/** 裝潢保證金費率的一項：單筆直接扣，每日依施工天數計算。 */
export interface RenovationRateItem {
  id: string;
  name: string;
  mode: 'once' | 'daily';
  amount: number;
}

/** 裝潢保證金費率方案；沒有項目就是「無費率」。 */
export interface RenovationPlan {
  id: string;
  name: string;
  items: RenovationRateItem[];
}

export interface RenovationSettings {
  plans: RenovationPlan[];
  /** 報表上收到保證金的科目名稱。 */
  depositLabel: string;
  /** 報表上結算退款的科目名稱。 */
  refundLabel: string;
  /** 報表上退款匯款手續費的科目名稱（分開呈現時使用）。 */
  feeLabel: string;
  /** 結算時預設的手續費呈現方式：separate 退款與手續費各列一筆、combined 手續費併入退款整筆呈現。 */
  feeMode: RenovationFeeMode;
}

export type RenovationFeeMode = 'separate' | 'combined';

/** 建立系統前就已收到、已含在帳戶期初餘額裡的裝潢保證金：只記在這戶，不影響帳戶餘額與報表。 */
export interface RenovationOpening {
  id: string;
  unitNo: string;
  date: string;
  amount: number;
  accountId: string;
}

/** 結算時每一項費率的扣款。 */
export interface RenovationDeduction {
  name: string;
  mode: 'once' | 'daily';
  amount: number;
  days?: number;
  deducted: number;
}

export interface RenovationSettlement {
  at: string;
  /** 退款列入哪個月份的報表（分錄日期）。 */
  date: string;
  /** 結算時已收的保證金與包含的收款（繳費 id 或分錄 id）。 */
  deposit: number;
  receiptIds: string[];
  deductions: RenovationDeduction[];
  deducted: number;
  /** 應退金額＝退款＋匯款手續費。 */
  refundTotal: number;
  refund: number;
  fee: number;
  /** 手續費在報表上的呈現方式；舊資料沒有時視為分開。 */
  feeMode?: RenovationFeeMode;
  accountId: string;
  entryIds: string[];
}

/** 一戶的一次裝修：套用當時的費率方案內容（之後修改方案不影響），結算後就完成。 */
export interface Renovation {
  id: string;
  unitNo: string;
  planName: string;
  items: RenovationRateItem[];
  startDate: string;
  note: string;
  createdAt: string;
  settlement?: RenovationSettlement;
}

/** 合約、設備證書、政府申報的修改紀錄：每次儲存記一筆當時的到期日（或申報完成月份）與修改時間。 */
export interface TrackRecord {
  id: string;
  /** 修改時間（ISO）。 */
  at: string;
  /** 當時的合約到期日、設備證書到期日（YYYY-MM-DD）或最近一次申報月份（YYYY-MM）。 */
  value: string;
  /** 其他內容摘要，例如廠商與金額。 */
  detail: string;
}

export type ContractCycle = 'month' | 'quarter' | 'half' | 'year';

/** 簽約廠商的合約：合約金額依帳務週期計，到期前 3 個月提醒。 */
export interface Contract {
  id: string;
  /** 合約項目，例如保全服務、電梯保養。 */
  title: string;
  vendor: string;
  amount: number;
  cycle: ContractCycle;
  startDate: string;
  endDate: string;
  note: string;
  /** 到期不續約：到了提醒時間也不高亮提醒。 */
  noRenew?: boolean;
  history: TrackRecord[];
}

/** 有有效期的設備或需要定期更新的證書，到期前 3 個月提醒。 */
export interface AssetItem {
  id: string;
  kind: 'equipment' | 'certificate';
  name: string;
  expiry: string;
  note: string;
  history: TrackRecord[];
}

/** 政府固定申報項目：每 everyYears 年一次，dueMonth 月底前要完成；到期前半年提醒。 */
export interface Filing {
  id: string;
  name: string;
  everyYears: number;
  dueMonth: number;
  /** 最近一次申報完成的月份（YYYY-MM），還沒填時空白。 */
  lastMonth: string;
  note: string;
  history: TrackRecord[];
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
  renovations: Renovation[];
  /** 建立系統前已收的裝潢保證金。 */
  renovationOpenings?: RenovationOpening[];
  /** 合約管理。 */
  contracts?: Contract[];
  /** 財產管理：設備與證書。 */
  assets?: AssetItem[];
  /** 財產管理：政府申報（第一次載入時預先建立透保水檢查、消防申報、公安申報）。 */
  filings?: Filing[];
  /** 逾期款項歸類的報表科目：逾期款項的鍵（繳款 id｜月份｜項目）→ 科目，例如「10月逾期汽車清潔費」。 */
  arrearsLabels?: Record<string, string>;
}
