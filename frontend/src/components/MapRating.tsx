import { Star } from 'lucide-react';

export function MapRating({ rating, review_count = 0 }: { rating?: number | null; review_count?: number }) {
  const count = Number.isInteger(review_count) && review_count > 0 ? review_count : 0;
  const label = count % 100 >= 11 && count % 100 <= 14 ? 'отзывов' : count % 10 === 1 ? 'отзыв' : count % 10 >= 2 && count % 10 <= 4 ? 'отзыва' : 'отзывов';
  const text = count && typeof rating === 'number' && Number.isFinite(rating) && rating >= 1 && rating <= 5 ? rating.toFixed(1) + ' · ' + count + ' ' + label : 'Пока без оценок';
  return <span className="map-rating"><Star size={15} aria-hidden="true"/><span>{text}</span></span>;
}
