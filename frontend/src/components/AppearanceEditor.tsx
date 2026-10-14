import { useRef, useState, type FormEvent } from 'react';
import {ArrowRight,Heart,Share2,Palette} from 'lucide-react';
import {PublicPageCover,PublicPageIdentity} from './PublicPageIdentity';
import { json, type Profile } from '../lib/api';
import { ImageUploadField, StaffPortrait } from './SalonVisual';
import '../cabinet-appearance.css';

const themes = [
  { value: 'cream', label: 'Светлый' },
  { value: 'wine', label: 'Винный' },
  { value: 'green', label: 'Зелёный' }
] as const;
export type Theme = typeof themes[number]['value'];
const themeValue = (value?: string): Theme => themes.some(theme => theme.value === value) ? value as Theme : 'cream';

export function AppearanceThemePicker({value,onChange,disabled=false}:{value:Theme;onChange:(value:Theme)=>void;disabled?:boolean}) {
  return <fieldset disabled={disabled}><legend>Цвет фона</legend><div className="appearance-theme-options">{themes.map(item=><label className={'appearance-theme-choice appearance-theme-'+item.value} key={item.value}><input type="radio" name="appearance-theme" value={item.value} checked={value===item.value} onChange={()=>onChange(item.value)}/><span className="appearance-theme-swatch" aria-hidden="true"/><span>{item.label}</span></label>)}</div></fieldset>;
}

export function CabinetIdentity({ name, image, cover, theme, kind, salonName, logo, onEdit, heading = 'h3', description, teaches, models, address, categories }: {
  name: string; image?: string; cover?: string; theme?: string; kind: 'personal' | 'salon' | 'staff';
  salonName?: string; logo?: string; onEdit?: () => void; heading?: 'h1' | 'h3'; description?: string; teaches?:number|boolean;models?:number|boolean;address?:string;categories?:string[];
}) {
  const Heading = heading;
  if(kind!=='staff')return <section className="public-reference public-page-shell public-page-preview" aria-label="Предпросмотр оформления страницы">
    <PublicPageCover cover={cover} theme={themeValue(theme||(kind==='salon'?'green':'cream'))}>{onEdit?<button type="button" className="button button-outline cabinet-edit-appearance" onClick={onEdit}><Palette size={16}/> Оформление</button>:null}</PublicPageCover>
    <div className="public-content"><PublicPageIdentity name={name} image={image} salon={kind==='salon'} heading={heading} teaches={teaches} models={models} address={address} categories={categories} showRating={false} actions={<><span className="button button-wine">Записаться <ArrowRight size={17}/></span><span className="public-icon" aria-hidden="true"><Heart size={20}/></span><span className="public-icon" aria-hidden="true"><Share2 size={19}/></span></>}/></div>
  </section>;
  return <section className={'cabinet-identity cabinet-identity-' + kind + ' appearance-theme-' + themeValue(theme)} aria-label="Оформление страницы">
    <div className="cabinet-identity-cover">{cover ? <img src={cover} alt=""/> : <span className="cabinet-cover-pattern" aria-hidden="true"/>}{onEdit ? <button type="button" className="button button-outline cabinet-edit-appearance" onClick={onEdit}><Palette size={16}/> Оформление</button> : null}</div>
    <div className="cabinet-identity-content">
      {kind === 'staff' ? <div className="cabinet-staff-portrait"><StaffPortrait name={name} image={image} salonName={salonName || ''} logo={logo}/></div> : <div className="cabinet-identity-avatar">{image ? <img src={image} alt={'Фото ' + name}/> : <span aria-hidden="true">{name.trim().slice(0, 1) || 'а'}</span>}</div>}
      <div className="cabinet-identity-copy"><span className="eyebrow">{'МАСТЕР САЛОНА'}</span><Heading>{name}</Heading><p>{description || (kind === 'staff' ? salonName : 'Мастер салона')}</p></div>
    </div>
  </section>;
}

export function PersonalAppearance({ profile, onDone }: { profile: Profile; onDone: () => void }) {
  const [avatar, setAvatar] = useState(profile.avatar || '');
  const [cover, setCover] = useState(profile.cover || '');
  const [theme, setTheme] = useState<Theme>(() => themeValue(profile.theme));
  const [savedTheme, setSavedTheme] = useState(theme);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const submitting = useRef(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError(''); setNotice('');
    try { await json('/profile/appearance', 'PATCH', { theme }); setSavedTheme(theme); setNotice('Цвет фона сохранён.'); onDone(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить оформление'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <section className="studio-panel appearance-panel"><div className="section-head compact"><div><span className="eyebrow">ВАШ ЛИЧНЫЙ СТИЛЬ</span><h2>Оформление <em>страницы.</em></h2></div></div><p className="appearance-intro">Фото мастера и фон меняются отдельно. Предпросмотр показывает их сочетание; выбранный цвет используется, когда обложка не загружена.</p>
    <div className="appearance-editor-grid"><div className="appearance-controls">
      <ImageUploadField kind="avatar" label="Фото мастера" image={avatar} endpoint="/avatar" disabled={busy} onSaved={image => { setAvatar(image); onDone(); }}/>
      <ImageUploadField kind="cover" label="Обложка / фон страницы" image={cover} endpoint="/profile/cover" disabled={busy} onSaved={image => { setCover(image); onDone(); }}/>
      <form onSubmit={save} className="appearance-theme-form" aria-busy={busy}><AppearanceThemePicker value={theme} onChange={value=>{setTheme(value);setNotice('')}} disabled={busy}/>{error ? <p className="form-error" role="alert">{error}</p> : null}{notice ? <p role="status">{notice}</p> : null}<button className="button button-wine" disabled={busy || theme === savedTheme}>{busy ? 'Сохраняем…' : 'Сохранить цвет фона'}</button></form>
    </div><div className="appearance-live-preview"><span className="eyebrow">ПРЕДПРОСМОТР</span><CabinetIdentity name={profile.name} image={avatar} cover={cover} theme={theme} kind="personal" teaches={profile.teaches} models={profile.looking_models} address={[profile.city,profile.address].filter(Boolean).join(', ')} categories={profile.categories}/><p className="muted">Фотографии сохраняются сразу после загрузки. Цвет — кнопкой «Сохранить цвет фона».</p></div></div>
  </section>;
}
