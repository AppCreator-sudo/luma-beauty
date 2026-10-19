import { Fragment, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowRight, Eye, EyeOff, LockKeyhole } from 'lucide-react';
import { api, cabinetPath, json, type Me, type User } from '../lib/api';
import { authError, providerNames, providerOrder, safeAuthNext } from '../lib/auth';
import { useApp } from '../components/Shell';
import { useHistoryState } from '../lib/useHistoryState';
import '../auth-reference.css';

export function AuthPage({ returnTo }: { returnTo?: string }) {
  const { me, refreshMe } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [mode, setMode] = useHistoryState<'login' | 'register'>('auth-mode', 'login');
  const initialRole = params.get('role');
  const [role, setRole] = useState<User['account_type']>(initialRole === 'master' || initialRole === 'salon' ? initialRole : 'client');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [recovery, setRecovery] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(() => authError(params.get('auth_error')));
  const [busy, setBusy] = useState(false);
  const next = returnTo || params.get('next');
  const safeNext = safeAuthNext(next);
  const destination = safeNext || (role === 'salon' ? '/salon' : role === 'master' ? '/studio' : '/me');
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      if (mode === 'register') {
        const result = await json<{ recovery: string }>('/auth/register', 'POST', { login, password, account_type: role });
        if (!returnTo) await refreshMe();
        setRecovery(result.recovery);
      } else {
        await json('/auth/login', 'POST', { login, password });
        const signedIn = await api<Me>('/me'); await refreshMe(); navigate(safeNext || cabinetPath(signedIn));
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось войти'); }
    finally { setBusy(false); }
  }
  async function copyRecovery() { try { await navigator.clipboard.writeText(recovery); setCopied(true); setError(''); } catch { setError('Не удалось скопировать. Сохраните код вручную.'); } }
  if (me?.user && !recovery) return <div className="auth-page auth-reference auth-signed-in"><div className="auth-side"><div className="auth-card"><span className="eyebrow">ВЫ УЖЕ В LUMA BEAUTY</span><h1>Добро <em>пожаловать.</em></h1><Link className="button button-dark" to={safeNext || cabinetPath(me)}>Открыть кабинет <ArrowRight size={17}/></Link></div></div></div>;
  return <div className={'auth-page auth-reference' + (!recovery ? ' auth-entry' : '')}>
    <div className="auth-art"><span className="eyebrow">ЛИЧНОЕ ПРОСТРАНСТВО</span><div><h2>Ваше место<br/> <em>в мире красоты.</em></h2><p>Работы, люди и встречи, к которым хочется возвращаться.</p></div><span className="auth-art-end">Красота начинается с человека.</span></div>
    <div className="auth-side"><div className="auth-card">{recovery ? <>
      <span className="eyebrow">ВАЖНО СОХРАНИТЬ</span><h1>Ваш код <em>восстановления.</em></h1><p>Запишите код сейчас. Он понадобится, если вы забудете пароль. Повторно показать его мы не сможем.</p><code className="recovery-code">{recovery}</code><button className="button button-outline full" onClick={() => void copyRecovery()}>{copied ? 'Код скопирован' : 'Скопировать код'}</button>{error ? <p className="form-error" role="alert">{error}</p> : null}<button className="button button-dark full" onClick={async () => { await refreshMe(); navigate(destination); }}>Я сохранил код <ArrowRight size={17}/></button>
    </> : <>
      <div className="auth-intro"><span className="eyebrow">LUMA BEAUTY</span><div className="auth-intro-options">{(['login', 'register'] as const).map(option => <Fragment key={option}>
        <h1 className="auth-intro-title" aria-hidden={mode !== option}>{option === 'login' ? <>Снова <em>здравствуйте.</em></> : <>Создайте <em>пространство.</em></>}</h1>
        <p className="auth-intro-description" aria-hidden={mode !== option}>{returnTo ? 'Войдите или создайте аккаунт, чтобы принять приглашение в салон.' : option === 'login' ? 'Войдите, чтобы вернуться к своим работам и записям.' : 'Выберите, каким будет ваш кабинет. Запись к мастеру доступна и без регистрации.'}</p>
      </Fragment>)}</div></div>
      <div className="auth-tabs"><button className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setError(''); }}>Войти</button><button className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setError(''); }}>Создать аккаунт</button></div>
      {!returnTo ? <div className="auth-role-slot" aria-hidden={mode !== 'register'} inert={mode !== 'register'}><div className="role-picker" role="group" aria-label="Тип аккаунта">{([['client', 'Я клиент'], ['master', 'Я мастер'], ['salon', 'Мы салон']] as [User['account_type'], string][]).map(([value, label]) => <button type="button" key={value} className={role === value ? 'active' : ''} aria-pressed={role === value} onClick={() => setRole(value)} disabled={busy || mode !== 'register'}>{label}</button>)}</div></div> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="auth-provider-placeholders" aria-label="Будущие способы входа">{providerOrder.map(provider => <button type="button" key={provider} disabled aria-label={providerNames[provider] + ' — скоро'}><span>{providerNames[provider]}</span><small>Скоро</small></button>)}</div><p className="auth-provider-note">Эти способы входа скоро будут доступны.</p>
      <div className="auth-legacy-label">По логину и паролю</div><form className="auth-form" onSubmit={submit}>
        <label>Логин<input value={login} onChange={event => setLogin(event.target.value)} autoComplete="username" placeholder="Латинские буквы и цифры" minLength={3} maxLength={32} required/></label>
        <label>Пароль<div className="password-field"><input type={visible ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} placeholder={mode === 'login' ? 'Ваш пароль' : 'Не менее 10 символов'} minLength={mode === 'login' ? undefined : 10} required/><button type="button" aria-label={visible ? 'Скрыть пароль' : 'Показать пароль'} onClick={() => setVisible(value => !value)}>{visible ? <EyeOff size={18}/> : <Eye size={18}/>}</button></div></label>
        <button className="button button-wine full" disabled={busy}>{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Продолжить'} <ArrowRight size={17}/></button>
      </form>
      <p className="auth-note"><LockKeyhole size={15}/> Записаться к мастеру можно без аккаунта.</p>
    </>}</div></div>
  </div>;
}
