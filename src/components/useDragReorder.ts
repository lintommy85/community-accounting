import { DragEvent, useState } from 'react';

/** 表格列拖拉排序：拖曳把手（⋮⋮）移動整列，放開時呼叫 onMove(from, to)。 */
export function useDragReorder(onMove: (from: number, to: number) => void) {
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);

  const handleProps = (i: number) => ({
    draggable: true,
    title: '拖拉調整順序',
    className: 'drag-handle',
    onDragStart: (e: DragEvent<HTMLElement>) => {
      setDragging(i);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(i));
      const row = e.currentTarget.closest('tr');
      if (row) e.dataTransfer.setDragImage(row, 16, 16);
    },
    onDragEnd: () => {
      setDragging(null);
      setOver(null);
    },
  });

  const rowProps = (i: number) => ({
    className: [dragging === i ? 'dragging' : '', over === i && dragging !== null && dragging !== i ? (dragging < i ? 'drop-below' : 'drop-above') : ''].join(' ').trim(),
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (dragging === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (over !== i) setOver(i);
    },
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.preventDefault();
      if (dragging !== null && dragging !== i) onMove(dragging, i);
      setDragging(null);
      setOver(null);
    },
  });

  return { handleProps, rowProps };
}

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
