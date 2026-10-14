export type Service = { id: string; user_id: string; name: string; price: number; duration: number };
export type Photo = { id: string; image: string };
export type Work = {
  id: string; user_id: string; image: string; images?: Photo[]; caption: string;
  created: number; pinned?: number; saved?: boolean; service_id?: string | null;
  service_name?: string; service_price?: number; service_duration?: number;
  master_name?: string; slug?: string; city?: string; category?: string;
  avatar?: string; is_demo?: number; performer_id?: string; salon_id?: string; salon_slug?: string; salon_name?: string; salon_service_id?: string;
};
export type Slot = { id: string; start: number; end: number };
export type Schedule = { opening: number; closing: number; utc_offset: number; weekdays: number[] };
export type Review = { id: string; rating: number; text: string; created: number; service: string };
export type Promotion = { label: 'Реклама'; until: number; advertiser: string; erid: string };
export type Profile = {
  kind?: 'master' | 'salon' | 'staff';
  salon_id?: string; salon_slug?: string; salon_name?: string; salon_logo?: string; salon_cover?: string;
  staff?: {id: string; name: string}[]; matching_staff?: {id: string; name: string}[];
  user_id: string; slug: string; name: string; city: string; category: string; categories?: string[]; teaches?: number; looking_models?: number; saved?: boolean;
  bio: string; avatar: string; logo?: string; cover?: string; theme?: 'cream' | 'wine' | 'green'; address?: string; latitude?: number | null;
  longitude?: number | null; published: number; is_demo?: number;
  rating?: number | null; review_count?: number; following?: boolean; experience_months?: number | null;
  next_available?: number | null;
  promotion?: Promotion;
  services: Service[]; works: Work[]; availability?: Slot[]; schedule?: Schedule;
  reviews?: Review[];
};
export type User = { id: string; login: string; account_type: 'client' | 'master' | 'salon' };
export type Workspace = { id: string; kind: 'solo' | 'salon'; theme?: 'cream'|'wine'|'green'; teaches?: number; looking_models?: number; name: string; city: string; role: 'owner' | 'staff'; slug?: string; bio?: string; logo?: string; cover?: string; address?: string; latitude?: number | null; longitude?: number | null; published?: number; utc_offset?: number };
export type Performer = { id: string; name: string; user_id: string | null; profile: Profile | null; services: Service[]; schedule: Schedule; schedule_configured?: boolean; invitation_expires?: number | null; bookable: number; ready?: boolean; missing?: string[] };
export type SalonPost = {id: string; image: string; images: Photo[]; caption: string; kind: 'space' | 'news'; created: number};
export type SalonPublication = Pick<Work,'id'|'image'|'images'|'caption'|'service_id'|'service_name'|'created'> & {publication_target: string; master_name?: string; kind: 'space' | 'news' | 'work'};
export type SalonService = { id: string; name: string; price: number; duration: number; master_ids: string[] };
export type PublicSalon = { theme?: 'cream'|'wine'|'green'; teaches?: number; looking_models?: number; saved?: boolean; rating?: number|null; review_count?: number; reviews?: Review[]; id: string; slug: string; name: string; city: string; bio: string; logo: string; cover: string; address: string; latitude: number | null; longitude: number | null; utc_offset: number; published: number; services: SalonService[]; works?: Work[]; posts?: SalonPost[]; staff: { id: string; name: string; avatar: string; teaches: number; experience_months?: number | null; categories: string[] }[] };
export const profilePath = (p: Pick<Profile, 'kind' | 'slug' | 'salon_slug'>) => p.kind === 'staff' && p.salon_slug ? '/s/' + p.salon_slug : (p.kind === 'salon' ? '/s/' : '/m/') + p.slug;
export const bookingPath = (p: Pick<Profile, 'kind' | 'slug' | 'salon_slug' | 'user_id'>) => p.kind === 'staff' && p.salon_slug ? '/s/' + p.salon_slug + '/book?master=' + encodeURIComponent(p.user_id) : p.kind === 'salon' ? '/s/' + p.slug + '/book' : '/book/' + p.slug;
export type Salon = { workspace: Workspace; staff: Performer[] };
export type StaffShort = Pick<Performer,'id' | 'name'>;
export type TeamDay = { date: string; utc_offset: number; staff: StaffShort[]; appointments: Appointment[] };
export type ArchiveCheck = { count: number; active: boolean; appointments: (Appointment & { is_break: boolean; candidates: StaffShort[] })[] };
export type AuthProvider = 'yandex' | 'vk' | 'telegram';
export type Me = { client_profile?: {name:string;contact:string;city:string;avatar:string}|null; user: User | null; profile: Profile | null; workspaces?: Workspace[]; providers: Record<AuthProvider, boolean> };
export function cabinetPath(me: Me | null) {
  if (!me?.user) return '/auth';
  if (me.user.account_type === 'salon' || me.workspaces?.some(w => w.kind === 'salon')) return '/salon';
  return me.user.account_type === 'master' ? '/studio' : '/me';
}
export type Appointment = {
  id: string; master_id: string; client_id?: string | null; client_name: string;
  service: string; start: number; end: number; price: number;
  status: 'pending' | 'confirmed' | 'cancelled' | 'done'; notes?: string;
  guest_contact?: string; contact?: string; master_name?: string; slug?: string;
  review_id?: string | null; review_rating?: number | null;
  salon_slug?: string; salon_name?: string; utc_offset?: number;
  is_break?: boolean; reschedule_request_id?: string | null;
};
export type Studio = { profile: Profile | null; address_draft?: { city: string; address: string; latitude: number | null; longitude: number | null } | null; services: Service[]; works: Work[]; schedule?: Schedule; schedule_configured?: boolean; availability?: Slot[] };
export type Feed = { items: Work[]; next: string | null };

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch('/api' + path, { credentials: 'same-origin', ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Не удалось выполнить действие');
  return data as T;
}
export function json<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body: unknown): Promise<T> {
  return api<T>(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
export function money(value: number) { return new Intl.NumberFormat('ru-RU').format(value) + ' ₽'; }
export function dayKey(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}
export function prettyDate(value: number, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', options).format(value);
}
export function prettyTime(value: number) { return new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' }).format(value); }
export function masterDayKey(value: number, offset = 180) {
  const date = new Date(value + offset * 60000);
  return [date.getUTCFullYear(), String(date.getUTCMonth() + 1).padStart(2, '0'), String(date.getUTCDate()).padStart(2, '0')].join('-');
}
export function masterTime(value: number, offset = 180) {
  const date = new Date(value + offset * 60000);
  return String(date.getUTCHours()).padStart(2, '0') + ':' + String(date.getUTCMinutes()).padStart(2, '0');
}
export function masterDate(value: number, offset = 180, options: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) {
  return new Intl.DateTimeFormat('ru-RU', { ...options, timeZone: 'UTC' }).format(value + offset * 60000);
}
export function statusLabel(status: Appointment['status']) {
  return { pending: 'Ожидает ответа', confirmed: 'Подтверждена', cancelled: 'Отменена', done: 'Состоялась' }[status];
}
export function makeAccessKey() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}
