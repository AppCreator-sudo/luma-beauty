const DAY=86400000;
export function validScheduleDate(value){
  return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
}
export function normalizeSchedulePattern(value){
  const mode=value.mode??'weekly';
  if(!['weekly','cycle'].includes(mode))throw Error('Выберите тип графика');
  const result={mode,cycle_start:value.cycle_start||'',work_days:value.work_days??2,rest_days:value.rest_days??2,weekdays:[...new Set(value.weekdays||[])],exceptions:[]};
  if(!Number.isInteger(result.work_days)||!Number.isInteger(result.rest_days)||result.work_days<1||result.work_days>31||result.rest_days<1||result.rest_days>31)throw Error('Укажите от 1 до 31 рабочего и выходного дня');
  if(mode==='cycle'&&(!validScheduleDate(result.cycle_start)||!Number.isInteger(result.work_days)||!Number.isInteger(result.rest_days)||result.work_days<1||result.work_days>31||result.rest_days<1||result.rest_days>31))throw Error('Укажите начало цикла и от 1 до 31 рабочего и выходного дня');
  const exceptions=value.exceptions??[];
  if(!Array.isArray(exceptions)||exceptions.length>366)throw Error('Допустимо не больше 366 изменений отдельных дат');
  const dates=new Set();
  for(const item of exceptions){
    if(!item||!validScheduleDate(item.date)||dates.has(item.date)||typeof item.working!=='boolean')throw Error('Проверьте даты изменений графика: каждая дата указывается один раз');
    dates.add(item.date);
    const opening=item.opening??value.opening,closing=item.closing??value.closing;
    if(item.working&&(!Number.isInteger(opening)||!Number.isInteger(closing)||opening<0||closing>1440||opening>=closing))throw Error('Проверьте часы отдельной даты');
    result.exceptions.push(item.working?{date:item.date,working:true,opening,closing}:{date:item.date,working:false});
  }
  result.exceptions.sort((a,b)=>a.date.localeCompare(b.date));
  return result;
}
export function scheduleDayHours(config,date){
  const exception=config.exceptions?.find(item=>item.date===date);
  if(exception)return exception.working?{opening:exception.opening??config.opening,closing:exception.closing??config.closing}:null;
  if(config.mode==='cycle'){
    if(!validScheduleDate(config.cycle_start)||!config.work_days||!config.rest_days)return null;
    const delta=Math.round((Date.parse(date)-Date.parse(config.cycle_start))/DAY),length=config.work_days+config.rest_days;
    if(((delta%length)+length)%length>=config.work_days)return null;
  }else if(!config.weekdays.includes(new Date(date+'T00:00:00Z').getUTCDay()))return null;
  return {opening:config.opening,closing:config.closing};
}
export function scheduleHasWork(config){return config.mode==='cycle'||Boolean(config.weekdays?.length)||Boolean(config.exceptions?.some(item=>item.working))}
