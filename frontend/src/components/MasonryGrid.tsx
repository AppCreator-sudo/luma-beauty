import { useLayoutEffect, useRef, type ReactNode, type MouseEventHandler } from 'react';

export function MasonryGrid({ children, onClickCapture }: { children: ReactNode; onClickCapture?: MouseEventHandler<HTMLDivElement> }) {
  const grid = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = grid.current;
    if (!element) return;
    let frame = 0;
    const layout = () => {
      const columns = Number(getComputedStyle(element).getPropertyValue('--masonry-columns')) || 4;
      const gap = Number(getComputedStyle(element).getPropertyValue('--masonry-gap')) || 16;
      const width = (element.clientWidth - gap * (columns - 1)) / columns;
      const items = Array.from(element.children) as HTMLElement[];
      items.forEach(item => { item.style.width = width + 'px'; });
      const heights = Array(columns).fill(0) as number[];
      items.forEach(item => {
        const column = heights.indexOf(Math.min(...heights));
        item.style.left = column * (width + gap) + 'px'; item.style.top = heights[column] + 'px';
        heights[column] += item.getBoundingClientRect().height + gap;
      });
      element.style.height = Math.max(0, ...heights) - (items.length ? gap : 0) + 'px';
      element.dataset.ready = 'true';
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(layout); };
    layout();
    const observer = new ResizeObserver(schedule);
    observer.observe(element); Array.from(element.children).forEach(child => observer.observe(child));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [children]);
  return <div className="reference-masonry" ref={grid} onClickCapture={onClickCapture}>{children}</div>;
}
