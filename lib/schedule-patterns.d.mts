export type ScheduleException = {date:string;working:boolean;opening?:number;closing?:number};
export type ScheduleDefinition = {opening:number;closing:number;utc_offset:number;weekdays:number[];mode?:'weekly'|'cycle';cycle_start?:string;work_days?:number;rest_days?:number;exceptions?:ScheduleException[]};
export function validScheduleDate(value:unknown):boolean;
export function normalizeSchedulePattern(value:ScheduleDefinition):Pick<ScheduleDefinition,'mode'|'cycle_start'|'work_days'|'rest_days'|'exceptions'|'weekdays'>;
export function scheduleDayHours(config:ScheduleDefinition,date:string):{opening:number;closing:number}|null;
export function scheduleHasWork(config:ScheduleDefinition):boolean;
