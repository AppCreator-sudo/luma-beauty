import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { Heart } from 'lucide-react';
import { json, type Work } from '../lib/api';
import { useApp } from './Shell';

export function PublicWorkTile({ work, showAuthor = false, onSaved }: { work: Work; showAuthor?: boolean; onSaved?: (saved:boolean)=>void }) {
  const { me } = useApp(), navigate = useNavigate(), reduce = useReducedMotion();
  const [saved, setSaved] = useState(Boolean(work.saved)), [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function save() {
    if (!me?.user) { navigate('/auth?next=' + encodeURIComponent(location.pathname.replace(/^\/v2/, '') + location.search)); return; }
    setBusy(true); setError('');
    try { const result=await json<{ saved: boolean }>('/works/' + work.id + '/save', saved ? 'DELETE' : 'POST', {});setSaved(result.saved);onSaved?.(result.saved); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Не удалось сохранить'); }
    finally { setBusy(false); }
  }
  return <motion.article className="public-work-tile" initial={reduce ? false : { opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .05 }} transition={{ duration: reduce ? 0 : .4 }}><div className="public-work-photo"><Link to={'/w/' + work.id} aria-label={'Открыть работу: ' + (work.caption || work.service_name || 'Фото работы')}><img src={work.image} alt={work.caption || work.service_name || 'Работа мастера'} loading="lazy"/></Link></div><div className="public-work-footer"><Link className="public-work-caption" to={'/w/' + work.id}>{work.caption || work.service_name || 'Работа мастера'}</Link><button type="button" aria-label={saved ? 'Убрать из сохранённых' : 'Сохранить работу'} aria-pressed={saved} disabled={busy} onClick={() => void save()}><Heart size={18} fill={saved ? 'currentColor' : 'none'}/></button></div>{work.service_name ? <small>{work.service_name}</small> : null}{showAuthor && work.master_name ? <small>{work.master_name}</small> : null}{error ? <p className="form-error" role="alert">{error}</p> : null}</motion.article>;
}
