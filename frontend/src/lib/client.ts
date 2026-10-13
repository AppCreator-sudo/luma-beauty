import type {Appointment} from './api';
export type ClientProfile={name:string;contact:string;city:string;avatar:string};
export type ClientNotice={id:string;title:string;body:string;created:number;read_at:number|null;appointment_id:string|null};
export type Reschedule={id:string;start:number;end:number;comment:string;status:'pending'|'accepted'|'declined'|'withdrawn'|'closed';created:number;decided:number|null; base_start?:number; base_end?:number; utc_offset?:number|null};
export type ClientVisit=Appointment & {master_avatar?:string;salon_logo?:string;master_published?:number;salon_published?:number;city:string;address:string;client_comment?:string;service_id?:string;reference_image?:string;reference_caption?:string;review_text?:string;review_created?:number;reschedule:Reschedule|null};
export const providerLink=(visit:ClientVisit)=>visit.salon_slug?'/s/'+visit.salon_slug:visit.slug?'/m/'+visit.slug:'/masters';
export const repeatLink=(visit:ClientVisit)=>visit.salon_slug?'/s/'+visit.salon_slug+'/book?master='+encodeURIComponent(visit.master_id):visit.slug?'/book/'+visit.slug+(visit.service_id?'?service='+encodeURIComponent(visit.service_id):''):'/masters';
export const canRepeat=(visit:ClientVisit)=>visit.salon_slug?Boolean(visit.salon_published):Boolean(visit.master_published);
export const activeVisit=(visit:ClientVisit)=>['pending','confirmed'].includes(visit.status)&&visit.end>Date.now();

export function downloadJSON(data:unknown,name:string) {download(new Blob([JSON.stringify(data,null,2)],{type:'application/json;charset=utf-8'}),name)}
function download(blob:Blob,name:string){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
export function exportCalendar(visit:ClientVisit){
  const escape=(value:string)=>value.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const date=(time:number)=>new Date(time).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Luma Beauty//Appointments//RU','BEGIN:VEVENT','UID:'+visit.id+'@luma-beauty','DTSTAMP:'+date(Date.now()),'DTSTART:'+date(visit.start),'DTEND:'+date(visit.end),'SUMMARY:'+escape(visit.service+' · '+(visit.salon_name||visit.master_name||'Мастер')),'LOCATION:'+escape([visit.city,visit.address].filter(Boolean).join(', ')),'DESCRIPTION:'+escape('Время и статус проверяйте в кабинете Luma Beauty.'),'END:VEVENT','END:VCALENDAR'];
  // Fold UTF-8 at the iCalendar byte boundary; never split a multibyte character.
  const folded=lines.flatMap(line=>{const parts:string[]=[];let chunk='',length=0;for(const char of line){const bytes=new TextEncoder().encode(char).length;if(length+bytes>73){parts.push(chunk);chunk=' ';length=1}chunk+=char;length+=bytes}parts.push(chunk);return parts});
  download(new Blob([folded.join('\r\n')+'\r\n'],{type:'text/calendar;charset=utf-8'}),'luma-visit.ics');
}
