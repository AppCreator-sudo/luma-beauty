import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowRight, X } from 'lucide-react';
import directions from '../../../lib/categories.json';

type Props = { open: boolean; category: string; soon: boolean; close: () => void; apply: (category: string, soon: boolean) => void; trigger: RefObject<HTMLButtonElement | null> };

export function MapFiltersSheet(props: Props) {
  return createPortal(<AnimatePresence>{props.open ? <FiltersSurface key="map-filters" {...props}/> : null}</AnimatePresence>, document.body);
}

function FiltersSurface({ category, soon, close, apply, trigger }: Props) {
  const [draftCategory, setCategory] = useState(category), [draftSoon, setSoon] = useState(soon);
  const dialog = useRef<HTMLDialogElement>(null), reduce = useReducedMotion();
  useLayoutEffect(() => {
    const surface = dialog.current, overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    surface?.showModal();
    return () => { surface?.close(); document.documentElement.style.overflow = overflow; trigger.current?.focus({ preventScroll: true }); };
  }, [trigger]);
  return <dialog ref={dialog} className="map-filter-dialog" aria-labelledby="map-filter-title" onCancel={event => { event.preventDefault(); close(); }} onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <motion.section className="map-filter-sheet" initial={{ y: reduce ? 0 : 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reduce ? 0 : 60, opacity: 0 }} transition={reduce ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 26 }}>
      <span className="map-filter-handle" aria-hidden="true"/>
      <button type="button" className="map-card-close" onClick={close} aria-label="Закрыть фильтры"><X size={20}/></button>
      <h2 id="map-filter-title">Фильтры</h2>
      <label className="map-filter-label" htmlFor="map-mobile-category">Направление</label>
      <select id="map-mobile-category" value={draftCategory} onChange={event => setCategory(event.target.value)}><option value="Все">Все услуги</option>{directions.map(value => <option key={value}>{value}</option>)}</select>
      <label className="map-soon"><input type="checkbox" checked={draftSoon} onChange={event => setSoon(event.target.checked)}/><span>Есть время в ближайший час</span></label>
      <p>Результаты обновляются в видимой области карты.</p>
      <div className="map-filter-actions"><button type="button" className="button button-wine" onClick={() => { apply(draftCategory, draftSoon); close(); }}>Показать результаты<ArrowRight size={18}/></button><button type="button" className="map-filter-reset" onClick={() => { setCategory('Все'); setSoon(false); }}>Сбросить фильтры</button></div>
    </motion.section>
  </dialog>;
}
