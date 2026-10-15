import '../profile-badges.css';

export function ProfileBadges({salon=false,staff=false,teaches,models,className=''}:{salon?:boolean;staff?:boolean;teaches?:number|boolean;models?:number|boolean;className?:string}) {
  return <div className={'profile-badges '+className}><span>{salon?'Салон':staff?'Мастер салона':'Индивидуальный мастер'}</span>{teaches?<span>{salon?'Обучаем':'Обучаю'}</span>:null}{models?<span>{salon?'Ищем моделей':'Ищу моделей'}</span>:null}</div>;
}
