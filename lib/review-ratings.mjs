// One public standard: one persisted client review per completed visit.
// Venue snapshots keep a salon's history independent of staff transfers.
export function reviewRatings(db, targets) {
  const result = new Map(targets.map(t => [(t.kind === 'salon' ? 'salon' : 'master') + ':' + t.user_id, { rating: null, review_count: 0 }]));
  if (!targets.length || !db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='reviews'").get()) return result;
  const masters = [...new Set(targets.filter(t => t.kind !== 'salon').map(t => t.user_id))];
  const salons = [...new Set(targets.filter(t => t.kind === 'salon').map(t => t.user_id))];
  const source = "reviews r JOIN appointments a ON a.id=r.appointment_id AND a.master_id=r.master_id AND a.client_id=r.client_id AND a.status='done'";
  const read = (kind, ids, from, column) => {
    if (!ids.length) return;
    const rows = db.prepare(`SELECT ${column} id,ROUND(AVG(r.rating),1) rating,COUNT(*) review_count FROM ${from}
      WHERE r.rating BETWEEN 1 AND 5 AND ${column} IN (${ids.map(() => '?').join(',')}) GROUP BY ${column}`).all(...ids);
    for (const { id, rating, review_count } of rows) result.set(kind + ':' + id, { rating, review_count });
  };
  read('master', masters, source, 'r.master_id');
  if (salons.length && db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='booking_venues'").get()) {
    read('salon', salons, source + ' JOIN booking_venues venue ON venue.appointment_id=a.id', 'venue.workspace_id');
  }
  return result;
}

export function reviewRating(db, kind, id) {
  return reviewRatings(db, [{ kind, user_id: id }]).get((kind === 'salon' ? 'salon' : 'master') + ':' + id);
}

export function publicReviews(db, kind, id) {
  return db.prepare(`SELECT r.id,r.rating,r.text,r.created,a.service FROM reviews r
    JOIN appointments a ON a.id=r.appointment_id AND a.master_id=r.master_id AND a.client_id=r.client_id AND a.status='done'
    ${kind === 'salon' ? 'JOIN booking_venues venue ON venue.appointment_id=a.id' : ''}
    WHERE ${kind === 'salon' ? 'venue.workspace_id' : 'r.master_id'}=? AND r.rating BETWEEN 1 AND 5
    ORDER BY r.created DESC,r.id DESC LIMIT 20`).all(id);
}
