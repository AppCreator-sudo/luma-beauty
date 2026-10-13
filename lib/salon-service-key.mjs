import {createHash} from 'node:crypto';

// The same offer identity connects grouped salon services and staff work links.
export function salonServiceKey({name,price,duration}){
  return createHash('sha256').update(JSON.stringify([name.toLocaleLowerCase('ru-RU').replace(/\s+/g,' ').trim(),price,duration])).digest('hex');
}
