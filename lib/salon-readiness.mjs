import {activeServiceSQL} from './service-offers.mjs';
import {scheduleHasWork} from './schedule-patterns.mjs';
export function performerReadiness(db,id){
  const p=db.prepare('SELECT name,avatar FROM profiles WHERE user_id=?').get(id);
  const config=db.prepare('SELECT opening,closing,weekdays FROM master_schedules WHERE master_id=?').get(id);
  const missing=[];
  if(!p?.avatar)missing.push('фото');
  if(!p?.name?.trim())missing.push('имя');
  if(!db.prepare('SELECT 1 FROM profile_categories WHERE user_id=?').get(id))missing.push('направления');
  const pattern=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schedule_patterns'").get()?db.prepare('SELECT definition FROM schedule_patterns WHERE master_id=?').get(id):null;
  if(!config||!scheduleHasWork({...config,weekdays:JSON.parse(config.weekdays),...(pattern?JSON.parse(pattern.definition):{})})||config.closing<=config.opening)missing.push('рабочие дни и часы');
  if(!db.prepare(`SELECT 1 FROM services s WHERE s.user_id=? AND ${activeServiceSQL(db)}`).get(id))missing.push('услуга с ценой и длительностью');
  return {ready:missing.length===0,missing};
}
