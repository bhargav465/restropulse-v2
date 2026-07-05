import React from 'react';
import { useStorefront } from '../store/StorefrontContext';
import { Loading, ErrorState, EmptyState } from '../components/States';

const StoryPage: React.FC = () => {
  const { content, restaurantName, loading, error, reload } = useStorefront();

  if (loading) return <Loading label="Loading our story…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const story = content?.story ?? [];
  const chefs = content?.chefs ?? [];
  const gallery = content?.gallery ?? [];

  if (story.length === 0 && chefs.length === 0 && gallery.length === 0) {
    return <EmptyState title="Our story is being written" text={`${restaurantName} hasn't published their story yet — check back soon.`} />;
  }

  return (
    <div className="space-y-10 max-w-3xl mx-auto">
      <h1 className="text-xl font-extrabold text-slate-800">Our Story</h1>

      {/* Timeline */}
      {story.length > 0 && (
        <section aria-labelledby="timeline-heading">
          <h2 id="timeline-heading" className="sr-only">Timeline</h2>
          <ol className="space-y-0">
            {story.map((entry, idx) => (
              <li key={idx} className="flex gap-4 pb-8 last:pb-0 relative">
                {idx < story.length - 1 && (
                  <span className="absolute left-[26px] top-14 bottom-0 w-0.5 bg-slate-200" aria-hidden="true"></span>
                )}
                <div className="w-14 h-14 rounded-2xl bg-[var(--sf-primary)] text-white flex items-center justify-center font-extrabold text-sm shrink-0 z-10">
                  {entry.year}
                </div>
                <div className="flex-1 bg-white rounded-2xl border border-slate-200 overflow-hidden">
                  {entry.image && <img src={entry.image} alt={entry.title} className="w-full h-40 object-cover" />}
                  <div className="p-4">
                    <h3 className="text-base font-bold text-slate-800 mb-1">{entry.title}</h3>
                    <p className="text-sm text-slate-600">{entry.text}</p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Chefs */}
      {chefs.length > 0 && (
        <section aria-labelledby="chefs-heading">
          <h2 id="chefs-heading" className="text-lg font-bold text-slate-800 mb-4">Meet the chefs</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {chefs.map((chef, i) => (
              <article key={i} className="bg-white rounded-2xl border border-slate-200 p-4 flex gap-4">
                {chef.photo ? (
                  <img src={chef.photo} alt={`Portrait of ${chef.name}`} className="w-20 h-20 rounded-2xl object-cover shrink-0" />
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center text-2xl font-bold text-slate-400 shrink-0" aria-hidden="true">
                    {chef.name[0]}
                  </div>
                )}
                <div>
                  <h3 className="text-base font-bold text-slate-800">{chef.name}</h3>
                  {chef.title && <p className="text-xs font-semibold text-[var(--sf-primary)] mb-1">{chef.title}</p>}
                  <p className="text-sm text-slate-600">{chef.bio}</p>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* Gallery */}
      {gallery.length > 0 && (
        <section aria-labelledby="story-gallery-heading">
          <h2 id="story-gallery-heading" className="text-lg font-bold text-slate-800 mb-3">Gallery</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {gallery.map((url, i) => (
              <li key={i}>
                <img src={url} alt={`${restaurantName} gallery photo ${i + 1}`} className="w-full h-32 sm:h-40 object-cover rounded-xl" loading="lazy" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default StoryPage;
