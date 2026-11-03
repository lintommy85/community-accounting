import { describe, expect, it } from 'vitest';
import { applyUnitImport, ownerAt, ownerHistory, planUnitImport, removeOwnerPeriod, renameOwnerPeriod, setOwnerFrom } from './owners';
import { Unit } from './types';

const unit = (owner: string, extra: Partial<Unit> = {}): Unit => ({ id: 'u1', unitNo: 'A1-3F', owner, monthlyFee: 2000, note: '', ...extra });

describe('owner history', () => {
  it('treats a legacy owner as the earliest owner', () => {
    const u = unit('王小明');
    expect(ownerHistory(u)).toEqual([{ from: '', owner: '王小明' }]);
    expect(ownerAt(u, '2020-01')).toBe('王小明');
  });

  it('changes the owner from a month onward without touching earlier months', () => {
    const u = setOwnerFrom(unit('王小明'), '2026-11', '李大華', 'import', 't');
    expect(u.owner).toBe('李大華');
    expect(ownerAt(u, '2026-10')).toBe('王小明');
    expect(ownerAt(u, '2026-11')).toBe('李大華');
    expect(ownerAt(u, '2027-03')).toBe('李大華');
  });

  it('inserts a back-filled change before later records and merges repeats', () => {
    let u = setOwnerFrom(unit('', { owners: [] }), '2026-11', '李大華', 'import', 't');
    expect(ownerHistory(u)).toEqual([{ from: '2026-11', owner: '李大華', source: 'import', at: 't' }]);
    // 補匯更早的月份，所有權人不同：只影響那個月起到下一筆之前
    u = setOwnerFrom(u, '2026-09', '王小明', 'import', 't');
    expect([ownerAt(u, '2026-08'), ownerAt(u, '2026-09'), ownerAt(u, '2026-10'), ownerAt(u, '2026-11')]).toEqual(['王小明', '王小明', '王小明', '李大華']);
    expect(u.owner).toBe('李大華');
    // 李大華其實 10 月就過戶：合併成一段
    u = setOwnerFrom(u, '2026-10', '李大華', 'manual', 't');
    expect(ownerHistory(u).map((p) => [p.from, p.owner])).toEqual([['2026-09', '王小明'], ['2026-10', '李大華']]);
  });

  it('ignores whitespace differences and fills a blank owner instead of adding a change', () => {
    const u = unit('王 小明');
    expect(setOwnerFrom(u, '2026-11', '王小明', 'import')).toBe(u);
    const blank = setOwnerFrom(unit('', { owners: [{ from: '', owner: '' }] }), '2026-11', '陳美麗', 'import', 't');
    expect(ownerHistory(blank).map((p) => [p.from, p.owner])).toEqual([['', '陳美麗']]);
  });

  it('renames or removes a period', () => {
    let u = setOwnerFrom(unit('王小明'), '2026-11', '李大華', 'manual', 't');
    u = renameOwnerPeriod(u, '2026-11', '李大樺');
    expect(u.owner).toBe('李大樺');
    expect(removeOwnerPeriod(u, '').owners).toHaveLength(2);
    u = removeOwnerPeriod(u, '2026-11');
    expect([u.owner, ownerAt(u, '2027-01')]).toEqual(['王小明', '王小明']);
  });
});

describe('template unit import', () => {
  const incoming = (owner: string, month = '2026-11') => [{ unitNo: 'A1-3F', owner, zsId: '', address: '', month }];

  it('lists owner differences against the owner of the bill month', () => {
    const u = setOwnerFrom(unit('王小明'), '2026-12', '李大華', 'import', 't');
    expect(planUnitImport([u], incoming('王小明', '2026-11')).ownerDiffs).toEqual([]);
    expect(planUnitImport([u], incoming('李大華', '2026-11')).ownerDiffs).toEqual([{ key: 'A1-3F', unitNo: 'A1-3F', month: '2026-11', current: '王小明', incoming: '李大華' }]);
  });

  it('changes the owner from the bill month only when chosen', () => {
    const u = unit('王小明');
    const plan = planUnitImport([u], incoming('李大華'));
    expect(applyUnitImport([u], plan, new Set(), () => 'n')[0].owner).toBe('王小明');
    const [changed] = applyUnitImport([u], plan, new Set(['A1-3F']), () => 'n', 't');
    expect([ownerAt(changed, '2026-10'), ownerAt(changed, '2026-11'), changed.owner]).toEqual(['王小明', '李大華', '李大華']);
  });

  it('excludes an existing unit when ticked', () => {
    const plan = planUnitImport([unit('王小明')], incoming('王小明'), new Map([['A1-3F', true]]));
    expect(plan.excludedNow).toBe(1);
    expect(applyUnitImport([unit('王小明')], plan, new Set(), () => 'n', 't')[0].deletedAt).toBe('t');
  });
});
