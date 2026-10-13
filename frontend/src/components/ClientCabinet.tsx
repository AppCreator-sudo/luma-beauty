import {useEffect, useRef, type ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {Bell, CalendarDays, ChevronDown, Heart, Home, LogOut, Menu, Search, Settings, Star, Users, X} from 'lucide-react';
import {Brand, Branch} from './Brand';
import {Initial} from './MasterCabinet';
import {MenuOverlay} from './MenuOverlay';
import {useHistoryState} from '../lib/useHistoryState';
import type {ClientProfile} from '../lib/client';
import '../client-cabinet.css';

export type ClientTab='overview'|'visits'|'saved'|'masters'|'reviews'|'notifications'|'settings';
export const clientSections=[
  {key:'overview',label:'Обзор',Icon:Home}, {key:'visits',label:'Мои записи',Icon:CalendarDays},
  {key:'saved',label:'Сохранённое',Icon:Heart}, {key:'masters',label:'Мои мастера',Icon:Users},
  {key:'reviews',label:'Отзывы',Icon:Star}, {key:'notifications',label:'Уведомления',Icon:Bell},
  {key:'settings',label:'Настройки',Icon:Settings},
] as const;

export function ClientCabinet({profile,login,tab,select,unread,logout,children}:{profile:ClientProfile;login:string;tab:ClientTab;select:(tab:ClientTab)=>void;unread:number;logout:()=>void;children:ReactNode}) {
  const [menu,setMenu]=useHistoryState('client-menu',false,{flow:true,transient:true});
  const [account,setAccount]=useHistoryState('client-account',false,{flow:true,transient:true});
  const trigger=useRef<HTMLButtonElement>(null),accountArea=useRef<HTMLDivElement>(null);
  const name=profile.name||login;
  const choose=(next:ClientTab)=>{select(next);setMenu(false);setAccount(false)};
  useEffect(()=>{
    if(!account)return;
    const close=(event:KeyboardEvent)=>{if(event.key==='Escape')setAccount(false)};
    const outside=(event:PointerEvent)=>{if(!accountArea.current?.contains(event.target as Node))setAccount(false)};
    window.addEventListener('keydown',close);window.addEventListener('pointerdown',outside);
    return()=>{window.removeEventListener('keydown',close);window.removeEventListener('pointerdown',outside)};
  },[account,setAccount]);
  const sidebar=<aside className="cabinet-sidebar client-sidebar"><Brand/><div className="cabinet-owner"><Initial name={name} image={profile.avatar}/><h2>{name}</h2><p>Клиент</p></div><nav aria-label="Разделы кабинета клиента">{clientSections.map(({key,label,Icon})=><button key={key} type="button" className={tab===key?'active':''} aria-current={tab===key?'page':undefined} onClick={()=>choose(key)}><Icon size={21}/>{label}{key==='notifications'&&unread>0?<span className="client-unread-count">{unread}</span>:null}</button>)}</nav><div className="cabinet-sidebar-decoration"><Branch/></div><nav className="cabinet-mobile-links" aria-label="Разделы площадки"><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link></nav></aside>;
  return <div className="master-cabinet client-cabinet"><header className="cabinet-top"><div className="cabinet-mobile-brand"><Brand/></div><nav aria-label="Разделы площадки"><Link to="/masters">Мастера</Link><Link to="/inspiration">Вдохновение</Link><Link to="/map">Карта</Link></nav><div className="cabinet-top-actions"><Link to="/masters?focus=search" aria-label="Поиск мастеров и салонов"><Search size={21}/></Link><button type="button" className="client-notification-toggle" aria-label={'Уведомления'+(unread?', непрочитанных: '+unread:'')} onClick={()=>choose('notifications')}><Bell size={21}/>{unread>0?<i/>:null}</button><div className="cabinet-account" ref={accountArea}><button type="button" aria-label="Меню профиля" aria-expanded={account} onClick={()=>setAccount(value=>!value)}><Initial name={name} image={profile.avatar}/><span>{name}</span><ChevronDown size={16}/></button>{account?<div className="cabinet-account-menu"><button onClick={()=>choose('settings')}>Настройки аккаунта</button><button onClick={()=>{setAccount(false);logout()}}><LogOut size={16}/>Выйти</button></div>:null}</div><button ref={trigger} type="button" className="cabinet-menu-toggle" aria-label={menu?'Закрыть меню кабинета':'Открыть меню кабинета'} aria-expanded={menu} aria-controls="client-navigation" onClick={()=>setMenu(value=>!value)}>{menu?<X/>:<Menu/>}</button></div></header>{sidebar}<MenuOverlay open={menu} close={()=>setMenu(false)} trigger={trigger} id="client-navigation" label="Меню кабинета клиента" drawer>{sidebar}</MenuOverlay><div className="cabinet-body" inert={menu}>{children}</div></div>;
}

export function ClientHeading({title,accent,text,children}:{title:string;accent?:string;text?:string;children?:ReactNode}) {return <div className="client-heading"><div><h1 tabIndex={-1}>{title}{accent?<em> {accent}</em>:null}</h1>{text?<p>{text}</p>:null}</div>{children}</div>}
export function ClientEmpty({title,text,children}:{title:string;text:string;children?:ReactNode}) {return <div className="client-empty"><CalendarDays size={27}/><h2>{title}</h2><p>{text}</p>{children}</div>}
