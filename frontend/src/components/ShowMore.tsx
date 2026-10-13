export function ShowMore({ hasNext, busy, error, onClick, subject }: { hasNext: boolean; busy: boolean; error: string; onClick: () => void; subject: 'карточки' | 'работы' }) {
  return <div className="reference-show-more">
    {error ? <p role="alert">{error}</p> : null}
    {hasNext ? <><button type="button" disabled={busy} onClick={onClick}>{busy ? 'Загружаем…' : error ? 'Попробовать ещё раз' : 'Показать ещё'}</button><small aria-live="polite">Новые {subject} добавятся ниже.</small></> : <small>Вы посмотрели все {subject === 'карточки' ? 'результаты' : 'работы'} этой выдачи.</small>}
  </div>;
}
