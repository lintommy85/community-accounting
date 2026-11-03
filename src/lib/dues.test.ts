import { describe, expect, it } from 'vitest';
import { applyDueChanges, diffDues, dueRowsFromTable } from './dues';
import { billTable, guessBillMapping } from './fees';
import { Due } from './types';

const grid = [
  ['某某社區 管理費帳單'],
  ['戶號', '區權人', '帳單期別', '收費項目', '應繳金額', '實繳金額'],
  ['12號之1', '王小明', '115/11', '管理費', 1830, 1830],
  ['12號之1', '王小明', '115/11', '減收', -200, ''],
  ['12號之2', '李大華', '115/11', '管理費', 1830, ''],
  ['12號之3', '陳美麗', '115/10~115/12', '管理費', 8100, 8100],
  ['14號', '張店面', '', '管理費', 3600, ''],
  ['合計', '', '', '', 15160],
];

const existing = (): Due[] => [
  { id: 'e1', unitNo: '12號之1', month: '2026-11', item: '管理費', amount: 1830, source: 'import', note: '', updatedAt: 'old' },
  { id: 'e2', unitNo: '12號之2', month: '2026-11', item: '管理費', amount: 1800, source: 'import', note: '', updatedAt: 'old' },
];

describe('dues import', () => {
  it('reads bill rows, splits ranges and keeps negative adjustments', () => {
    const table = billTable('帳單', grid);
    const { rows, issues } = dueRowsFromTable(table, guessBillMapping(table.headers), '');
    expect(rows.map((r) => [r.unitNo, r.month, r.item, r.amount])).toEqual([
      ['12號之1', '2026-11', '管理費', 1830],
      ['12號之1', '2026-11', '減收', -200],
      ['12號之2', '2026-11', '管理費', 1830],
      ['12號之3', '2026-10', '管理費', 2700],
      ['12號之3', '2026-11', '管理費', 2700],
      ['12號之3', '2026-12', '管理費', 2700],
    ]);
    expect(issues).toEqual([{ rowNumber: 7, reason: '沒有期別，請指定帳單月份' }]);
    const withFallback = dueRowsFromTable(table, guessBillMapping(table.headers), '2026-11');
    expect(withFallback.rows.find((r) => r.unitNo === '14號')).toMatchObject({ month: '2026-11', amount: 3600 });
  });

  it('only updates changed amounts on repeated imports', () => {
    const table = billTable('帳單', grid);
    const { rows } = dueRowsFromTable(table, guessBillMapping(table.headers), '2026-11');
    const changes = diffDues(existing(), rows);
    const count = (s: string) => changes.filter((c) => c.status === s).length;
    expect([count('new'), count('changed'), count('same')]).toEqual([5, 1, 1]);
    const out = applyDueChanges(existing(), changes, 'now');
    expect(out.find((d) => d.id === 'e1')!.updatedAt).toBe('old');
    expect(out.find((d) => d.id === 'e2')).toMatchObject({ amount: 1830, updatedAt: 'now' });
    expect(out).toHaveLength(7);
    // 同一份檔案再匯入一次：全部相同
    expect(diffDues(out, rows).every((c) => c.status === 'same')).toBe(true);
  });
});

/** 仿智生活「管理費匯入範本」實際格式（資料為虛構）。 */
const zsTemplate = [
  ['社區名稱', '範例社區'],
  [null, null, null, null, null, null, ' 建立繳費單的繳費項目及金額'],
  ['戶別Id資料(請勿修改內容資料)', '戶別代碼', '所有權人姓名', '通訊地址', '戶別通訊欄(限50字)', '應繳總額', '管理費', '車位清潔費', '減收', 'xx費', '繳費開始日期', '繳費結束日期', '條碼到期日期'],
  [null, null, null, '(如留空白則住址處出現戶別代碼)', '此欄備註為戶別各自顯示於繳費單', '(依據右欄費用自動加總)', '1.請將「xx費」改為您要新增的繳費項目', null, null, null, '輸入格式範例：2019/01/01'],
  ['篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選', '篩選'],
  ['id-1', '(A01-02)35號2樓之1', '王小明', '新北市某路35號2樓之1', null, 2300, 2000, 300, null, null, '2026/11/01', '2026/11/30', '2026/11/30'],
  ['id-2', '(A02-02)35號2樓之2', '李大華', '新北市某路35號2樓之2', null, 1800, 2000, null, -200, null, '2026/11/01', '2026/11/30', '2026/11/30'],
  ['id-3', '(B07-07)37號7樓之7', '陳美麗', '新北市某路37號7樓之7', null, null, null, null, null, null, null, null, null],
  ['id-4', '管理室', '管理室', '管理室', null, null, null, null, null, null, null, null, null],
];

describe('智生活管理費匯入範本 format', () => {
  it('detects item columns between 應繳總額 and 繳費開始日期 and builds dues and units', async () => {
    const { detectWideLayout, dueRowsFromWide, mergeUnits } = await import('./dues');
    const table = billTable('繳費單列表', zsTemplate);
    expect(table.headerRow).toBe(2);
    const layout = detectWideLayout(table.headers)!;
    expect(layout).toMatchObject({ unitCol: '戶別代碼', ownerCol: '所有權人姓名', startCol: '繳費開始日期', itemCols: ['管理費', '車位清潔費', '減收', 'xx費'] });
    const { rows, units, issues } = dueRowsFromWide(table, layout, '');
    expect(rows.map((r) => [r.unitNo, r.month, r.item, r.amount])).toEqual([
      ['(A01-02)35號2樓之1', '2026-11', '管理費', 2000],
      ['(A01-02)35號2樓之1', '2026-11', '車位清潔費', 300],
      ['(A02-02)35號2樓之2', '2026-11', '管理費', 2000],
      ['(A02-02)35號2樓之2', '2026-11', '減收', -200],
    ]);
    expect(issues).toEqual([]);
    expect(units.map((u) => [u.unitNo, u.owner, u.zsId])).toEqual([
      ['(A01-02)35號2樓之1', '王小明', 'id-1'],
      ['(A02-02)35號2樓之2', '李大華', 'id-2'],
      ['(B07-07)37號7樓之7', '陳美麗', 'id-3'],
      ['管理室', '管理室', 'id-4'],
    ]);
    const merged = mergeUnits([{ id: 'x', unitNo: '(B07-07)37號7樓之7', owner: '', monthlyFee: 0, note: '' }], units, () => 0);
    expect([merged.added, merged.updated, merged.units.length]).toEqual([3, 1, 4]);
    expect(merged.units[0]).toMatchObject({ owner: '陳美麗', zsId: 'id-3' });
  });

  it('uses the fallback month when 繳費開始日期 is blank', async () => {
    const { detectWideLayout, dueRowsFromWide } = await import('./dues');
    const grid = zsTemplate.map((r, i) => (i === 5 ? [...r.slice(0, 10), null, null, null] : r));
    const table = billTable('繳費單列表', grid);
    const layout = detectWideLayout(table.headers)!;
    expect(dueRowsFromWide(table, layout, '').issues).toHaveLength(1);
    expect(dueRowsFromWide(table, layout, '2026-12').rows.filter((r) => r.month === '2026-12')).toHaveLength(2);
  });
});
