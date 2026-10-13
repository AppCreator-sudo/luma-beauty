import type { Promotion } from '../lib/api';

export function PromotionBadge({ promotion }: { promotion?: Promotion }) {
  if (!promotion) return null;
  return <details className="promotion-disclosure"><summary>Реклама <span aria-hidden="true">ⓘ</span></summary><div><span>{promotion.advertiser}</span><small>erid: {promotion.erid}</small></div></details>;
}
