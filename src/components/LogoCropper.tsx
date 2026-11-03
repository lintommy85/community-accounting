import { PointerEvent, useRef, useState } from 'react';
import { clampView, LOGO_SIZE, renderSquare, View, viewToCrop, zoomView } from '../lib/image';

const VIEWPORT = 280;
const MAX_ZOOM = 5;

export default function LogoCropper({ img, onCancel, onDone }: { img: HTMLImageElement; onCancel: () => void; onDone: (dataUrl: string) => void }) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const minScale = Math.max(VIEWPORT / w, VIEWPORT / h);
  const [view, setView] = useState<View>(() =>
    clampView({ scale: minScale, x: (VIEWPORT - w * minScale) / 2, y: (VIEWPORT - h * minScale) / 2 }, w, h, VIEWPORT),
  );
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const crop = viewToCrop(view, VIEWPORT);
  const outSize = Math.min(LOGO_SIZE, Math.round(crop.size));

  function onDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { px: e.clientX, py: e.clientY, x: view.x, y: view.y };
  }

  function onMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d) return;
    setView(clampView({ scale: view.scale, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py }, w, h, VIEWPORT));
  }

  const zoomTo = (s: number) => setView(zoomView(view, Math.min(minScale * MAX_ZOOM, Math.max(minScale, s)), w, h, VIEWPORT));

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>裁切社區圖示</h2>
        <p className="hint">原圖 {w}×{h}，拖曳移動、用滑桿放大縮小，框內範圍會存成 {outSize}×{outSize} 的正方形圖示。</p>
        <div className="crop-body">
          <div
            className="crop-view"
            style={{ width: VIEWPORT, height: VIEWPORT }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <img src={img.src} alt="" draggable={false} style={{ left: view.x, top: view.y, width: w * view.scale, height: h * view.scale }} />
            <div className="crop-grid" />
          </div>
          <div className="crop-side">
            <div className="hint">預覽</div>
            <div className="crop-preview" style={{ width: 96, height: 96 }}>
              <img src={img.src} alt="" style={{ left: view.x * (96 / VIEWPORT), top: view.y * (96 / VIEWPORT), width: w * view.scale * (96 / VIEWPORT), height: h * view.scale * (96 / VIEWPORT) }} />
            </div>
          </div>
        </div>
        <div className="form-row">
          <button onClick={() => zoomTo(view.scale / 1.2)} aria-label="縮小">－</button>
          <input
            type="range"
            min={minScale}
            max={minScale * MAX_ZOOM}
            step={minScale / 100}
            value={view.scale}
            onChange={(e) => zoomTo(Number(e.target.value))}
            style={{ flex: 1 }}
            aria-label="縮放"
          />
          <button onClick={() => zoomTo(view.scale * 1.2)} aria-label="放大">＋</button>
        </div>
        <div className="form-row modal-actions">
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={() => onDone(renderSquare(img, crop))}>使用這個範圍</button>
        </div>
      </div>
    </div>
  );
}
