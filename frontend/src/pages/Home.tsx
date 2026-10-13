import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowDown, ArrowUpRight } from 'lucide-react';
import '../home-entry.css';

const scenes = [
  { eyebrow: 'КРАСОТА РЯДОМ', lead: 'Найдите пространство, в котором вам хорошо.' },
  { eyebrow: 'ВАШ МОМЕНТ', lead: 'Выберите специалиста и удобное время.' },
  { eyebrow: 'ВАША ИСТОРИЯ', lead: 'Начните с человека, который понимает вас.' },
];
const words = ['Красота', 'начинается с', 'человека.'];

export function HomePage() {
  const [scene, setScene] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    document.documentElement.classList.add('home-motion-document');
    document.body.classList.add('home-motion-body');
    let wheelDelta = 0;
    let wheelDirection = 0;
    let lastWheel = 0;
    let lastStep = -Infinity;
    let touchStart: { x: number; y: number } | null = null;
    const menuOpen = () => !!document.querySelector('.home-menu-panel');
    const move = (direction: number) => setScene(current => Math.max(0, Math.min(scenes.length - 1, current + direction)));
    const onWheel = (event: WheelEvent) => {
      if (menuOpen() || event.ctrlKey) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight : 1);
      if (Math.abs(delta) < 1) return;
      const now = performance.now();
      const direction = Math.sign(delta);
      const reversed = direction !== wheelDirection;
      const freshGesture = now - lastWheel > 220;
      if (reversed || freshGesture) wheelDelta = 0;
      wheelDirection = direction;
      lastWheel = now;
      // Reverse immediately; same-direction momentum cannot skip scenes.
      if (!reversed && !freshGesture && now - lastStep < 700) return;
      wheelDelta += delta;
      if (Math.abs(wheelDelta) >= 40) {
        move(direction);
        lastStep = now;
        wheelDelta = 0;
      }
    };
    const onTouchStart = (event: TouchEvent) => {
      if (menuOpen() || event.touches.length !== 1) { touchStart = null; return; }
      const touch = event.touches[0];
      // Leave edge gestures to the browser/system Back navigation.
      if (touch.clientX < 24 || touch.clientX > window.innerWidth - 24) { touchStart = null; return; }
      touchStart = { x: touch.clientX, y: touch.clientY };
    };
    const onTouchMove = (event: TouchEvent) => {
      if (touchStart && !menuOpen() && event.touches.length === 1) {
        const touch = event.touches[0];
        if (Math.abs(touch.clientY - touchStart.y) > Math.abs(touch.clientX - touchStart.x) * 1.15) event.preventDefault();
      }
    };
    const onTouchEnd = (event: TouchEvent) => {
      if (!touchStart || menuOpen()) { touchStart = null; return; }
      const touch = event.changedTouches[0];
      const dy = touchStart.y - touch.clientY;
      const dx = touchStart.x - touch.clientX;
      if (Math.abs(dy) > 44 && Math.abs(dy) > Math.abs(dx) * 1.15) move(Math.sign(dy));
      touchStart = null;
    };
    const onTouchCancel = () => { touchStart = null; };
    const onKeyDown = (event: KeyboardEvent) => {
      if (menuOpen() || (event.target as HTMLElement | null)?.closest('a,button,input,textarea,select,[contenteditable="true"]')) return;
      if (['ArrowDown', 'PageDown', ' '].includes(event.key)) { event.preventDefault(); move(1); }
      else if (['ArrowUp', 'PageUp'].includes(event.key)) { event.preventDefault(); move(-1); }
      else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); setScene(event.key === 'Home' ? 0 : scenes.length - 1); }
    };
    window.addEventListener('wheel', onWheel, { passive: false, capture: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
    window.addEventListener('touchend', onTouchEnd, { capture: true });
    window.addEventListener('touchcancel', onTouchCancel, { capture: true });
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.documentElement.classList.remove('home-motion-document');
      document.body.classList.remove('home-motion-body');
      window.removeEventListener('wheel', onWheel, true);
      window.removeEventListener('touchstart', onTouchStart, true);
      window.removeEventListener('touchmove', onTouchMove, true);
      window.removeEventListener('touchend', onTouchEnd, true);
      window.removeEventListener('touchcancel', onTouchCancel, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  return <section className="home-entry-page" data-scene={scene + 1} aria-label="Luma Beauty">
    <div className="home-scene-stage" aria-hidden="true">
      <img className="home-scene-image" src="/v2/hero-v2.webp" alt="" width="1672" height="941"/>
      {scenes.map((item, index) => <motion.div key={item.eyebrow} className={`home-scene home-scene-${index + 1}`} initial={false} animate={{ clipPath: index <= scene ? 'inset(0% 0 0 0)' : 'inset(100% 0 0 0)' }} transition={{ duration: reduceMotion ? 0 : .85, ease: [.22, 1, .36, 1] }}>
      </motion.div>)}
    </div>
    <div className="home-entry-copy">
      <p className="home-entry-kicker"><AnimatePresence initial={false}>
        <motion.span key={scene} initial={{ y: reduceMotion ? 0 : '100%', opacity: 0, filter: reduceMotion ? 'blur(0px)' : 'blur(4px)' }} animate={{ y: 0, opacity: 1, filter: 'blur(0px)' }} exit={{ y: reduceMotion ? 0 : '-100%', opacity: 0, filter: reduceMotion ? 'blur(0px)' : 'blur(4px)' }} transition={{ duration: reduceMotion ? 0 : .55, ease: [.22, 1, .36, 1] }}>{scenes[scene].eyebrow}</motion.span>
      </AnimatePresence></p>
      <h1 aria-label={words.slice(0, scene + 1).join(' ')}>
        {words.map((word, index) => <span className={`home-title-mask${index === 2 ? ' home-title-emphasis' : ''}`} key={word} aria-hidden={index > scene}>
          <motion.span className="home-title-line" initial={false} animate={{ y: index <= scene ? '0%' : '110%', opacity: index <= scene ? 1 : 0, filter: reduceMotion || index <= scene ? 'blur(0px)' : 'blur(5px)' }} transition={{ duration: reduceMotion ? 0 : .7, ease: [.22, 1, .36, 1], delay: reduceMotion ? 0 : .08 }}>{word}</motion.span>
        </span>)}
      </h1>
      <p className="home-entry-lead" aria-live="polite">{scenes[scene].lead}</p>
      <Link className="home-entry-primary" to="/masters">Найти мастера или салон<ArrowUpRight size={18} aria-hidden="true"/></Link>
    </div>
    <div className="home-scene-controls" role="group" aria-label="Сцены титульной страницы">
      {scenes.map((item, index) => <button key={item.eyebrow} type="button" className={index === scene ? 'active' : ''} aria-label={`Сцена ${index + 1}: ${item.eyebrow.toLowerCase()}`} aria-pressed={index === scene} onClick={() => setScene(index)}><span/></button>)}
      <span className="home-scene-count">0{scene + 1}<i>/</i>03</span>
    </div>
    <span className="home-scroll-hint"><span>scroll</span><ArrowDown size={32} strokeWidth={.8} aria-hidden="true"/></span>
    <div className="home-viewport-frame" aria-hidden="true"/>
  </section>;
}
