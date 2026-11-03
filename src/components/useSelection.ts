import { MouseEvent, useRef, useState } from 'react';

/** 勾選清單：支援按住 Shift 勾選一整段、全選目前顯示的項目。 */
export function useSelection<T extends { id: string }>(shown: T[]) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const last = useRef<number | null>(null);

  function toggle(e: MouseEvent<HTMLInputElement>, index: number) {
    const id = shown[index].id;
    const next = new Set(sel);
    const on = !sel.has(id);
    if (e.shiftKey && last.current !== null) {
      const [a, b] = [last.current, index].sort((x, y) => x - y);
      for (let i = a; i <= b && i < shown.length; i++) on ? next.add(shown[i].id) : next.delete(shown[i].id);
    } else {
      on ? next.add(id) : next.delete(id);
    }
    last.current = index;
    setSel(next);
  }

  function selectShown(on: boolean) {
    const next = new Set(sel);
    for (const x of shown) on ? next.add(x.id) : next.delete(x.id);
    setSel(next);
  }

  const selectedShown = shown.filter((x) => sel.has(x.id)).length;
  return { sel, setSel, toggle, selectShown, selectedShown, allShown: shown.length > 0 && selectedShown === shown.length };
}
