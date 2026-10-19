import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowUpRight, X } from 'lucide-react';
import '../menu-overlay.css';

type MenuProps = { open: boolean; close: () => void; trigger: RefObject<HTMLButtonElement | null>; id: string; label: string; drawer?: boolean; children: ReactNode };
export const menuItemMotion = { hidden: { opacity: 0, x: 16 }, visible: { opacity: 1, x: 0, transition: { type: 'spring' as const, stiffness: 300, damping: 26 } } };

export function MenuOverlay(props: MenuProps) {
  return createPortal(<AnimatePresence>{props.open ? <MenuSurface key={props.id} {...props}/> : null}</AnimatePresence>, document.body);
}

function MenuSurface({ close, trigger, id, label, drawer, children }: MenuProps) {
  const dialog = useRef<HTMLDialogElement>(null), reduce = useReducedMotion(), navigate = useNavigate();
  const [rect, setRect] = useState(() => trigger.current?.getBoundingClientRect());
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width:800px)').matches);
  useLayoutEffect(() => {
    const update = () => { setRect(trigger.current?.getBoundingClientRect()); setCompact(window.matchMedia('(max-width:800px)').matches); };
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [trigger]);
  useLayoutEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const surface = dialog.current;
    const opener = trigger.current;
    const savedHtmlOverflow = html.style.overflow;
    const savedHtmlOverscroll = html.style.overscrollBehavior;
    const savedBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    html.style.overscrollBehavior = 'none';
    body.style.overflow = 'hidden';
    surface?.showModal();
    return () => {
      surface?.close();
      html.style.overflow = savedHtmlOverflow;
      html.style.overscrollBehavior = savedHtmlOverscroll;
      body.style.overflow = savedBodyOverflow;
      const restoreFocus = () => {
        if (opener?.isConnected) opener.focus({ preventScroll: true });
      };
      restoreFocus();
      requestAnimationFrame(restoreFocus);
      setTimeout(restoreFocus, 16);
      setTimeout(restoreFocus, 60);
    };
  }, [trigger]);
  const style = !drawer && rect ? {
    '--menu-anchor-top': Math.round(rect.bottom + 16) + 'px',
    '--menu-anchor-right': Math.max(16, Math.round(window.innerWidth - rect.right)) + 'px',
    '--menu-close-top': rect.top + 'px',
    '--menu-close-right': (window.innerWidth - rect.right) + 'px',
    '--menu-close-width': rect.width + 'px',
    '--menu-close-height': rect.height + 'px'
  } as CSSProperties : undefined;
  return <dialog ref={dialog} className={'luma-menu-layer' + (drawer ? ' luma-menu-drawer' : '')} aria-label={label} style={style} onCancel={event => { event.preventDefault(); close(); }} onClickCapture={event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
    if (!link || event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0 || link.target === '_blank') return;
    const url = new URL(link.href);
    if (url.origin !== location.origin || !url.pathname.startsWith('/v2/')) return;
    event.preventDefault();
    navigate(url.pathname.slice(3) + url.search + url.hash, { replace: true });
  }}>
    <motion.button className="luma-menu-scrim" aria-label="Закрыть меню" onClick={close} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduce ? 0 : compact ? .18 : .35 }} tabIndex={-1}/>
    <motion.div id={id} className={drawer ? 'luma-drawer-panel' : 'home-menu-panel luma-navigation-panel'} initial="hidden" animate="visible" exit="hidden" variants={compact ? {
      hidden: { opacity: 0, y: reduce ? 0 : -12, scale: reduce ? 1 : .98, transition: { duration: reduce ? 0 : .18 } },
      visible: { opacity: 1, y: 0, scale: 1, transition: { duration: reduce ? 0 : .22, ease: [.22, 1, .36, 1], delayChildren: .04, staggerChildren: .025 } },
    } : {
      hidden: { opacity: 0, y: reduce ? 0 : -38, scale: reduce ? 1 : .08, borderRadius: reduce ? 8 : 36, transition: { duration: reduce ? 0 : .24, ease: [.32, 0, .67, 0] } },
      visible: { opacity: 1, y: 0, scale: 1, borderRadius: 8, transition: reduce ? { duration: 0 } : { scale: { type: 'spring', stiffness: 260, damping: 24, mass: .9 }, y: { type: 'spring', stiffness: 260, damping: 24, mass: .9 }, opacity: { duration: .18 }, borderRadius: { duration: .5 }, delayChildren: .12, staggerChildren: .055 } },
    }}>
      {drawer ? <button className="luma-menu-close" aria-label="Закрыть меню" onClick={close}><X size={21}/></button> : null}
      {children}
    </motion.div>
    {!drawer ? <button className="luma-menu-close" aria-label="Закрыть меню" onClick={close}><X size={21}/></button> : null}
  </dialog>;
}

const MotionLink = motion.create(Link);
export function NavigationMenuContent({ accountTo, accountLabel, signedIn }: { accountTo: string; accountLabel: string; signedIn: boolean }) {
  const reduce = useReducedMotion();
  const items = [{ to: '/masters', label: 'Мастера' }, { to: '/inspiration', label: 'Вдохновение' }, { to: '/map', label: 'Карта' }, { to: accountTo, label: accountLabel }];
  return <><nav className="home-menu-links" aria-label="Разделы площадки">{items.map(item => <MotionLink key={item.to} variants={reduce ? {} : menuItemMotion} to={item.to}>{item.label}<ArrowUpRight size={18}/></MotionLink>)}</nav><motion.aside className="home-menu-note" variants={reduce ? {} : menuItemMotion}><span>ДЛЯ ПРОФЕССИОНАЛОВ</span><p>Ваше дело.<br/>Ваше пространство.</p><Link to={signedIn ? accountTo : '/studio'}>{signedIn ? 'Открыть кабинет' : 'Присоединиться'}<ArrowUpRight size={16}/></Link></motion.aside></>;
}
