import { afterEach, describe, expect, it, vi } from 'vitest';
import { localDate, localDateTime } from './dates';
import { emptyData } from './defaults';
import { backupFileName } from './storage';

describe('local time display', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows stored UTC timestamps in local time', () => {
    const iso = new Date(2026, 10, 14, 0, 17, 5).toISOString();
    expect(localDateTime(iso)).toBe('2026-11-14 00:17');
    expect(localDateTime(iso, true)).toBe('2026-11-14 00:17:05');
    expect(localDate(iso)).toBe('2026-11-14');
    expect(localDateTime('')).toBe('');
    expect(localDateTime('not a date')).toBe('not a date');
  });

  it('names backups with the local time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 0, 17));
    expect(backupFileName(emptyData())).toMatch(/-帳務備份-202611140017\.json$/);
  });
});
