import { describe, expect, it } from 'vitest';
import { clampView, needsCrop, viewToCrop, zoomView } from './image';

describe('logo crop math', () => {
  it('only asks to crop non-square or oversized images', () => {
    expect(needsCrop(256, 256)).toBe(false);
    expect(needsCrop(128, 128)).toBe(false);
    expect(needsCrop(300, 300)).toBe(true);
    expect(needsCrop(200, 100)).toBe(true);
  });

  it('keeps the image covering the crop box', () => {
    // 1000x500 image at scale 0.56 → 560x280 inside a 280 box.
    const v = clampView({ scale: 0.56, x: 50, y: -30 }, 1000, 500, 280);
    expect(v).toEqual({ scale: 0.56, x: 0, y: 0 });
    const right = clampView({ scale: 0.56, x: -999, y: 0 }, 1000, 500, 280);
    expect(right.x).toBeCloseTo(-280);
  });

  it('zooms around the centre and maps the box back to source pixels', () => {
    const start = { scale: 0.56, x: -140, y: 0 };
    const z = zoomView(start, 1.12, 1000, 500, 280);
    const c0 = viewToCrop(start, 280);
    const c1 = viewToCrop(z, 280);
    expect(c0.sx + c0.size / 2).toBeCloseTo(c1.sx + c1.size / 2);
    expect(c1.size).toBeCloseTo(250);
  });
});
