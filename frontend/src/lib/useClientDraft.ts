import {useEffect,useRef,useState,type Dispatch,type SetStateAction,type MutableRefObject} from 'react';

// Private form input lives only in this tab's memory. Never put it in history,
// URLs, localStorage or sessionStorage. A reload intentionally drops drafts.
const drafts=new Map<string,unknown>();
let activeGuard:((event:PopStateEvent)=>void)|undefined;
// This module is loaded by main before the router installs its listener.
if(typeof window!=='undefined')window.addEventListener('popstate',event=>activeGuard?.(event),true);
export function clearClientDrafts(){drafts.clear()}
export function useClientDraft<T>(key:string,initial:T,kind:string):[T,Dispatch<SetStateAction<T>>,(value?:T)=>void,(action:()=>void)=>void] {
  const [value,setValue]=useState<T>(()=>(drafts.get(key) as T|undefined)??initial);
  const baseline=useRef(initial),dirty=useRef(false);dirty.current=JSON.stringify(value)!==JSON.stringify(baseline.current);
  const set:Dispatch<SetStateAction<T>>=action=>setValue(previous=>{const next=typeof action==='function'?(action as (p:T)=>T)(previous):action;drafts.set(key,next);return next});
  const commit=(next=value)=>{baseline.current=next;dirty.current=false;drafts.delete(key);setValue(next)};
  const leave=useClientExitGuard(dirty,kind,key);
  return [value,set,commit,leave];
}

export function useClientExitGuard(dirty:MutableRefObject<boolean>,kind:string,key:string,message='Есть несохранённые изменения. Покинуть форму? Введённые данные останутся в этой вкладке до её перезагрузки.') {
  const confirmLeave=()=>!dirty.current||window.confirm(message);
  const leave=(action:()=>void)=>{if(confirmLeave())action()};
  useEffect(()=>{
    const beforeUnload=(event:BeforeUnloadEvent)=>{if(dirty.current){event.preventDefault();event.returnValue=''}};
    let currentIndex=Number(history.state?.idx||0),restoring=false;
    const pop=(event:PopStateEvent)=>{
      const targetKind=event.state?.usr?.lumaNavigation?.values['/me:client-view']?.kind;
      if(restoring||targetKind===kind){currentIndex=Number(history.state?.idx||0);restoring=false;return}
      if(!confirmLeave()){const delta=currentIndex-Number(history.state?.idx||0);if(delta){event.stopImmediatePropagation();restoring=true;history.go(delta)}}
    };
    const click=(event:MouseEvent)=>{
      if(!dirty.current||event.defaultPrevented||event.ctrlKey||event.metaKey||event.shiftKey)return;
      const target=event.target as Element,link=target.closest<HTMLAnchorElement>('a[href]');
      const leavingLink=link&&link.target!=='_blank'&&new URL(link.href).href!==location.href;
      const sectionButton=target.closest('.cabinet-sidebar nav button,.cabinet-account-menu button,.client-notification-toggle');
      if((leavingLink||sectionButton)&&!confirmLeave()){event.preventDefault();event.stopPropagation()}
    };
    activeGuard=pop;
    window.addEventListener('beforeunload',beforeUnload);document.addEventListener('click',click,true);
    return()=>{if(activeGuard===pop)activeGuard=undefined;window.removeEventListener('beforeunload',beforeUnload);document.removeEventListener('click',click,true)};
    // The guard reads the latest input through a ref and is mounted for this form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[kind,key]);
  return leave;
}
