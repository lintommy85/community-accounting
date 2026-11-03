import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { emptyData } from './defaults';
import { normalizeData, toBackupJson } from './storage';
import { exportAllToExcel } from './xlsxio';

describe('backup', () => {
  it('round-trips all records and settings through the backup file', () => {
    const d = emptyData();
    d.settings.communityName = '測試社區';
    d.settings.units = [{ id: 'u1', unitNo: 'A1', owner: '王', monthlyFee: 2000, note: '' }];
    d.entries = [{ id: 'e1', date: '2026-10-05', type: 'expense', category: '電費', accountId: 'acc_main', toAccountId: '', amount: 3000, counterparty: '台電', voucherNo: '115-0001', note: '' }];
    const restored = normalizeData(JSON.parse(toBackupJson(d)));
    expect(restored).toEqual(d);
  });

  it('fills fields missing from older backups', () => {
    const d = emptyData() as unknown as Record<string, unknown>;
    delete d.closes;
    const s = d.settings as Record<string, unknown>;
    delete s.accounts;
    const restored = normalizeData(d);
    expect(restored.closes).toEqual([]);
    expect(restored.settings.accounts.length).toBeGreaterThan(0);
  });

  it('excludes cash accounts (零用金) from transfers by default, keeps explicit choices', async () => {
    const { transferAccounts } = await import('./defaults');
    const d = emptyData();
    d.settings.accounts = d.settings.accounts.map(({ excludeTransfer: _, ...a }) => a);
    const restored = normalizeData(JSON.parse(JSON.stringify(d)));
    expect(transferAccounts(restored.settings).map((a) => a.id)).toEqual(['acc_main', 'acc_fund']);
    restored.settings.accounts[1].excludeTransfer = true;
    restored.settings.accounts[2].excludeTransfer = false;
    expect(transferAccounts(normalizeData(restored).settings).map((a) => a.id)).toEqual(['acc_main', 'acc_cash']);
  });

  it('rejects unrelated JSON', () => {
    expect(() => normalizeData({ foo: 1 })).toThrow();
  });

  it('exports every sheet to Excel', async () => {
    const blob = exportAllToExcel(emptyData());
    const wb = XLSX.read(new Uint8Array(await blob.arrayBuffer()), { type: 'array' });
    expect(wb.SheetNames).toEqual(['繳費紀錄', '每月應繳', '收支分錄', '零用金', '戶別', '帳戶', '匯入紀錄', '月結', '操作紀錄']);
  });
});

describe('management fee deposit account', () => {
  it('uses the only bank account automatically, otherwise requires a choice', async () => {
    const { resolveDepositAccountId } = await import('./defaults');
    const bank = (id: string) => ({ id, name: id, accountNo: '', kind: 'bank' as const, fund: '管理費' as const, openingBalance: 0, openingDate: '' });
    const cash = { ...bank('cash'), kind: 'cash' as const };
    expect(resolveDepositAccountId({ accounts: [bank('a'), cash], depositAccountId: '' })).toBe('a');
    expect(resolveDepositAccountId({ accounts: [bank('a'), bank('b')], depositAccountId: '' })).toBe('');
    expect(resolveDepositAccountId({ accounts: [bank('a'), bank('b')], depositAccountId: 'b' })).toBe('b');
    expect(resolveDepositAccountId({ accounts: [bank('a'), bank('b')], depositAccountId: 'cash' })).toBe('');
  });
});

describe('migration from estimated deposit dates', () => {
  it('clears deposit dates that were only estimated by old payout rules', () => {
    const d = emptyData();
    const base = { batchId: 'b', unitNo: 'A1', payerName: '', billPeriod: '', item: '', paidDate: '2026-10-01', channel: '', amount: 1, fee: 0, txnNo: '', status: '', note: '', voided: false };
    d.payments = [
      { ...base, id: 'est', reportDepositDate: '', depositDate: '2026-10-07', depositConfirmed: false },
      { ...base, id: 'rep', reportDepositDate: '2026-10-03', depositDate: '2026-10-03', depositConfirmed: false },
      { ...base, id: 'bank', reportDepositDate: '', depositDate: '2026-10-08', depositConfirmed: true },
      { ...base, id: 'cash', batchId: 'manual', reportDepositDate: '', depositDate: '2026-10-01', depositConfirmed: false },
    ];
    const out = normalizeData(JSON.parse(toBackupJson(d)));
    expect(out.payments.map((p) => [p.id, p.depositDate])).toEqual([['est', ''], ['rep', '2026-10-03'], ['bank', '2026-10-08'], ['cash', '2026-10-01']]);
  });
});

describe('petty cash categories', () => {
  it('fills defaults for old data and always keeps 其他 last', () => {
    const d = emptyData() as unknown as { settings: Record<string, unknown> };
    delete d.settings.pettyCategories;
    expect(normalizeData(d).settings.pettyCategories.slice(-2)).toEqual(['雜支', '其他']);
    d.settings.pettyCategories = ['其他', '文具', '郵資'];
    expect(normalizeData(d).settings.pettyCategories).toEqual(['文具', '郵資', '其他']);
  });
});
