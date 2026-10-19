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
async function readyForPush() {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = 'Служба уведомлений недоступна. Обновите страницу и попробуйте ещё раз.';
  try {
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(unavailable)), 8000); }),
    ]);
    if (!registration.pushManager) throw new Error(unavailable);
    return registration;
  } catch { throw new Error(unavailable); }
  finally { clearTimeout(timer); }
}
export function PushButton() {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const sending = useRef(false);
  async function enable() {
    if (sending.current) return;
    if (!window.isSecureContext) { setMessage('Для уведомлений откройте сайт по защищённому соединению HTTPS.'); return; }
    if (!('serviceWorker' in navigator) || typeof PushManager === 'undefined' || typeof Notification === 'undefined' || typeof Notification.requestPermission !== 'function') { setMessage('На этом устройстве push-уведомления недоступны.'); return; }
    sending.current = true;
    setMessage('');
    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'denied') throw new Error('Уведомления заблокированы. Разрешите их в настройках браузера и повторите попытку.');
      if (permission !== 'granted') throw new Error('Разрешите уведомления в браузере.');
      const registration = await readyForPush();
      const { publicKey } = await api<{ publicKey: string }>('/push/key');
      let applicationServerKey: ReturnType<typeof base64ToBytes>;
      try {
        applicationServerKey = base64ToBytes(publicKey);
        if (applicationServerKey.length !== 65 || applicationServerKey[0] !== 4) throw new Error();
      } catch { throw new Error('Ключ уведомлений недоступен. Попробуйте ещё раз.'); }
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      await json('/push/subscribe', 'POST', subscription.toJSON());
      setMessage('Уведомления включены.');
    }
    catch (reason) { setMessage(reason instanceof Error && !(reason instanceof TypeError) && !(reason instanceof DOMException) ? reason.message : 'Не удалось включить уведомления. Проверьте соединение и попробуйте ещё раз.'); }
    finally { sending.current = false; setBusy(false); }
  }
  return <><button className="button button-outline" onClick={enable} disabled={busy} aria-busy={busy}><Bell size={16}/>{busy ? 'Включаем…' : 'Включить уведомления'}</button>{message ? <p role="status">{message}</p> : null}</>;
}
