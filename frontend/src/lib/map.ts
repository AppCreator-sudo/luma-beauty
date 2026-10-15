import type { Profile } from './api';

export type MapAvailability = {
  start: number; end: number; utc_offset: number;
  service: { id: string; title: string; price: number; duration: number };
  performer: { id: string; name: string } | null;
};
export type MapMaster = Pick<Profile, 'kind' | 'user_id' | 'slug' | 'name' | 'city' | 'category' | 'categories' | 'avatar' | 'address' | 'latitude' | 'longitude' | 'teaches' | 'looking_models' | 'rating' | 'review_count' | 'promotion' | 'is_demo' | 'next_available'> & { availability?: MapAvailability | null };
export type MapService = MapAvailability['service'] & {category:string;master_ids:string[]};
export type MapDetails = { services:MapService[]; selected_service:string|null; profile: MapMaster; bio: string; cover: string | null; next_available: number | null; availability: MapAvailability | null; checked_at: number };
export const mapIdentity = (profile: MapMaster) => (profile.kind || 'master') + ':' + profile.user_id;
