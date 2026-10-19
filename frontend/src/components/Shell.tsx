import { createContext, useContext, useEffect, useState, useRef, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { ArrowUpRight, Heart, Menu, UserRound, X } from 'lucide-react';
import { api, cabinetPath, type Me } from '../lib/api';
import '../navigation-glass.css';
import '../interface-motion.css';
import '../public-profile-motion.css';
import '../avatar-layout.css';
import { PublicHeader } from './PublicHeader';
import { Brand } from './Brand';
import { MenuOverlay, NavigationMenuContent } from './MenuOverlay';
import { useHistoryState } from '../lib/useHistoryState';

type AppContextValue = { me: Me | null; refreshMe: () => Promise<void> };
const AppContext = createContext<AppContextValue>({ me: null, refreshMe: async () => {} });
export const useApp = () => useContext(AppContext);

const primary = [
  { to: '/masters', label: 'Мастера' },
  { to: '/inspiration', label: 'Вдохновение' },
  { to: '/map', label: 'Карта' },
];
export function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useHistoryState('shell-menu', false, { flow: true, transient: true });
  const menuToggle = useRef<HTMLButtonElement>(null);
  const location = useLocation();
  const isHome = location.pathname === '/v2/' || location.pathname === '/';
  const refreshMe = async () => setMe(await api<Me>('/me'));
  useEffect(() => { void refreshMe().catch(() => setMe({ user: null, profile: null, providers: { yandex: false, vk: false, telegram: false } })); }, []);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [location.pathname]);
  const clientReference=location.pathname==='/me';
  const standaloneCabinet = (clientReference&&me?.user?.account_type==='client') || (['/studio','/calendar'].includes(location.pathname) && me?.user?.account_type === 'master' && Boolean(me.profile)) || (location.pathname === '/salon' && Boolean(me?.workspaces?.some(w => w.kind === 'salon' && w.role === 'owner')));
  const bookingReference = /^\/book\/[^/]+\/?$/.test(location.pathname) || /^\/s\/[^/]+\/book\/?$/.test(location.pathname) || location.pathname === '/visit';
  const mapReference = location.pathname === '/map';
  const publicReference = (clientReference&&!standaloneCabinet) || bookingReference || /^\/(m|s|w)\/[^/]+\/?$/.test(location.pathname) || ['/masters', '/inspiration', '/auth'].includes(location.pathname) || (!standaloneCabinet && ['/access','/join','/studio','/calendar','/salon'].includes(location.pathname)) || mapReference;
  const accountTo = cabinetPath(me);
  const accountLabel = accountTo === '/salon' ? 'Салон' : accountTo === '/studio' ? 'Студия' : me?.user ? 'Моё' : 'Войти';
  return <AppContext.Provider value={{ me, refreshMe }}>
    <a className="skip-link" href="#main">К содержимому</a>
    {publicReference ? <PublicHeader me={me}/> : null}
    {!standaloneCabinet && !publicReference ? <header className={`site-header navigation-glass${isHome ? ' home-navigation' : ''}`}>
      <div className="header-inner">
        <button ref={isHome ? undefined : menuToggle} className="icon-link mobile-menu-toggle" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={22}/> : <Menu size={22}/>}</button>
        <Brand/>
        <nav className="desktop-nav" aria-label="Основная навигация">{primary.map(item => <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>{item.label}</NavLink>)}</nav>
        <div className="header-actions"><Link className="header-ghost" to="/me" aria-label="Сохранённое"><Heart size={20}/></Link><Link className="header-account" to={accountTo}><UserRound size={17}/><span>{accountLabel}</span><ArrowUpRight size={15}/></Link></div>
        {isHome ? <button ref={menuToggle} className="home-menu-toggle" type="button" aria-label={menuOpen ? 'Закрыть навигацию' : 'Открыть навигацию'} aria-expanded={menuOpen} aria-controls="home-navigation-menu" onClick={() => setMenuOpen(value => !value)}>{menuOpen ? <X size={21}/> : <Menu size={21}/>}</button> : null}
      </div>
      <MenuOverlay open={menuOpen} close={() => setMenuOpen(false)} trigger={menuToggle} id="home-navigation-menu" label="Навигация Luma Beauty"><NavigationMenuContent accountTo={accountTo} accountLabel={accountLabel} signedIn={Boolean(me?.user)}/></MenuOverlay>
    </header> : null}
    <main id="main" className={mapReference ? 'map-reference-main' : undefined}><Outlet/></main>
    {!standaloneCabinet && !bookingReference && !clientReference ? <footer className={'site-footer'+(publicReference?' public-reference-footer':'')}><div><Brand/><p>Красота начинается с человека.</p></div><nav aria-label="Навигация внизу страницы"><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link><Link to="/studio">Открыть студию</Link></nav><span>© {new Date().getFullYear()} Luma Beauty</span></footer> : null}

  </AppContext.Provider>;
}


export function Loading({ text = 'Открываем пространство…' }: { text?: string }) { return <div className="page-state"><div className="state-mark">L</div><p>{text}</p></div>; }
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) { return <div className="page-state"><span className="eyebrow">ЧТО-ТО ПОШЛО НЕ ТАК</span><h2>Не удалось открыть страницу</h2><p>{message}</p>{retry ? <button className="button button-dark" onClick={retry}>Попробовать ещё раз</button> : <Link className="button button-dark" to="/">На главную</Link>}</div>; }
export function EmptyState({ title, text, children }: { title: string; text: string; children?: ReactNode }) { return <div className="empty-state"><div className="empty-star">✳</div><h3>{title}</h3><p>{text}</p>{children}</div>; }
