import type {ReactNode} from 'react';
import {MapPin,Star} from 'lucide-react';
import type {Review} from '../lib/api';
import '../public-page-identity.css';
import {ProfileBadges} from './ProfileBadges';

export function PublicPageCover({cover,theme='green',children}:{cover?:string;theme?:string;children?:ReactNode}) {
  return <div className={'public-cover public-cover-'+theme+(cover?' public-cover-photo':'')}>
    {cover?<img src={cover} alt=""/>:<div className="public-cover-pattern"/>}
    <div className="public-cover-heading"><span>ВАШЕ ПРОСТРАНСТВО КРАСОТЫ</span><p>Красота<br/><em>в деталях.</em></p></div>{children}
  </div>;
}

export function PublicPageIdentity({name,image,salon=false,teaches,models,address,categories,rating,count=0,reviews,actions,heading='h1',showRating=true,imageControls}:{
  name:string;image?:string;salon?:boolean;teaches?:number|boolean;models?:number|boolean;address?:string;categories?:string[];
  rating?:number|null;count?:number;reviews?:()=>void;actions?:ReactNode;heading?:'h1'|'h3';showRating?:boolean;imageControls?:ReactNode;
}) {
  const Heading=heading;
  return <section className="public-identity"><div className="public-avatar">{image?<img src={image} alt={(salon?'Логотип ':'Фото ')+name}/>:<span aria-hidden="true">{Array.from(name.trim())[0]||'L'}</span>}{imageControls}</div>
    <Heading className="public-identity-title">{name}</Heading><div className="public-identity-copy"><ProfileBadges className="public-kind" salon={salon} teaches={teaches} models={models}/><div className="public-profile-meta">{address?<p className="public-address"><MapPin size={14}/><span>{address}</span></p>:null}{categories?.length?<p className="public-categories">{categories.join(' · ')}</p>:null}</div>
      {showRating?<p className="public-rating"><Star size={15}/><span>{rating?rating.toFixed(1):'Пока без оценок'}</span>{count?(reviews?<button type="button" onClick={reviews}>{count} отзывов</button>:<span>· {count} отзывов</span>):null}</p>:null}
    </div>{actions?<div className="public-identity-actions">{actions}</div>:null}
  </section>;
}

export function PublicReviews({reviews=[]}:{reviews?:Review[]}) {
  return <>{reviews.length?<div className="public-reviews">{reviews.map(r=><article key={r.id}><span className="public-rating" aria-label={'Оценка '+r.rating+' из 5'}>{'★'.repeat(r.rating)}</span><p>{r.text||'Клиент оценил визит.'}</p><small>{r.service} · {new Date(r.created).toLocaleDateString('ru-RU')}</small></article>)}</div>:<div className="public-muted"><h3>Отзывов пока нет</h3><p>Они появятся после завершённых визитов.</p></div>}</>;
}
