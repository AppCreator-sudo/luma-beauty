import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { json } from '../lib/api';
import { useResource } from '../lib/useResource';
import { ErrorState, Loading, useApp } from '../components/Shell';
import { AuthPage } from './Auth';

export function JoinPage() {
  const { me, refreshMe } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  // Invitation is kept in the fragment and memory, never browser storage or query strings.
  const token = location.hash.slice(1);
  const resource = useResource(() => json<{ name: string; salon_name: string }>('/invitations/preview', 'POST', { token }), [token]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function accept() {
    setBusy(true); setError('');
    try { await json('/invitations/accept', 'POST', { token }); await refreshMe(); navigate('/salon', { replace: true }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось принять приглашение'); setBusy(false); }
  }
  if (!me || resource.loading) return <Loading text="Проверяем приглашение…"/>;
  if (resource.error || !resource.data) return <ErrorState message={resource.error || 'Приглашение недействительно'}/>;
  const invitation = resource.data;
  return <>
    <section className="container page-content"><div className="editorial-heading"><span className="eyebrow">ПРИГЛАШЕНИЕ В КОМАНДУ</span><h1>{invitation.salon_name}</h1><p>Вы получите доступ к календарю сотрудника «{invitation.name}».</p>{me.user ? <>
      <p>Вы вошли как {me.user.login}.</p><button className="text-link" onClick={async () => { await json('/auth/logout', 'POST', {}); await refreshMe(); }}>Войти другим аккаунтом</button>
      {error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button button-wine" disabled={busy} onClick={accept}>{busy ? 'Присоединяем…' : 'Присоединиться к салону'}</button>
    </> : null}</div></section>
    {!me.user ? <AuthPage returnTo={'/join#' + token}/> : null}
  </>;
}
