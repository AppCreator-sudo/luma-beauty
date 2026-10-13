import {useRef,useState,type FormEvent} from 'react';
import {Bell} from 'lucide-react';
import {api,json} from '../lib/api';
export function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [message, setMessage] = useState('');
  const [busy,setBusy]=useState(false),sending=useRef(false);
  async function submit(event: FormEvent) { event.preventDefault();if(sending.current)return;sending.current=true;setBusy(true);try { await json('/account/password', 'PUT', { current_password: current, new_password: next }); setMessage('Пароль обновлён'); setCurrent(''); setNext(''); } catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось обновить пароль'); }finally{sending.current=false;setBusy(false)} }
  return <form className="settings-form" onSubmit={submit}><h3>Сменить пароль</h3><label>Текущий пароль<input type="password" value={current} onChange={event => setCurrent(event.target.value)} autoComplete="current-password" required/></label><label>Новый пароль<input type="password" value={next} onChange={event => setNext(event.target.value)} autoComplete="new-password" minLength={10} required/></label>{message ? <p role="status">{message}</p> : null}<button className="button button-wine" disabled={busy}>{busy?'Сохраняем…':'Сохранить пароль'}</button></form>;
}

function base64ToBytes(value: string) { const pad = '='.repeat((4 - value.length % 4) % 4); return Uint8Array.from(atob((value + pad).replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); }
export function PushButton() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function enable() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) { setMessage('На этом устройстве push-уведомления недоступны.'); return; }
    setBusy(true);
    try { const permission = await Notification.requestPermission(); if (permission !== 'granted') throw Error('Разрешите уведомления в браузере.'); const registration = await navigator.serviceWorker.ready; const { publicKey } = await api<{ publicKey: string }>('/push/key'); let subscription = await registration.pushManager.getSubscription(); if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64ToBytes(publicKey) }); await json('/push/subscribe', 'POST', subscription.toJSON()); setMessage('Уведомления включены.'); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'Не удалось включить уведомления'); }
    finally { setBusy(false); }
  }
  return <><button className="button button-outline" onClick={enable} disabled={busy}><Bell size={16}/> Включить уведомления</button>{message ? <p role="status">{message}</p> : null}</>;
}
