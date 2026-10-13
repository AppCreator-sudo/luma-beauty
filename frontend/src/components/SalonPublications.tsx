import { useHistoryState } from '../lib/useHistoryState';
import { useRef, useState } from 'react';
import { Pencil, Trash2 } from 'lucide-react';
import { api, type Performer, type SalonPublication } from '../lib/api';
import { useResource } from '../lib/useResource';
import { ErrorState, Loading } from './Shell';
import { WorkUpload } from './WorkUpload';
import '../salon-owner-flow.css';
export function SalonPublications({ workspaceId, team, initialTarget = 'salon', onChange, reference = false }: {
    reference?: boolean;
    workspaceId: string;
    team: Performer[];
    initialTarget?: string;
    onChange: () => void;
}) {
    const endpoint = '/salons/' + workspaceId + '/publications';
    const resource = useResource(() => api<SalonPublication[]>(endpoint), [workspaceId]);
    const [creating, setCreating] = useHistoryState('publication-create-' + workspaceId, false, { flow: true }), [galleryTarget, setGalleryTarget] = useState('all');
    const [target, setTarget] = useState(initialTarget), [kind, setKind] = useState('space');
    const [editingId, setEditingId] = useHistoryState<string | null>('publication-edit-' + workspaceId, null, { flow: true });
    const editing = resource.data?.find(item => item.id === editingId) || null;
    const setEditing = (item: SalonPublication | null) => setEditingId(item?.id || null);
    const [error, setError] = useState(''), [removing, setRemoving] = useState('');
    const removingRef = useRef(false);
    const person = team.find(p => p.id === target), salon = target === 'salon';
    const items = (resource.data || []).filter(p => reference ? galleryTarget === 'all' || p.publication_target === galleryTarget : p.publication_target === target);
    async function remove(p: SalonPublication) {
        if (removingRef.current || !confirm('Удалить публикацию?'))
            return;
        removingRef.current = true;
        setRemoving(p.id);
        setError('');
        try {
            await api(endpoint + '/' + p.id, { method: 'DELETE' });
        }
        catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Не удалось удалить публикацию');
            removingRef.current = false;
            setRemoving('');
            return;
        }
        if (editing?.id === p.id)
            setEditing(null);
        resource.setData(current => current?.filter(item => item.id !== p.id) || []);
        try {
            await resource.reload();
            await onChange();
        }
        catch {
            setError('Публикация удалена. Обновите кабинет, чтобы увидеть изменения.');
        }
        finally {
            removingRef.current = false;
            setRemoving('');
        }
    }
    const selector = <><label>Публикация для<select aria-label="Публикация для" value={target} disabled={Boolean(editing)} onChange={e => { setTarget(e.target.value); setError(''); }}><option value="salon">Салона</option>{team.map(p => <option key={p.id} value={p.id}>{p.name}{p.bookable ? '' : ' · скрыт от клиентов'}</option>)}</select></label><input type="hidden" name="performer_id" value={salon ? '' : target}/>{salon ? <label>Вид публикации<select aria-label="Вид публикации" name="post_kind" value={kind} onChange={e => setKind(e.target.value)}><option value="space">Интерьер и атмосфера</option><option value="news">Новость салона</option></select></label> : <p className="muted">Работа появится в портфолио {person?.name} и общей галерее салона. Запись будет вести к этому мастеру.</p>}</>;
    return <div className={'salon-publications' + (reference ? ' salon-publication-reference' : '') + (reference && (creating || editing) ? ' has-form' : '')}>
    {reference ? <div className="salon-publication-controls"><label>Показать<select aria-label="Фильтр публикаций" value={galleryTarget} onChange={e => setGalleryTarget(e.target.value)}><option value="all">Все публикации</option><option value="salon">Салон</option>{team.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button className="button button-wine" onClick={() => { setTarget(galleryTarget === 'all' ? initialTarget : galleryTarget); setEditing(null); setCreating(!creating); }}> {creating ? 'Закрыть форму' : '+ Добавить публикацию'}</button></div> : null}
    {(!reference || creating || editing) ? <section className="salon-publication-editor">
    <WorkUpload navigationKey={target + kind} reference={reference} key={editing?.id || 'new'} services={person?.services || []} serviceEndpoint={person ? '/performers/' + person.id + '/services' : '/services'} endpoint={endpoint} requireService={!salon} selector={selector} validateSelection={() => salon || person ? undefined : 'Выберите автора публикации'} contextSummary={<><p>Для: {salon ? 'салона' : person?.name}</p>{salon ? <p>Вид: {kind === 'news' ? 'Новость салона' : 'Интерьер и атмосфера'}</p> : null}</>} existing={editing || undefined} onCancel={editing ? () => { setEditing(null); setCreating(false); } : undefined} onDone={async () => { setEditing(null); setCreating(false); await resource.reload(); await onChange(); }}/>
    </section> : null}
    <section className="salon-publication-gallery"><div className="salon-portfolio-heading"><h3>{reference ? 'Галерея публикаций' : salon ? 'Публикации салона' : 'Портфолио ' + person?.name}</h3><span>Публикаций: {items.length}</span></div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}{resource.error ? <ErrorState message={resource.error} retry={resource.reload}/> : null}
    {resource.loading && !resource.data ? <Loading /> : items.length ? <div className="salon-owner-publication-list">{items.map(p => <article key={p.id}><img src={p.image} alt={p.caption} loading="lazy"/><div><p>{p.caption}</p><small>{p.master_name ? p.master_name + ' · ' : ''}{p.service_name || (p.kind === 'news' ? 'Новость салона' : 'Интерьер и атмосфера')}</small><div><button type="button" aria-label={'Редактировать: ' + p.caption} className="text-link" onClick={() => { setEditing(p); setTarget(p.publication_target); setCreating(true); setKind(p.kind === 'news' ? 'news' : 'space'); document.querySelector('.salon-publication-editor, .salon-publications')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'instant' : 'smooth', block: 'start' }); }}><Pencil size={16}/>Редактировать</button><button type="button" className="text-link" disabled={Boolean(removing)} aria-label={'Удалить: ' + p.caption} onClick={() => void remove(p)}><Trash2 size={16}/>Удалить</button></div></div></article>)}</div> : <p className="muted">Сохранённые публикации появятся здесь.</p>}
    </section>
  </div>;
}
