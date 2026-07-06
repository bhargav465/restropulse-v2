import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useStorefront } from '../store/StorefrontContext';
import { storefrontAPI } from '../api';
import type { PublicMenuItem } from '../types';
import { formatMoney } from '../lib/format';
import { Loading, ErrorState } from '../components/States';

/** Best-effort human label from a placehold.co-style URL (`?text=Dining+Hall`). */
function galleryLabel(url: string): string | null {
  try {
    return new URL(url).searchParams.get('text');
  } catch {
    return null;
  }
}

const HomePage: React.FC = () => {
  const { slug, content, restaurantName, currency, loading, error, reload, storeOpen } = useStorefront();
  const [featured, setFeatured] = useState<PublicMenuItem[] | null>(null);
  // Graceful fallback: if the hero video fails to load, drop back to the poster image.
  const [videoFailed, setVideoFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    storefrontAPI
      .getMenu(slug)
      .then((categories) => {
        if (cancelled) return;
        const items = categories.flatMap((c) => c.items).filter((i) => !i.soldOut);
        setFeatured(items.slice(0, 6));
      })
      .catch(() => { if (!cancelled) setFeatured([]); });
    return () => { cancelled = true; };
  }, [slug]);

  if (loading) return <Loading label="Loading storefront…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const hero = content?.heroImages?.[0];
  const videoUrl = videoFailed ? undefined : content?.videoUrl;
  const gallery = content?.gallery ?? [];
  const base = `/${slug}`;

  return (
    <div className="space-y-8">
      {/* Hero */}
      <section
        className="relative rounded-3xl overflow-hidden bg-[var(--sf-secondary)] text-white min-h-56 flex items-end"
        aria-label="Welcome"
      >
        {videoUrl ? (
          <video
            className="absolute inset-0 w-full h-full object-cover opacity-60"
            src={videoUrl}
            poster={hero}
            muted
            autoPlay
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
            onError={() => setVideoFailed(true)}
          />
        ) : hero ? (
          <img
            src={hero}
            alt={`${restaurantName} — featured dish`}
            className="absolute inset-0 w-full h-full object-cover opacity-60"
          />
        ) : null}
        <div className="relative p-6 sm:p-8">
          <h1 className="text-2xl sm:text-4xl font-extrabold mb-2">{restaurantName}</h1>
          {content?.about && <p className="text-sm sm:text-base text-slate-200 max-w-xl line-clamp-2 mb-4">{content.about}</p>}
          <div className="flex flex-wrap gap-2">
            <Link to={`${base}/menu`} className="px-5 py-2.5 rounded-xl bg-[var(--sf-primary)] font-bold text-sm hover:opacity-90">
              Order now
            </Link>
            <Link to={`${base}/dine-in`} className="px-5 py-2.5 rounded-xl bg-white/15 backdrop-blur font-bold text-sm hover:bg-white/25">
              Reserve a table
            </Link>
            <Link to={`${base}/story`} className="px-5 py-2.5 rounded-xl bg-white/15 backdrop-blur font-bold text-sm hover:bg-white/25">
              Our story
            </Link>
          </div>
          {!storeOpen && (
            <p className="mt-3 text-xs font-bold uppercase tracking-wide text-red-300" role="status">
              Currently closed for online orders
            </p>
          )}
        </div>
      </section>

      {/* Photo strip: inside the restaurant */}
      {gallery.length > 0 && (
        <section aria-labelledby="gallery-heading">
          <h2 id="gallery-heading" className="sr-only">Inside the restaurant</h2>
          <ul className="flex gap-3 overflow-x-auto no-scrollbar pb-1">
            {gallery.slice(0, 6).map((url, i) => {
              const label = galleryLabel(url);
              return (
                <li key={`${url}-${i}`} className="shrink-0">
                  <figure>
                    <img
                      src={url}
                      alt={label ?? `Restaurant photo ${i + 1}`}
                      loading="lazy"
                      className="w-44 h-28 object-cover rounded-2xl border border-slate-200"
                    />
                    {label && (
                      <figcaption className="mt-1 text-[11px] font-semibold text-slate-500 text-center">{label}</figcaption>
                    )}
                  </figure>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Featured items */}
      <section aria-labelledby="featured-heading">
        <div className="flex items-center justify-between mb-3">
          <h2 id="featured-heading" className="text-lg font-bold text-slate-800">Popular dishes</h2>
          <Link to={`${base}/menu`} className="text-sm font-semibold text-[var(--sf-primary)] hover:underline">
            Full menu →
          </Link>
        </div>
        {featured === null ? (
          <Loading label="Loading menu…" />
        ) : featured.length === 0 ? (
          <p className="text-sm text-slate-500">The menu is being prepared — check back soon.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {featured.map((item) => (
              <li key={item.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <Link to={`${base}/menu`} className="block">
                  {item.images[0] ? (
                    <img src={item.images[0]} alt={item.name} className="w-full h-28 object-cover" />
                  ) : (
                    <div className="w-full h-28 bg-slate-100" aria-hidden="true"></div>
                  )}
                  <div className="p-3">
                    <p className="text-sm font-bold text-slate-800 truncate">{item.name}</p>
                    <p className="text-sm text-slate-500">{formatMoney(item.price, currency)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Hours + contact */}
      <section className="grid gap-4 sm:grid-cols-2" aria-label="Hours and contact">
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-base font-bold text-slate-800 mb-3">Opening hours</h2>
          {content?.hours && content.hours.length > 0 ? (
            <table className="w-full text-sm">
              <caption className="sr-only">Weekly opening hours</caption>
              <tbody>
                {content.hours.map((h) => (
                  <tr key={h.day} className="border-b border-slate-100 last:border-0">
                    <th scope="row" className="py-1.5 text-left font-medium text-slate-600">{h.day}</th>
                    <td className="py-1.5 text-right text-slate-500">
                      {h.closed ? 'Closed' : `${h.open} – ${h.close}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-slate-500">Hours have not been published yet.</p>
          )}
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
          <h2 className="text-base font-bold text-slate-800 mb-3">Find us</h2>
          {content?.contact ? (
            <ul className="space-y-2 text-sm text-slate-600">
              {content.contact.address && <li>{content.contact.address}</li>}
              {content.contact.phone && (
                <li><a className="text-[var(--sf-primary)] font-semibold" href={`tel:${content.contact.phone}`}>{content.contact.phone}</a></li>
              )}
              {content.contact.email && (
                <li><a className="text-[var(--sf-primary)] font-semibold" href={`mailto:${content.contact.email}`}>{content.contact.email}</a></li>
              )}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Contact details coming soon.</p>
          )}
          <Link to={`${base}/contact`} className="inline-block mt-3 text-sm font-semibold text-[var(--sf-primary)] hover:underline">
            Contact page →
          </Link>
        </div>
      </section>
    </div>
  );
};

export default HomePage;
