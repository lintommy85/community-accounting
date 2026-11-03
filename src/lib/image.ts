export const LOGO_SIZE = 256;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('無法讀取這張圖片'));
      img.src = String(reader.result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 圖片不是正方形或大於 LOGO_SIZE 時需要裁切。 */
export function needsCrop(w: number, h: number): boolean {
  return w !== h || Math.max(w, h) > LOGO_SIZE;
}

export interface CropRect {
  sx: number;
  sy: number;
  size: number;
}

/** 依裁切框（原圖座標）輸出正方形 PNG data URL，小圖不放大。 */
export function renderSquare(img: HTMLImageElement, crop: CropRect): string {
  const out = Math.min(LOGO_SIZE, Math.round(crop.size)) || LOGO_SIZE;
  const canvas = document.createElement('canvas');
  canvas.width = out;
  canvas.height = out;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.sx, crop.sy, crop.size, crop.size, 0, 0, out, out);
  return canvas.toDataURL('image/png');
}

export interface View {
  scale: number;
  x: number;
  y: number;
}

/** 讓圖片永遠蓋滿裁切框，不露出空白。 */
export function clampView(v: View, w: number, h: number, viewport: number): View {
  return {
    scale: v.scale,
    x: Math.min(0, Math.max(viewport - w * v.scale, v.x)),
    y: Math.min(0, Math.max(viewport - h * v.scale, v.y)),
  };
}

/** 以裁切框中心為基準縮放。 */
export function zoomView(v: View, nextScale: number, w: number, h: number, viewport: number): View {
  const c = viewport / 2;
  const ix = (c - v.x) / v.scale;
  const iy = (c - v.y) / v.scale;
  return clampView({ scale: nextScale, x: c - ix * nextScale, y: c - iy * nextScale }, w, h, viewport);
}

export function viewToCrop(v: View, viewport: number): CropRect {
  return { sx: -v.x / v.scale, sy: -v.y / v.scale, size: viewport / v.scale };
}
