const key='atelie-booking-draft-v1';
let fallback=null;
export function readBookingDraft() {
  let draft=fallback;
  try { draft=JSON.parse(sessionStorage.getItem(key))||draft; } catch {}
  if(!draft || !draft.savedAt || Date.now()-draft.savedAt>2*60*60*1000) { clearBookingDraft(); return null; }
  return draft;
}
export function saveBookingDraft(draft) {
  fallback={...draft,savedAt:Date.now()};
  try { sessionStorage.setItem(key,JSON.stringify(fallback)); } catch {}
}
export function clearBookingDraft() {
  fallback=null;
  try { sessionStorage.removeItem(key); } catch {}
}
