import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Search, UserRound, X } from 'lucide-react';
import { cabinetPath, type Me } from '../lib/api';
import { Brand } from './Brand';
import { MenuOverlay, NavigationMenuContent } from './MenuOverlay';
import { useHistoryState } from '../lib/useHistoryState';
import '../public-reference.css';

export function PublicHeader({ me }: { me: Me | null }) {
  const [open, setOpen] = useHistoryState('public-menu', false, { flow: true, transient: true });
  const toggle = useRef<HTMLButtonElement>(null);
  const account = cabinetPath(me);
  const links = <><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link></>;
  return <header className="public-reference-header"><div className="public-header-inner"><Brand/><nav aria-label="Основная навигация">{links}</nav><div className="public-header-actions"><Link to="/masters?focus=search" aria-label="Поиск мастеров и салонов"><Search size={21}/></Link><Link className="public-header-account" to={account}><UserRound size={19}/><span>{me?.user ? 'Кабинет' : 'Войти'}</span></Link><button ref={toggle} className="public-menu-toggle" type="button" aria-expanded={open} aria-controls="public-reference-menu" aria-label={open ? 'Закрыть меню' : 'Открыть меню'} onClick={() => setOpen(v => !v)}>{open ? <X/> : <Menu/>}</button></div></div><MenuOverlay open={open} close={() => setOpen(false)} trigger={toggle} id="public-reference-menu" label="Навигация Luma Beauty"><NavigationMenuContent accountTo={account} accountLabel={me?.user ? 'Кабинет' : 'Войти'} signedIn={Boolean(me?.user)}/></MenuOverlay></header>;
}
