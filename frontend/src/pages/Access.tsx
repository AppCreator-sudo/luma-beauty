import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Check, ShieldCheck } from 'lucide-react';
import { api, cabinetPath, json, type AuthProvider } from '../lib/api';
import { authError, providerNames } from '../lib/auth';
import { useResource } from '../lib/useResource';
import { useApp, Loading, ErrorState } from '../components/Shell';
import { PasswordForm } from '../components/AccountTools';

type Access = { password: boolean; recent: boolean; providers: { id: AuthProvider; ready: boolean; linked: boolean }[] };

export function AccessPage() {
  const { me } = useApp();
  const [params] = useSearchParams();
  const resource = useResource(() => me?.user ? api<Access>('/account/access') : Promise.resolve(null), [me?.user?.id]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(() => authError(params.get('auth_error')));
  const [message, setMessage] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [password, setPassword] = useState('');
  const linked = params.get('linked');
  async function connect(provider: AuthProvider, reauth=false) {
    setBusy(true); setError('');
    try { const result = await json<{url:string}>('/account/access/' + provider + (reauth ? '/reauth' : '/start'), 'POST', {}); window.location.assign(result.url); }
    catch(reason) { setError(reason instanceof Error ? reason.message : 'Не удалось начать подключение'); setBusy(false); resource.reload(); }
  }
  async function verifyPassword(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await json('/account/access/password/reauth','POST',{password}); setPassword(''); await resource.reload(); setMessage('Вход подтверждён. Можно подключить запасной способ.'); }
    catch(reason) { setError(reason instanceof Error ? reason.message : 'Не удалось подтвердить вход'); }
    finally { setBusy(false); }
  }
  async function revoke() {
    setBusy(true); setError(''); setMessage('');
    try { await json('/account/sessions/revoke','POST',{}); setConfirmRevoke(false); setMessage('На других устройствах выполнен выход. Здесь вы остаётесь в аккаунте.'); }
    catch(reason) { setError(reason instanceof Error ? reason.message : 'Не удалось завершить сессии'); }
    finally { setBusy(false); }
  }
  if (!me) return <Loading/>;
  if (!me.user) return <div className="container page-content"><div className="editorial-heading"><h1>Вход в <em>аккаунт.</em></h1><p>Войдите, чтобы настроить способы входа.</p><Link className="button button-wine" to="/auth?next=/access">Войти</Link></div></div>;
  return <div className="container page-content access-page"><Link className="text-link" to={cabinetPath(me)}><ArrowLeft size={16}/> Вернуться в кабинет</Link><div className="editorial-heading"><span className="eyebrow">ВАШ АККАУНТ</span><h1>Вход и <em>безопасность.</em></h1><p>Подключите запасной способ входа, чтобы возвращаться в тот же кабинет.</p></div>
    {resource.loading ? <Loading/> : resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : resource.data ? <div className="access-grid"><section className="studio-panel access-providers"><h2>Способы входа</h2><p>Добавляйте собственные аккаунты. После подтверждения в сервисе новый способ будет связан с вашим текущим кабинетом.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {!resource.data.recent ? <div className="access-verification"><h3>Подтвердите вход</h3><p>Перед подключением нового способа подтвердите, что это ваш аккаунт.</p>{resource.data.providers.filter(p=>p.linked&&p.ready).map(p=><button className="button button-outline full" disabled={busy} key={p.id} onClick={()=>connect(p.id,true)}>Подтвердить через {providerNames[p.id]}</button>)}{resource.data.password ? <form className="settings-form" onSubmit={verifyPassword}><label>Текущий пароль<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required maxLength={128}/></label><button className="button button-dark" disabled={busy}>Подтвердить вход</button></form> : null}</div> : null}
      {resource.data.providers.some(p=>p.id===linked&&p.linked) ? <p className="access-success" role="status"><Check size={17}/> Способ входа подключён.</p> : null}
      {resource.data.providers.map(provider=><div className="access-provider" key={provider.id}><div><strong>{providerNames[provider.id]}</strong><small>{provider.linked ? 'Подключён к вашему аккаунту' : provider.ready ? 'Можно подключить' : 'Пока недоступен'}</small></div>{provider.linked ? <span className="access-connected"><Check size={16}/> Подключён</span> : <button className="button button-outline" disabled={busy||!provider.ready||!resource.data?.recent} onClick={()=>connect(provider.id)}>Подключить</button>}</div>)}
      {!resource.data.providers.some(p=>p.linked) ? <p className="muted">Сейчас вы входите по логину и паролю. Подключите доступный сервис, чтобы пользоваться им для входа.</p> : null}
      {resource.data.password ? <PasswordForm/> : null}
    </section><section className="studio-panel access-sessions"><ShieldCheck size={26}/><h2>Ваши устройства</h2><p>Если входили на чужом устройстве, завершите остальные сессии. На этом устройстве вы останетесь в аккаунте.</p>
      {confirmRevoke ? <div className="access-confirm"><p>Завершить все остальные сессии?</p><button className="button button-wine" disabled={busy} onClick={revoke}>Да, завершить</button><button className="text-link" disabled={busy} onClick={()=>setConfirmRevoke(false)}>Отмена</button></div> : <button className="button button-outline" disabled={busy} onClick={()=>setConfirmRevoke(true)}>Выйти на других устройствах</button>}
      {message ? <p className="access-success" role="status">{message}</p> : null}
    </section></div> : null}
  </div>;
}
