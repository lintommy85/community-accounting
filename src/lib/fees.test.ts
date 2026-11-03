import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults';
import { assignAmount, assignPlan, removePlan, updatePlan } from './fees';
import { Settings } from './types';

function settingsWith(units: Settings['units'] = []): Settings {
  return { ...defaultSettings(), units };
}

describe('fee plans', () => {
  const units = [
    { id: 'a', unitNo: '12號之1', owner: '', monthlyFee: 0, note: '' },
    { id: 'b', unitNo: '12號之2', owner: '', monthlyFee: 0, note: '' },
    { id: 'c', unitNo: '14號', owner: '', monthlyFee: 0, note: '' },
  ];

  it('applies a plan to ticked door numbers and follows later plan changes', () => {
    const plan = { id: 'p1', name: '一般住戶', amount: 2000 };
    const s = { ...settingsWith(assignPlan(units, new Set(['a', 'b']), plan)), feePlans: [plan] };
    expect(s.units.map((u) => [u.unitNo, u.monthlyFee, u.planId])).toEqual([
      ['12號之1', 2000, 'p1'], ['12號之2', 2000, 'p1'], ['14號', 0, undefined],
    ]);
    const next = updatePlan(s, { ...plan, amount: 2200 });
    expect(next.units.map((u) => u.monthlyFee)).toEqual([2200, 2200, 0]);
    const removed = removePlan({ ...s, ...next }, 'p1');
    expect(removed.units.map((u) => [u.monthlyFee, u.planId])).toEqual([[2200, undefined], [2200, undefined], [0, undefined]]);
  });

  it('sets a custom amount and detaches from the plan', () => {
    const plan = { id: 'p1', name: '一般', amount: 2000 };
    const out = assignAmount(assignPlan(units, new Set(['a', 'b']), plan), new Set(['b']), 2500);
    expect(out.map((u) => [u.monthlyFee, u.planId])).toEqual([[2000, 'p1'], [2500, undefined], [0, undefined]]);
  });
});

describe('area-based fee plan', () => {
  it('charges rate × 坪數, rounded, and follows area and rate changes', async () => {
    const { planFee, setUnitArea } = await import('./fees');
    const plan = { id: 'p', name: '每坪 60', amount: 60, basis: 'area' as const };
    const units = [
      { id: 'a', unitNo: 'A', owner: '', monthlyFee: 0, note: '', area: 30.5 },
      { id: 'b', unitNo: 'B', owner: '', monthlyFee: 0, note: '', area: 45.27 },
      { id: 'c', unitNo: 'C', owner: '', monthlyFee: 0, note: '' },
    ];
    expect(planFee(plan, units[0])).toBe(1830);
    const assigned = assignPlan(units, new Set(['a', 'b', 'c']), plan);
    expect(assigned.map((u) => u.monthlyFee)).toEqual([1830, 2716, 0]);
    const s = { ...settingsWith(assigned), feePlans: [plan] };
    expect(updatePlan(s, { ...plan, amount: 62 }).units.map((u) => u.monthlyFee)).toEqual([1891, 2807, 0]);
    expect(setUnitArea(assigned, [plan], 'c', 20).find((u) => u.id === 'c')!.monthlyFee).toBe(1200);
  });
});
