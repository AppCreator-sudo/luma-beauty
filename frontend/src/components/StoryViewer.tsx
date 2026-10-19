import { useEffect, useRef, useState, type PointerEvent, type TouchEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import type { StoryAuthor } from '../lib/api';
import '../stories.css';

type Props = {
  authors: StoryAuthor[];
  initialAuthorIndex?: number;
  initialStoryId?: string;
  onClose: () => void;
};

function formatTimeAgo(timestamp: number): string {
  const diffHours = Math.floor((Date.now() - timestamp) / 3600000);
  if (diffHours < 1) {
    const diffMins = Math.floor((Date.now() - timestamp) / 60000);
    return diffMins <= 1 ? 'Только что' : `${diffMins} мин назад`;
  }
  return `${diffHours} ч назад`;
}

export function StoryViewer({ authors, initialAuthorIndex = 0, initialStoryId, onClose }: Props) {
  const navigate = useNavigate();
  const [authorIndex, setAuthorIndex] = useState(initialAuthorIndex);
  const [storyIndex, setStoryIndex] = useState(() => {
    if (initialStoryId && authors[initialAuthorIndex]?.stories) {
      const idx = authors[initialAuthorIndex].stories.findIndex(s => s.id === initialStoryId);
      if (idx !== -1) return idx;
    }
    return 0;
  });
  const [progress, setProgress] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const touchStartY = useRef<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  const currentAuthor = authors[authorIndex];
  const stories = currentAuthor?.stories || [];
  const currentStory = stories[storyIndex];

  // If no stories available, close viewer
  useEffect(() => {
    if (!currentAuthor || !stories.length || !currentStory) {
      onClose();
    }
  }, [currentAuthor, stories, currentStory, onClose]);

  // Story advancement logic
  const nextStory = () => {
    if (storyIndex < stories.length - 1) {
      setStoryIndex(i => i + 1);
      setProgress(0);
    } else if (authorIndex < authors.length - 1) {
      setAuthorIndex(a => a + 1);
      setStoryIndex(0);
      setProgress(0);
    } else {
      onClose();
    }
  };

  const prevStory = () => {
    if (progress > 20) {
      setProgress(0);
    } else if (storyIndex > 0) {
      setStoryIndex(i => i - 1);
      setProgress(0);
    } else if (authorIndex > 0) {
      const prevAuthorStories = authors[authorIndex - 1].stories;
      setAuthorIndex(a => a - 1);
      setStoryIndex(Math.max(0, prevAuthorStories.length - 1));
      setProgress(0);
    } else {
      setProgress(0);
    }
  };

  // Timer: 5000ms per story = 50ms tick with 1% advance
  useEffect(() => {
    if (isPaused || !currentStory) return;

    const interval = setInterval(() => {
      setProgress(p => {
        if (p >= 100) {
          nextStory();
          return 0;
        }
        return p + 1; // 100 ticks * 50ms = 5000ms
      });
    }, 50);

    return () => clearInterval(interval);
  }, [isPaused, currentStory, storyIndex, authorIndex, stories.length, authors.length]);

  // Keyboard navigation & lock background scroll
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        nextStory();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        prevStory();
      } else if (e.key === ' ') {
        e.preventDefault();
        setIsPaused(p => !p);
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [authorIndex, storyIndex, stories.length, authors.length]);

  // Swipe-down to close gestures
  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      touchStartY.current = e.touches[0].clientY;
      touchStartX.current = e.touches[0].clientX;
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (touchStartY.current !== null && e.changedTouches.length === 1) {
      const deltaY = e.changedTouches[0].clientY - touchStartY.current;
      const deltaX = Math.abs(e.changedTouches[0].clientX - (touchStartX.current || 0));
      if (deltaY > 60 && deltaY > deltaX * 1.2) {
        onClose();
      }
    }
    touchStartY.current = null;
    touchStartX.current = null;
  };

  if (!currentAuthor || !currentStory) return null;

  // Direct CTA click
  const handleCtaClick = () => {
    onClose();
    if (currentAuthor.owner_type === 'salon') {
      const url = `/s/${currentAuthor.owner_slug}/book${currentStory.service_id ? '?service=' + encodeURIComponent(currentStory.service_id) : ''}`;
      navigate(url);
    } else {
      const url = `/book/${currentAuthor.owner_slug}${currentStory.service_id ? '?service=' + encodeURIComponent(currentStory.service_id) : ''}`;
      navigate(url);
    }
  };

  const authorProfileUrl = currentAuthor.owner_type === 'salon'
    ? `/s/${currentAuthor.owner_slug}`
    : `/m/${currentAuthor.owner_slug}`;

  return createPortal(
    <div
      className="story-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`История: ${currentAuthor.owner_name}`}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* Desktop Prev Arrow */}
      {authorIndex > 0 || storyIndex > 0 ? (
        <button
          className="story-desktop-arrow prev"
          type="button"
          aria-label="Предыдущая история"
          onClick={e => {
            e.stopPropagation();
            prevStory();
          }}
        >
          <ChevronLeft size={28} />
        </button>
      ) : null}

      <div
        className="story-viewer-stage"
        onPointerDown={(e: PointerEvent) => {
          // Pause if holding anywhere in the stage
          if ((e.target as HTMLElement).closest('button, a')) return;
          setIsPaused(true);
        }}
        onPointerUp={() => setIsPaused(false)}
        onPointerCancel={() => setIsPaused(false)}
      >
        {/* Progress Bar Segments */}
        <div className="story-progress-row">
          {stories.map((s, idx) => {
            const fillWidth =
              idx < storyIndex ? 100 : idx === storyIndex ? progress : 0;
            return (
              <div key={s.id} className="story-progress-segment">
                <div
                  className="story-progress-fill"
                  style={{ width: `${fillWidth}%` }}
                />
              </div>
            );
          })}
        </div>

        {/* Story Header */}
        <div className="story-header">
          <a
            href={authorProfileUrl}
            className="story-header-author"
            onClick={e => {
              e.preventDefault();
              onClose();
              navigate(authorProfileUrl);
            }}
          >
            {currentAuthor.owner_avatar ? (
              <img
                src={currentAuthor.owner_avatar}
                alt=""
                className="story-header-avatar"
              />
            ) : (
              <div className="story-header-placeholder">
                {Array.from(currentAuthor.owner_name.trim())[0] || 'L'}
              </div>
            )}
            <div className="story-header-meta">
              <span className="story-header-name">
                {currentAuthor.owner_name}
              </span>
              <span className="story-header-time">
                {formatTimeAgo(currentStory.created)}
              </span>
            </div>
          </a>

          <button
            type="button"
            className="story-close-button"
            aria-label="Закрыть историю"
            onClick={e => {
              e.stopPropagation();
              onClose();
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Story Media */}
        <div className="story-media">
          <img
            src={currentStory.image}
            alt={currentStory.caption || currentAuthor.owner_name}
          />
        </div>

        {/* Tap Hotspots for Mobile / Tap navigation */}
        <div
          className="story-nav-tap left"
          aria-label="Назад"
          onClick={e => {
            e.stopPropagation();
            prevStory();
          }}
        />
        <div
          className="story-nav-tap right"
          aria-label="Вперёд"
          onClick={e => {
            e.stopPropagation();
            nextStory();
          }}
        />

        {/* Caption */}
        {currentStory.caption ? (
          <div className="story-caption-card">
            {currentStory.caption}
          </div>
        ) : null}

        {/* Direct Action Booking CTA */}
        <div className="story-cta-container">
          <button
            type="button"
            className="story-cta-button"
            onClick={e => {
              e.stopPropagation();
              handleCtaClick();
            }}
          >
            <span>
              {currentStory.service_name
                ? `Записаться на «${currentStory.service_name}»${currentStory.service_price ? ' · ' + currentStory.service_price.toLocaleString('ru-RU') + ' ₽' : ''}`
                : 'Записаться онлайн'}
            </span>
            <ArrowRight size={17} />
          </button>
        </div>
      </div>

      {/* Desktop Next Arrow */}
      {authorIndex < authors.length - 1 || storyIndex < stories.length - 1 ? (
        <button
          className="story-desktop-arrow next"
          type="button"
          aria-label="Следующая история"
          onClick={e => {
            e.stopPropagation();
            nextStory();
          }}
        >
          <ChevronRight size={28} />
        </button>
      ) : null}
    </div>,
    document.body
  );
}
