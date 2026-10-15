import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, ArrowUpRight } from 'lucide-react';
import { api, json, servicePriceLabel, type Profile, type Work } from '../lib/api';
import { useResource } from '../lib/useResource';
import { useApp, Loading, ErrorState } from '../components/Shell';
import { SavedButton } from '../components/Cards';
import '../catalog-reference.css';


export { ProfilePage } from './PublicMaster';

export function WorkPage() {
  const { id = '' } = useParams();
  const { me } = useApp();
  const navigate = useNavigate();
  const resource = useResource(() => api<Work & { services: Profile['services']; following?: boolean }>('/works/' + encodeURIComponent(id)), [id]);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false), [saveError, setSaveError] = useState('');
  useEffect(() => { setIndex(0); setSaveError(''); }, [id]);
  const work = resource.data;
  async function toggleSaved() {
    if (!work || busy) return;
    if (!me?.user) { navigate('/auth?next=' + encodeURIComponent('/w/' + id)); return; }
    setBusy(true); setSaveError('');
    try { const result = await json<{ saved: boolean }>('/works/' + id + '/save', work.saved ? 'DELETE' : 'POST', {}); resource.setData({ ...work, saved: result.saved }); }
    catch (error) { setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить'); }
    finally { setBusy(false); }
  }
  if (resource.loading) return <Loading/>;
  if (resource.error || !work) return <ErrorState message={resource.error || 'Работа не найдена'} retry={resource.reload}/>;
  const photos = work.images?.length ? work.images : [{ id: work.id, image: work.image }];
  const authorPath = work.salon_slug ? '/s/' + work.salon_slug + (work.performer_id ? '?master=' + encodeURIComponent(work.performer_id) + '#works' : '') : '/m/' + work.slug;
  const salonParams = new URLSearchParams();
  if (work.performer_id) salonParams.set('master', work.performer_id);
  if (work.salon_service_id) salonParams.set('service', work.salon_service_id);
  const bookPath = work.salon_slug ? '/s/' + work.salon_slug + '/book' + (salonParams.size ? '?' + salonParams : '') : '/book/' + work.slug + (work.service_id ? '?service=' + work.service_id + '&work=' + id : '?work=' + id);
  return <div className="container work-detail reference-work"><Link className="back-link" to={authorPath}><ArrowLeft size={16}/> {work.salon_slug ? 'Страница салона' : 'Страница мастера'}</Link><div className="work-detail-grid"><div className="work-gallery"><div className="work-main-image"><img src={photos[index]?.image} alt={work.caption || 'Работа мастера'}/></div>{photos.length > 1 ? <div className="work-thumbs">{photos.map((photo, number) => <button type="button" key={photo.id} className={index === number ? 'active' : ''} onClick={() => setIndex(number)} aria-label={'Фото ' + (number + 1)} aria-pressed={index === number}><img src={photo.image} alt=""/></button>)}</div> : null}</div><div className="work-detail-copy"><h1>{work.caption || work.service_name || 'Работа мастера'}</h1><Link to={authorPath} className="work-master-line">{work.avatar ? <img src={work.avatar} alt=""/> : <span className="mini-avatar">{Array.from(work.master_name?.trim() || 'L')[0]}</span>}<span><strong>{work.master_name}</strong><small>{[work.salon_name || work.category, work.city].filter(Boolean).join(' · ')}</small></span><ArrowUpRight size={17}/></Link>{work.service_name ? <div className="work-service"><span>Связанная услуга</span><strong>{work.service_name}</strong><p>{typeof work.service_duration === 'number' ? work.service_duration + ' мин' : ''}{typeof work.service_price === 'number' ? ' · ' + servicePriceLabel(work.service_price) : ''}</p></div> : null}<div className="work-actions"><Link className="button button-wine" to={bookPath}>{work.salon_slug ? 'Записаться в салон' : 'Записаться к мастеру'} <ArrowRight size={17}/></Link><SavedButton saved={work.saved} onClick={toggleSaved} disabled={busy}/></div>{saveError ? <p role="alert" className="work-save-error">{saveError}</p> : null}</div></div></div>;
}
