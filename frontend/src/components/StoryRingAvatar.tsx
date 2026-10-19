import type { MouseEvent, ReactNode } from 'react';
import '../stories.css';

type Props = {
  hasStory?: boolean;
  avatar?: string;
  name?: string;
  size?: number;
  className?: string;
  onClick?: (e: MouseEvent) => void;
  children?: ReactNode;
};

export function StoryRingAvatar({
  hasStory = false,
  avatar,
  name = '',
  size = 64,
  className = '',
  onClick,
  children
}: Props) {
  const content = children || (
    avatar ? (
      <img src={avatar} alt={name} width={size} height={size} loading="lazy" />
    ) : (
      <span>{Array.from(name.trim())[0] || 'L'}</span>
    )
  );

  if (!hasStory) {
    return <div className={`avatar-container ${className}`}>{content}</div>;
  }

  const handleClick = (e: MouseEvent) => {
    if (onClick) {
      e.preventDefault();
      e.stopPropagation();
      onClick(e);
    }
  };

  return (
    <div
      className={`story-avatar-ring ${className}`}
      style={{ width: size, height: size }}
      onClick={handleClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      aria-label={onClick ? `Смотреть истории: ${name}` : undefined}
      onKeyDown={e => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          e.stopPropagation();
          onClick(e as unknown as MouseEvent);
        }
      }}
    >
      <div className="story-avatar-ring-inner">
        {content}
      </div>
    </div>
  );
}
