// Detached salon offers remain addressable by historical works/visits, but are
// excluded from new selections. Older standalone fixtures have no catalogue.
export function activeServiceSQL(db,alias='s'){
  if(!/^[a-z_]+$/i.test(alias))throw new Error('Invalid service alias');
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='salon_service_assignments'").get())return '1';
  return `(NOT EXISTS(SELECT 1 FROM salon_service_assignments sa WHERE sa.service_id=${alias}.id) OR EXISTS(SELECT 1 FROM salon_service_assignments sa JOIN salon_service_catalog sc ON sc.id=sa.catalog_id WHERE sa.service_id=${alias}.id AND sa.active=1 AND sc.active=1))`;
}
export function activeService(db,id,userId){return db.prepare(`SELECT s.* FROM services s WHERE s.id=? AND s.user_id=? AND ${activeServiceSQL(db)}`).get(id,userId)}
