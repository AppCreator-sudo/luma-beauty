import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { ChevronDown, Clock, Eye, Pencil, Plus, Sparkles, Trash2, Upload, X } from 'lucide-react';
import { api, json, type Service, type StoryItem } from '../lib/api';
import { StoryViewer } from './StoryViewer';
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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [viewingStoryId, setViewingStoryId] = useState<string | null>(null);

  // Form states
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string>('');
  const [caption, setCaption] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

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

  const selectFile = (selected: File) => {
    if (selected.size > 8 * 1024 * 1024) {
      setError('Фотография должна быть меньше 8 МБ');
      return;
    }
    setFile(selected);
    setError('');
    const objectUrl = URL.createObjectURL(selected);
    setPreview(objectUrl);
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) selectFile(selected);
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && ['image/jpeg', 'image/png', 'image/webp'].includes(dropped.type)) {
      selectFile(dropped);
    } else if (dropped) {
      setError('Поддерживаются форматы JPG, PNG или WebP');
    }
  };

  const handleResetForm = () => {
    setFile(null);
    if (preview && preview.startsWith('blob:')) URL.revokeObjectURL(preview);
    setPreview('');
    setCaption('');
    setServiceId('');
    setIsAdding(false);
    setEditingId(null);
    setError('');
  };

  const handleStartEdit = (story: StoryItem) => {
    setEditingId(story.id);
    setIsAdding(true);
    setCaption(story.caption || '');
    setServiceId(story.service_id || '');
    setPreview(story.image);
    setFile(null);
    setError('');
    setNotice('');
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!editingId && !file) {
      setError('Выберите фотографию для истории');
      return;
    }

    setSubmitting(true);
    setError('');
    setNotice('');

    try {
      if (editingId) {
        // Editing existing story: update caption and service
        const body: Record<string, string> = {
          caption: caption.trim(),
          service_id: serviceId
        };

        const res = await json<{ ok: boolean; story: StoryItem }>(
          '/stories/' + editingId,
          'PATCH',
          body
        );

        if (!res.ok) {
          throw new Error('Не удалось обновить историю');
        }

        setNotice('Изменения истории сохранены!');
      } else {
        // Creating new story
        const formData = new FormData();
        if (file) formData.append('image', file);
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
      }

      handleResetForm();
      await fetchMine();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения истории');
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
      if (editingId === id) handleResetForm();
      onChange?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось удалить историю');
    } finally {
      setDeletingId(null);
    }
  };

  const selectedService = services.find(s => s.id === serviceId);

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
            else {
              handleResetForm();
              setIsAdding(true);
            }
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

      {/* Upload & Edit Form */}
      {isAdding ? (
        <form ref={formRef} className="story-upload-form" onSubmit={handleSubmit}>
          <div className="story-form-header">
            <div>
              <span className="story-form-eyebrow">
                {editingId ? 'РЕДАКТИРОВАНИЕ' : 'НОВАЯ ПУБЛИКАЦИЯ'}
              </span>
              <h3 className="story-form-title">
                {editingId ? 'Настройки активной истории' : 'Создать историю'}
              </h3>
            </div>
            <button
              type="button"
              className="story-form-close"
              onClick={handleResetForm}
              aria-label="Закрыть форму"
            >
              <X size={18} />
            </button>
          </div>

          <div className="story-form-grid">
            {/* Left Column: 9:16 Photo Frame with Live Preview */}
            <div className="story-media-column">
              <div className="story-field-label-row">
                <span className="story-field-label">Фотография истории</span>
                <span className="story-format-badge">Формат 9:16</span>
              </div>

              <div
                className={`story-dropzone ${preview ? 'has-preview' : ''} ${isDragging ? 'is-dragging' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                role="button"
                tabIndex={0}
                aria-label="Загрузить фотографию истории"
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  accept="image/jpeg,image/png,image/webp"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />

                {preview ? (
                  <div className="story-preview-frame">
                    <img src={preview} alt="Предпросмотр истории" className="story-preview-img" />
                    <div className="story-preview-overlay">
                      {caption.trim() ? (
                        <p className="story-preview-caption-text">{caption.trim()}</p>
                      ) : null}
                      {selectedService ? (
                        <div className="story-preview-cta-pill">
                          Записаться: {selectedService.name} · {selectedService.price} ₽
                        </div>
                      ) : null}
                    </div>
                    <div className="story-preview-actions" onClick={e => e.stopPropagation()}>
                      <button
                        type="button"
                        className="story-preview-action-btn"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Upload size={13} />
                        Заменить
                      </button>
                      {!editingId ? (
                        <button
                          type="button"
                          className="story-preview-action-btn danger"
                          onClick={() => {
                            setFile(null);
                            if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
                            setPreview('');
                          }}
                        >
                          <X size={13} />
                          Удалить
                        </button>
                      ) : null}
                    </div>
                  </div>
                ) : (
                  <div className="story-dropzone-empty">
                    <div className="story-dropzone-icon">
                      <Upload size={26} />
                    </div>
                    <p className="story-dropzone-prompt">
                      <strong>Выберите фото</strong> или перетащите его сюда
                    </p>
                    <span className="story-dropzone-sub">
                      JPG, PNG или WebP до 8 МБ
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Right Column: Structured Input Fields */}
            <div className="story-fields-column">
              {/* Field 1: Caption Textarea */}
              <div className="story-form-field">
                <div className="story-field-label-row">
                  <label htmlFor="story-caption-input" className="story-field-label">
                    Подпись или объявление
                    <span className="story-field-optional">(необязательно)</span>
                  </label>
                  <span className="story-char-counter">
                    {caption.length} / 500
                  </span>
                </div>
                <textarea
                  id="story-caption-input"
                  className="story-form-textarea"
                  value={caption}
                  onChange={e => setCaption(e.target.value)}
                  placeholder="Например: Есть свободные окна на завтра в 14:00 и 16:30! Запись открыта."
                  maxLength={500}
                  rows={4}
                />
                <span className="story-field-hint">
                  Текст отображается в нижней части экрана поверх фотографии при просмотре истории клиентами.
                </span>
              </div>

              {/* Field 2: Service Select */}
              {services.length > 0 ? (
                <div className="story-form-field">
                  <div className="story-field-label-row">
                    <label htmlFor="story-service-select" className="story-field-label">
                      Привязать услугу для кнопки «Записаться»
                      <span className="story-field-optional">(необязательно)</span>
                    </label>
                  </div>
                  <div className="story-select-wrapper">
                    <select
                      id="story-service-select"
                      className="story-form-select"
                      value={serviceId}
                      onChange={e => setServiceId(e.target.value)}
                    >
                      <option value="">Без привязки (кнопка записи на общую страницу)</option>
                      {services.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} — {s.price} ₽ ({s.duration} мин)
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={16} className="story-select-arrow" aria-hidden="true" />
                  </div>
                  <span className="story-field-hint">
                    Клиент сможет нажать кнопку «Записаться» прямо во время просмотра и сразу перейти к выбору времени этой услуги.
                  </span>
                </div>
              ) : null}

              {/* Actions */}
              <div className="story-form-actions">
                <button
                  type="submit"
                  className="button button-wine story-submit-btn"
                  disabled={submitting || (!file && !editingId)}
                >
                  <Sparkles size={16} />
                  {submitting
                    ? 'Сохраняем…'
                    : editingId
                    ? 'Сохранить изменения'
                    : 'Опубликовать на 24 часа'}
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
            </div>
          </div>
        </form>
      ) : null}

      {/* Active Stories List */}
      <div className="stories-manager-block">
        <div className="studio-list-heading">
          <h3>Активные истории</h3>
          <span className="stories-counter-badge">Активно: {stories.length} из 15</span>
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
                <div className="story-card-media">
                  <img
                    src={story.image}
                    alt={story.caption || 'История'}
                    className="story-card-thumb"
                    loading="lazy"
                  />
                  <div className="story-card-badge">
                    <Clock size={12} />
                    <span>Осталось {story.remaining_hours ?? 24} ч</span>
                  </div>
                  <button
                    type="button"
                    className="story-card-preview-trigger"
                    onClick={() => setViewingStoryId(story.id)}
                    aria-label="Открыть просмотр истории"
                  >
                    <Eye size={16} />
                    <span>Просмотр</span>
                  </button>
                </div>

                <div className="story-card-body">
                  {story.caption ? (
                    <p className="story-card-caption">{story.caption}</p>
                  ) : (
                    <p className="story-card-caption empty">Без подписи</p>
                  )}

                  {story.service_name ? (
                    <span className="story-card-service">
                      Запись: {story.service_name}
                      {story.service_price ? ` · ${story.service_price} ₽` : ''}
                    </span>
                  ) : null}

                  <div className="story-card-actions">
                    <button
                      type="button"
                      className="story-action-btn edit"
                      onClick={() => handleStartEdit(story)}
                      aria-label="Редактировать историю"
                    >
                      <Pencil size={13} />
                      <span>Изменить</span>
                    </button>
                    <button
                      type="button"
                      className="story-action-btn delete"
                      disabled={deletingId === story.id}
                      onClick={() => void handleDelete(story.id)}
                      aria-label="Удалить историю"
                    >
                      <Trash2 size={13} />
                      <span>{deletingId === story.id ? '…' : 'Удалить'}</span>
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      {/* Story Viewer in Cabinet for Author Preview */}
      {viewingStoryId && stories.length > 0 ? (
        <StoryViewer
          authors={[
            {
              owner_type: ownerType,
              owner_id: workspaceId || '',
              owner_slug: '',
              owner_name: 'Мои истории',
              owner_avatar: '',
              stories
            }
          ]}
          initialStoryId={viewingStoryId}
          onClose={() => setViewingStoryId(null)}
        />
      ) : null}
    </section>
  );
}
