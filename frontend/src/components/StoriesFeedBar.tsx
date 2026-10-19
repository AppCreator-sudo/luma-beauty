import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { api, type StoryAuthor } from '../lib/api';
import { useResource } from '../lib/useResource';
import { useApp } from './Shell';
import { StoryViewer } from './StoryViewer';
import { StoryRingAvatar } from './StoryRingAvatar';
import '../stories.css';

export function StoriesFeedBar() {
  const { me } = useApp();
  const resource = useResource(() => api<StoryAuthor[]>('/stories/active'), []);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const authors = resource.data || [];
  const isMasterOrSalon =
    me?.user?.account_type === 'master' ||
    me?.user?.account_type === 'salon' ||
    Boolean(me?.workspaces?.some(w => w.kind === 'salon'));

  const addPath =
    me?.user?.account_type === 'salon' || me?.workspaces?.some(w => w.kind === 'salon')
      ? '/salon?tab=stories'
      : '/studio?tab=stories';

  const userAvatar =
    me?.user?.account_type === 'salon'
      ? me.workspaces?.find(w => w.kind === 'salon')?.logo
      : me?.profile?.avatar;

  // Don't render empty container if no stories and user cannot post
  if (!resource.loading && authors.length === 0 && !isMasterOrSalon) {
    return null;
  }

  return (
    <section className="stories-feed-bar" aria-label="Истории мастеров и салонов">
      <div className="stories-feed-scroll">
        {/* Creator's add story shortcut */}
        {isMasterOrSalon ? (
          <Link
            to={addPath}
            className="stories-feed-add"
            aria-label="Опубликовать историю"
            title="Опубликовать историю на 24 часа"
          >
            <div className="stories-feed-add-avatar">
              {userAvatar ? (
                <img src={userAvatar} alt="" />
              ) : (
                <span>{Array.from(me?.profile?.name || me?.user?.login || 'L')[0]}</span>
              )}
              <div className="stories-feed-add-badge">
                <Plus size={14} />
              </div>
            </div>
            <span className="stories-feed-name">Ваша история</span>
          </Link>
        ) : null}

        {/* Authors with active stories */}
        {authors.map((author, index) => (
          <button
            key={author.owner_type + ':' + author.owner_id}
            type="button"
            className="stories-feed-item"
            onClick={() => setViewerIndex(index)}
            aria-label={`Смотреть историю: ${author.owner_name}`}
          >
            <StoryRingAvatar
              hasStory={true}
              avatar={author.owner_avatar}
              name={author.owner_name}
              size={66}
            />
            <span className="stories-feed-name" title={author.owner_name}>
              {author.owner_name}
            </span>
          </button>
        ))}
      </div>

      {/* Story Viewer Modal */}
      {viewerIndex !== null && authors[viewerIndex] ? (
        <StoryViewer
          authors={authors}
          initialAuthorIndex={viewerIndex}
          onClose={() => setViewerIndex(null)}
        />
      ) : null}
    </section>
  );
}
