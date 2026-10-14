import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { json, type Workspace } from '../lib/api';
import { AddressFields, addressChanged, addressValueFromStored, type AddressValue } from '../components/AddressFields';
import { ImageUploadField } from '../components/SalonVisual';
import {AppearanceThemePicker,type Theme, CabinetIdentity } from '../components/AppearanceEditor';
import '../salon-cabinet.css';

export function SalonSettings({ workspace: w, onDone }: { workspace: Workspace; onDone: (notice?: string) => void }) {
  const [name, setName] = useState(w.name); const [slug, setSlug] = useState(w.slug || ''); const [bio, setBio] = useState(w.bio || '');
  const [addressValue, setAddressValue] = useState<AddressValue>(() => addressValueFromStored({ city: w.city, address: w.address || '', latitude: w.latitude ?? null, longitude: w.longitude ?? null }));
  const [savedAddress, setSavedAddress] = useState(addressValue);
  const [offset, setOffset] = useState(w.utc_offset || 180); const [published, setPublished] = useState(Boolean(w.published));
  const [theme,setTheme]=useState<Theme>(w.theme||'green');
  const [teaches,setTeaches]=useState(Boolean(w.teaches)),[models,setModels]=useState(Boolean(w.looking_models));
  const [logo, setLogo] = useState(w.logo || ''), [cover, setCover] = useState(w.cover || '');
  const [error, setError] = useState(''); const [saved, setSaved] = useState(false); const [busy, setBusy] = useState(false); const [addressBusy, setAddressBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (submitting.current || addressBusy) return; submitting.current = true; setSaved(false); setError('');
    setBusy(true);
    try { await json('/salons/' + w.id + '/page', 'PUT', { name, slug, bio, theme, teaches, looking_models:models, address_mode: 'preserve', utc_offset: offset, published }); setSaved(true); onDone(addressChanged(addressValue, savedAddress) ? 'Страница сохранена. Адрес сохраните отдельно.' : 'Страница сохранена.'); }
    catch (r) { setError(r instanceof Error ? r.message : 'Не удалось сохранить страницу'); } finally { submitting.current = false; setBusy(false); }
  }
  return <section className="studio-panel salon-page-settings"><div className="section-head compact"><div><span className="eyebrow">СТРАНИЦА ДЛЯ КЛИЕНТОВ</span><h2>О вашем <em>салоне.</em></h2></div>{w.slug ? <Link className="button button-outline" to={'/s/' + w.slug}>Посмотреть страницу</Link> : null}</div>
    <h3 className="salon-settings-heading">Оформление</h3><div className="salon-appearance-grid"><div className="salon-appearance-controls"><ImageUploadField kind="avatar" label="Логотип салона" image={logo} endpoint={'/salons/' + w.id + '/logo'} disabled={busy} onSaved={image => { setLogo(image); onDone('Логотип сохранён.'); }}/><ImageUploadField kind="cover" label="Обложка / фон страницы" image={cover} endpoint={'/salons/' + w.id + '/cover'} disabled={busy} onSaved={image => { setCover(image); onDone('Обложка сохранена.'); }}/><p>Фотографии сохраняются сразу после загрузки. Без обложки используется стандартный фон салона.</p></div><div className="salon-appearance-preview"><span className="eyebrow">ПРЕДПРОСМОТР</span><CabinetIdentity name={name} image={logo} cover={cover} theme={theme} kind="salon" teaches={teaches} models={models} address={[addressValue.city,addressValue.address].filter(Boolean).join(', ')}/><p>Предпросмотр оформления. Отзывы, услуги и команда отображаются на публичной странице.</p></div></div>
    <h3 className="salon-settings-heading">Данные страницы</h3><form className="settings-form salon-page-form" onSubmit={submit} aria-busy={busy}>
      <AppearanceThemePicker value={theme} onChange={value=>{setTheme(value);setSaved(false)}} disabled={busy}/><p>Цвет применяется, когда обложка не загружена. Сохраните выбор кнопкой «Сохранить страницу».</p>
      <fieldset className="teaching-picker"><legend>Отметки страницы</legend><label><input type="checkbox" checked={teaches} disabled={busy} onChange={e=>{setTeaches(e.target.checked);setSaved(false)}}/><span>Обучаем</span></label><label><input type="checkbox" checked={models} disabled={busy} onChange={e=>{setModels(e.target.checked);setSaved(false)}}/><span>Ищем моделей</span></label><p>Отметки появятся рядом с названием салона. Условия обучения и работы с моделями согласуются отдельно.</p></fieldset>
      <div className="form-row"><label>Название салона<input value={name} onChange={e => { setName(e.target.value); setSaved(false); }} maxLength={80} required disabled={busy}/></label><label>Адрес страницы<input value={slug} onChange={e => { setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g,'')); setSaved(false); }} placeholder="my-salon" minLength={3} maxLength={40} required disabled={busy}/></label></div>
      <label>О салоне<textarea value={bio} onChange={e => { setBio(e.target.value); setSaved(false); }} maxLength={1500} rows={3} disabled={busy}/></label>
      <AddressFields value={addressValue} saveEndpoint={'/salons/' + w.id + '/address'} onStart={() => setError('')} onChange={next => { setError(''); setSaved(false); setAddressValue(next); }} onSaved={next => { setError(''); setSaved(false); setAddressValue(next); setSavedAddress(next); }} onBusy={setAddressBusy} busy={busy}/>
      <label>Часовой пояс салона<select value={offset} onChange={e => { setOffset(Number(e.target.value)); setSaved(false); }} disabled={busy}>{Array.from({length:11},(_,i)=>(i+2)*60).map(o=><option value={o} key={o}>UTC+{o/60}</option>)}</select></label>
      <p>Клиент видит время салона. Проверьте часовой пояс и рабочие часы каждого сотрудника в разделе «График».</p>
      <label className="checkbox-line"><input type="checkbox" checked={published} onChange={e=>{setPublished(e.target.checked);setSaved(false);}} disabled={busy}/> Страница видна клиентам</label>
      <p>Для публикации добавьте услуги и график, затем включите «Онлайн-запись» в карточках нужных сотрудников.</p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}{saved ? <p role="status">Страница сохранена</p> : null}
      <button className="button button-dark" disabled={busy || addressBusy}>{busy ? 'Сохраняем…' : 'Сохранить страницу'}</button>
    </form>
  </section>;
}
