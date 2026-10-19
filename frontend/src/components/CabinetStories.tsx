import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Clock, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { api, json, type Service, type StoryItem } from '../lib/api';
import '../stories.css';

type Props = {
  ownerType: 'master' | 'salon';
  workspaceId?: string;
  services?: Service[];
  onChange?: () => void;
};

export function CabinetStories({ ownerType, workspaceId, services = [], onChange }: Props) {
  const [stories, setStories] = useState<StoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  // Form states
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [caption, setCaption] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchMine = async () => {
    setLoading(true);
    setError('');
    try {
      const query = workspaceId ? `?workspace_id=${encodeURIComponent(workspaceId)}` : '';
      const data = await api<StoryItem[]>('/stories/mine' + query);
      setStories(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось загрузить истории');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMine();
  }, [ownerType, workspaceId]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (selected.size > 8 * 1024 * 1024) {
      setError('Фотография должна быть меньше 8 МБ');
      return;
    }

    setFile(selected);
    setError('');
    const objectUrl = URL.createObjectURL(selected);
    setPreview(objectUrl);
  };

  const handleResetForm = () => {
    setFile(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
    setCaption('');
    setServiceId('');
    setIsAdding(false);
    setError('');
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('Выберите фотографию для истории');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');

    try {
      const formData = new FormData();
      formData.append('image', file);
      formData.append('owner_type', ownerType);
      if (workspaceId) formData.append('workspace_id', workspaceId);
      if (caption.trim()) formData.append('caption', caption.trim());
      if (serviceId) formData.append('service_id', serviceId);

      const res = await fetch('/api/stories', {
        method: 'POST',
        body: formData,
        credentials: 'same-origin'
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'Не удалось опубликовать историю');
      }

      setNotice('История опубликована на 24 часа!');
      handleResetForm();
      await fetchMine();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка публикации');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить эту историю?')) return;
    setDeletingId(id);
    setError('');
    setNotice('');

    try {
      await json('/stories/' + id, 'DELETE', {});
      setNotice('История удалена');
      setStories(current => current.filter(s => s.id !== id));
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить историю');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <section className="cabinet-stories-section">
      <div className="section-head compact">
        <div>
          <span className="eyebrow">ЖИВОЙ ФОРМАТ 24 ЧАСА</span>
          <h2>
            Мои <em>истории.</em>
          </h2>
        </div>
        <button
          type="button"
          className="button button-wine"
          onClick={() => {
            if (isAdding) handleResetForm();
            else setIsAdding(true);
          }}
        >
          {isAdding ? <X size={16} /> : <Plus size={16} />}
          {isAdding ? 'Скрыть форму' : 'Опубликовать историю'}
        </button>
      </div>

      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
        Истории видны клиентам 24 часа в верхней ленте каталога и на вашей странице.
        Привяжите услугу — и клиент сможет записаться в один клик прямо из сторис.
      </p>

      {notice ? <p className="studio-action-notice" role="status">{notice}</p> : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {/* Upload Form */}
      {isAdding ? (
        <form className="story-upload-form" onSubmit={handleSubmit}>
          <h3>Новая история</h3>

          <div
            className="story-dropzone"
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              type="file"
              ref={fileInputRef}
              accept="image/jpeg,image/png,image/webp"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {preview ? (
              <img src={preview} alt="Предпросмотр истории" />
            ) : (
              <>
                <Upload size={32} color="#C5A059" />
                <p><strong>Выберите фото</strong> или перетащите его сюда</p>
                <small>JPG, PNG или WebP до 8 МБ (вертикальный формат 9:16)</small>
              </>
            )}
          </div>

          <label>
            Подпись к истории (необязательно)
            <textarea
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Например: Есть свободные окна на завтра! Запись открыта."
              maxLength={500}
              rows={2}
            />
            <small style={{ textAlign: 'right', display: 'block', color: '#888' }}>
              {caption.length}/500
            </small>
          </label>

          {services.length > 0 ? (
            <label>
              Привязать услугу для кнопки «Записаться» (необязательно)
              <select
                value={serviceId}
                onChange={e => setServiceId(e.target.value)}
              >
                <option value="">Без привязки услуги (кнопка записи к автору)</option>
                {services.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.price} ₽ · {s.duration} мин)
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div style={{ display: 'flex', gap: 10 }}>
            <button
              type="submit"
              className="button button-wine"
              disabled={submitting || !file}
            >
              <Sparkles size={16} />
              {submitting ? 'Публикуем…' : 'Опубликовать на 24 часа'}
            </button>
            <button
              type="button"
              className="button button-outline"
              onClick={handleResetForm}
              disabled={submitting}
            >
              Отмена
            </button>
          </div>
        </form>
      ) : null}

      {/* Active Stories List */}
      <div>
        <div className="studio-list-heading">
          <h3>Активные истории</h3>
          <span>Активно: {stories.length}</span>
        </div>

        {loading ? (
          <p className="muted">Загрузка историй…</p>
        ) : stories.length === 0 ? (
          <p className="studio-list-hint">
            У вас пока нет активных историй. Опубликуйте первую работу или свободное окно,
            чтобы аватар подсвечивался золотым ободком в каталоге!
          </p>
        ) : (
          <div className="stories-manager-grid">
            {stories.map(story => (
              <article key={story.id} className="story-card">
                <img
                  src={story.image}
                  alt={story.caption || 'История'}
                  className="story-card-thumb"
                  loading="lazy"
                />
                <div className="story-card-body">
                  <div className="story-card-meta">
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Clock size={13} />
                      Осталось {story.remaining_hours ?? 24} ч
                    </span>
                  </div>

                  {story.caption ? (
                    <p className="story-card-caption">{story.caption}</p>
                  ) : null}

                  {story.service_name ? (
                    <span className="story-card-service">
                      Запись: {story.service_name}
                    </span>
                  ) : null}

                  <button
                    type="button"
                    className="story-card-delete"
                    disabled={deletingId === story.id}
                    onClick={() => void handleDelete(story.id)}
                    aria-label="Удалить историю"
                  >
                    <Trash2 size={15} />
                    {deletingId === story.id ? 'Удаляем…' : 'Удалить'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
