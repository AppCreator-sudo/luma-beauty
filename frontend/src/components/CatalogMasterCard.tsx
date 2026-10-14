import { Link } from 'react-router-dom';
import { ArrowUpRight, CalendarDays, MapPin, Star } from 'lucide-react';
import { bookingPath, profilePath, masterDate, masterTime, money, type Profile } from '../lib/api';
import { PromotionBadge } from './PromotionBadge';
import '../compact-catalog.css';

function teamLabel(count: number) {
  const last = count % 10;
  const teen = count % 100 >= 11 && count % 100 <= 14;
  return count + ' ' + (teen ? 'мастеров' : last === 1 ? 'мастер' : last >= 2 && last <= 4 ? 'мастера' : 'мастеров');
}

export function CatalogMasterCard({ profile }: { profile: Profile }) {
  const salon = profile.kind === 'salon';
  const staff = profile.kind === 'staff';
  const canBook = !profile.is_demo && profile.services?.length > 0;
  const directions = (profile.categories?.length ? profile.categories : [profile.category]).filter(Boolean).join(' · ');
  const image = salon ? profile.logo || profile.avatar : profile.avatar;
  const detailPath = profilePath(profile);
  const bookPath = bookingPath(profile);
  const nextPath = bookPath + (bookPath.includes('?') ? '&' : '?') + 'start=' + profile.next_available;
  const match = profile.matching_staff?.[0];

  return <article className={'compact-master-card compact-master-card-' + (salon ? 'salon' : staff ? 'staff' : 'personal') + (profile.promotion ? ' compact-master-card-promoted' : '')} data-catalog-id={(profile.kind || 'master') + ':' + profile.user_id}>
    <div className="compact-master-identity">
      <Link to={detailPath} className="compact-master-avatar" aria-label={'Открыть страницу ' + profile.name}>
        {image ? <img src={image} alt="" loading="lazy" width="84" height="84"/> : <span aria-hidden="true">{Array.from(profile.name.trim())[0] || 'а'}</span>}
      </Link>
      <div className="compact-master-copy">
        <div className="compact-master-tags"><span className="compact-master-kind">{salon ? 'Салон' : staff ? 'Мастер салона' : 'Индивидуальный мастер'}</span>{profile.teaches ? <span className="compact-master-training">{salon?'Обучаем':'Обучаю'}</span> : null}</div>
        <h3><Link to={detailPath} title={profile.name}>{profile.name}</Link></h3>
        <p className="compact-master-location">{profile.city ? <span><MapPin size={13} aria-hidden="true"/>{profile.city}</span> : null}{salon ? <span>{teamLabel(profile.staff?.length || 0)}</span> : staff && profile.salon_name ? <span>{profile.salon_name}</span> : null}</p>
        <p className="compact-master-directions" title={directions}>{directions || (salon ? 'Услуги команды' : 'Услуги мастера')}</p>
        <p className="compact-master-rating"><Star size={14} aria-hidden="true"/><span>{profile.rating ? profile.rating.toFixed(1) : 'Пока без оценок'}{profile.review_count ? ' · ' + profile.review_count + ' отзывов' : ''}</span></p>
      </div>
    </div>
    {salon && match ? <Link className="compact-master-match" to={'/s/' + profile.slug + '?master=' + encodeURIComponent(match.id) + '#works'}>В команде: {profile.matching_staff?.map(person => person.name).join(' · ')}<ArrowUpRight size={15} aria-hidden="true"/></Link> : null}
    <PromotionBadge promotion={profile.promotion}/>
    <div className="compact-master-footer">
      {profile.next_available && canBook ? <Link className="compact-master-next" to={nextPath}><CalendarDays size={15} aria-hidden="true"/><span>{masterDate(profile.next_available, profile.schedule?.utc_offset)} · {masterTime(profile.next_available, profile.schedule?.utc_offset)}</span><ArrowUpRight size={14} aria-hidden="true"/></Link> : null}
      <div className="compact-master-actions"><p className="compact-master-price">{profile.services?.length ? 'От ' + money(Math.min(...profile.services.map(service => service.price))) : 'Услуги пока не добавлены'}</p><Link className={'compact-master-book' + (canBook ? '' : ' compact-master-details')} to={canBook ? bookPath : detailPath} aria-label={(canBook ? salon ? 'Записаться в ' : 'Записаться к ' : 'Открыть страницу ') + profile.name}>{canBook ? 'Записаться' : 'Подробнее'}<ArrowUpRight size={16} aria-hidden="true"/></Link></div>
    </div>
  </article>;
}
