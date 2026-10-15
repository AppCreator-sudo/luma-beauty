import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, Heart, MapPin, MoveUpRight, Star } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { bookingPath, profilePath, masterDate, masterTime, servicePriceLabel, type Profile, type Work } from '../lib/api';
import { PromotionBadge } from './PromotionBadge';
import { SalonCardVisual } from './SalonVisual';
import '../catalog-concept.css';

export function PersonalCover({ cover, theme }: { cover?: string; theme?: string }) {
  const tone = theme === 'wine' || theme === 'green' ? theme : 'cream';
  return <span className={'personal-cover-art personal-cover-theme-' + tone + (cover ? ' has-image' : '')} aria-hidden="true">{cover ? <img className="personal-cover-photo" src={cover} alt="" loading="lazy"/> : <><span className="personal-cover-orbit"/><span className="personal-cover-line"/></>}</span>;
}

export function MasterCard({ profile, index = 0 }: { profile: Profile; index?: number }) {
  const salon = profile.kind === 'salon';
  const staff = profile.kind === 'staff';
  const reducedMotion = useReducedMotion();
  const canBook = !profile.is_demo && profile.services?.length > 0;
  const categories = (profile.categories?.length ? profile.categories : [profile.category]).filter(Boolean);
  return <motion.article className={'master-card identity-card ' + (salon ? 'identity-salon' : staff ? 'identity-staff' : 'identity-personal') + (profile.promotion ? ' master-card-promoted' : '')} initial={reducedMotion ? false : { opacity: 0, y: 18 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .1 }} transition={{ duration: reducedMotion ? 0 : .5, delay: reducedMotion ? 0 : Math.min(index, 5) * .06 }}>
    <Link to={profilePath(profile)} className={'master-cover' + (salon ? ' salon-card-cover' : '')} aria-label={'Открыть страницу ' + profile.name}>{salon ? <SalonCardVisual name={profile.name} logo={profile.logo || profile.avatar} cover={profile.cover}/> : <span className="identity-personal-art"><PersonalCover cover={staff ? profile.salon_cover : profile.cover} theme={staff ? 'green' : profile.theme}/><span className="identity-personal-seam"/><span className="identity-portrait-shell">{profile.avatar ? <img src={profile.avatar} alt={'Фото ' + profile.name} loading="lazy"/> : <span className="identity-portrait-initial" aria-hidden="true">{Array.from(profile.name.trim())[0] || 'а'}</span>}</span></span>}<span className="image-arrow"><ArrowUpRight size={20}/></span></Link>
    <div className="identity-card-copy"><div className="master-caption"><div><span className="identity-kind">{salon ? 'Салон' : staff ? 'Мастер салона' : 'Индивидуальный мастер'}</span><h3><Link to={profilePath(profile)}>{profile.name}</Link></h3>{staff && profile.salon_name ? <p className="identity-salon-name">{profile.salon_name}</p> : null}{salon ? <p className="identity-salon-name">Мастеров: {profile.staff?.length || 0}</p> : null}{salon && profile.matching_staff?.length ? <p className="identity-match"><Link to={'/s/'+profile.slug+'?master='+profile.matching_staff[0].id+'#works'}>В команде: {profile.matching_staff.map(p=>p.name).join(' · ')}</Link></p> : null}<p className="identity-city"><MapPin size={13}/>{profile.city}</p></div></div>
    <div className="identity-social"><Star size={15}/><span>{profile.rating ? profile.rating.toFixed(1) : 'Пока без оценок'}{profile.review_count ? ' · '+profile.review_count+' отзывов' : ''}</span>{profile.teaches ? <span className="master-training-badge">Обучает</span> : null}</div>
    <p className="identity-directions">{categories.join(' · ') || (salon ? 'Услуги команды' : 'Услуги мастера')}</p>
    <PromotionBadge promotion={profile.promotion}/>
    <p className="master-price">{profile.services?.length ? servicePriceLabel(Math.min(...profile.services.map(service => service.price))) : 'Услуги пока не добавлены'}</p>
    <div className="identity-card-footer">{profile.next_available && canBook ? <Link className="master-available" to={bookingPath(profile) + (staff ? '&' : '?') + 'start=' + profile.next_available}><CalendarDays size={17}/><span>{masterDate(profile.next_available, profile.schedule?.utc_offset)} · {masterTime(profile.next_available, profile.schedule?.utc_offset)}</span><ArrowUpRight size={15}/></Link> : <p className="identity-time"><CalendarDays size={17}/>{profile.is_demo ? 'Пример оформления' : 'Выберите время при записи'}</p>}<Link className={'button full ' + (canBook ? 'button-wine' : 'button-outline')} to={canBook ? bookingPath(profile) : profilePath(profile)}>{canBook ? 'Записаться' : 'Посмотреть страницу'}<ArrowUpRight size={17}/></Link></div>
    </div>
  </motion.article>;
}

export function WorkCard({ work, index = 0, showMaster = true }: { work: Work; index?: number; showMaster?: boolean }) {
  const authorPath = work.salon_slug ? '/s/' + work.salon_slug + (work.performer_id ? '?master='+encodeURIComponent(work.performer_id)+'#works' : '') : '/m/' + work.slug;
  return <motion.article className={'work-card work-card-' + (index % 7)} initial={{ opacity: 0, y: 22 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: .1 }} transition={{ duration: .55, delay: Math.min(index, 4) * .05 }}>
    <Link to={'/w/' + work.id} className="work-image"><img src={work.image} alt={work.caption || 'Работа мастера'} loading="lazy"/><span className="work-overlay"><span>{work.caption || work.service_name || 'История в деталях'}</span><MoveUpRight size={22}/></span></Link>
    {showMaster ? <div className="work-byline"><Link to={authorPath}>{work.avatar ? <img src={work.avatar} alt=""/> : <span className="mini-avatar">{Array.from(work.master_name?.trim() || 'а')[0]}</span>}<span>{work.master_name}{work.salon_name ? <small className="work-salon-name">{work.salon_name}</small> : null}</span></Link><span><MapPin size={13}/>{work.city}</span></div> : null}
  </motion.article>;
}

export function SavedButton({ saved, onClick, disabled = false }: { saved?: boolean; onClick: () => void; disabled?: boolean }) { return <button type="button" className={'round-action' + (saved ? ' selected' : '')} aria-label={saved ? 'Убрать из сохранённых' : 'Сохранить работу'} aria-pressed={Boolean(saved)} onClick={onClick} disabled={disabled}><Heart size={19} fill={saved ? 'currentColor' : 'none'}/></button>; }
