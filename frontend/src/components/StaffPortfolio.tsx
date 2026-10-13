import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { api, type Performer, type Work } from '../lib/api';
import { useResource } from '../lib/useResource';
import { ErrorState, Loading } from './Shell';
import { WorkUpload } from './WorkUpload';
import '../salon-cabinet.css';

export function StaffPortfolio({ staff, onChange }: { staff: Performer; onChange: () => void }) {
  const endpoint = '/performers/' + staff.id + '/works';
  const resource = useResource(() => api<Work[]>(endpoint), [staff.id]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState('');
  const removingRef = useRef(false);

  async function remove(work: Work) {
    if (removingRef.current || !confirm('Удалить эту работу из портфолио?')) return;
    removingRef.current = true; setRemoving(work.id); setError(''); setNotice('');
    try {
      await api(endpoint + '/' + work.id, { method: 'DELETE' });
      resource.setData(current => current?.filter(item => item.id !== work.id) || []);
      setNotice('Работа удалена из портфолио.');
      void resource.reload();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось удалить работу'); }
    finally { removingRef.current = false; setRemoving(''); }
  }

  return <div className="salon-portfolio">
    <WorkUpload services={staff.services} endpoint={endpoint} serviceEndpoint={'/performers/' + staff.id + '/services'} onDone={() => { setError(''); setNotice(''); void resource.reload(); onChange(); }}/>
    <div className="salon-portfolio-heading"><h3>Портфолио {staff.name}</h3><span>Работ: {resource.data?.length ?? 0}</span></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {notice ? <p className="studio-action-notice" role="status">{notice}</p> : null}
    {resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : null}
    {resource.loading && !resource.data ? <Loading text="Открываем портфолио…"/> : resource.data?.length ? <div className="salon-portfolio-grid">{resource.data.map(work => <article key={work.id}>
      <Link to={'/w/' + work.id} aria-label={'Посмотреть работу: ' + work.caption}><img src={work.image} alt={work.caption} loading="lazy"/></Link>
      <div><div><p>{work.caption}</p>{work.service_name ? <small>{work.service_name}</small> : null}{work.images && work.images.length > 1 ? <small>Фото: {work.images.length}</small> : null}</div><button type="button" aria-label={removing === work.id ? 'Удаляем работу' : 'Удалить работу: ' + work.caption} aria-busy={removing === work.id} disabled={Boolean(removing)} onClick={() => void remove(work)}><Trash2 size={17}/></button></div>
    </article>)}</div> : !resource.error ? <p className="salon-portfolio-empty">Сохранённые фотографии появятся здесь. Работы можно добавлять и для скрытого мастера.</p> : null}
  </div>;
}
