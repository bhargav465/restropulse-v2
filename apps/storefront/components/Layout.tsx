import React from 'react';
import { Link, NavLink, useParams } from 'react-router-dom';
import { useStorefront } from '../store/StorefrontContext';
import { useCart } from '../store/CartContext';
import { useAuth } from '../store/AuthContext';

const NAV_LINKS: Array<{ to: string; label: string; end?: boolean }> = [
  { to: '', label: 'Home', end: true },
  { to: 'menu', label: 'Menu' },
  { to: 'dine-in', label: 'Dine-in' },
  { to: 'story', label: 'Our Story' },
  { to: 'about', label: 'About' },
  { to: 'contact', label: 'Contact' },
];

const FOOTER_LINKS: Array<{ to: string; label: string }> = [
  { to: 'faqs', label: 'FAQs' },
  { to: 'privacy', label: 'Privacy Policy' },
  { to: 'terms', label: 'Terms of Service' },
  { to: 'refund', label: 'Refund Policy' },
];

const Layout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { slug } = useParams<{ slug: string }>();
  const { content, restaurantName, storeOpen, loading } = useStorefront();
  const { count } = useCart();
  const { isLoggedIn } = useAuth();

  const base = `/${slug}`;
  const logoUrl = content?.theme?.logoUrl;
  const announcement = content?.announcement;

  return (
    <div className="flex flex-col min-h-screen bg-slate-50">
      <a
        href="#sf-main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 bg-white px-3 py-2 rounded-lg text-sm font-semibold shadow"
      >
        Skip to content
      </a>

      {/* Announcement bar */}
      {announcement?.enabled && announcement.text && (
        <div className="bg-[var(--sf-secondary)] text-white text-center text-xs sm:text-sm font-medium px-4 py-2" role="status">
          {announcement.text}
        </div>
      )}

      {/* Header */}
      <header className="sticky top-0 z-30 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between gap-3">
          <Link to={base} className="flex items-center gap-2 min-w-0" aria-label={`${restaurantName || 'Restaurant'} home`}>
            {logoUrl ? (
              <img src={logoUrl} alt={`${restaurantName} logo`} className="w-8 h-8 rounded-lg object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-lg bg-[var(--sf-primary)] flex items-center justify-center" aria-hidden="true">
                <span className="text-white font-bold">{(restaurantName || 'R')[0]}</span>
              </div>
            )}
            <span className="font-extrabold text-slate-800 truncate">{restaurantName || (loading ? '…' : 'Storefront')}</span>
            {!loading && (
              <span
                className={`hidden sm:inline text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${storeOpen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}
              >
                {storeOpen ? 'Open' : 'Closed'}
              </span>
            )}
          </Link>

          <div className="flex items-center gap-1.5">
            <Link
              to={`${base}/account`}
              className="px-3 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100"
            >
              {isLoggedIn ? 'Account' : 'Sign in'}
            </Link>
            <Link
              to={`${base}/cart`}
              className="relative px-3 py-2 rounded-xl bg-[var(--sf-primary)] text-white text-sm font-semibold hover:opacity-90"
              aria-label={`Cart, ${count} item${count === 1 ? '' : 's'}`}
            >
              Cart
              {count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-[var(--sf-secondary)] text-white text-[11px] font-bold flex items-center justify-center">
                  {count}
                </span>
              )}
            </Link>
          </div>
        </div>

        {/* Nav row */}
        <nav aria-label="Main navigation" className="max-w-5xl mx-auto px-4 overflow-x-auto no-scrollbar">
          <ul className="flex gap-1 pb-2">
            {NAV_LINKS.map((link) => (
              <li key={link.label}>
                <NavLink
                  to={link.to === '' ? base : `${base}/${link.to}`}
                  end={link.end}
                  className={({ isActive }) =>
                    `block px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap ${
                      isActive ? 'bg-[var(--sf-primary)] text-white' : 'text-slate-600 hover:bg-slate-100'
                    }`
                  }
                >
                  {link.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      {/* Main */}
      <main id="sf-main" className="flex-1 w-full max-w-5xl mx-auto px-4 py-6">
        {children}
      </main>

      {/* Footer */}
      <footer className="bg-[var(--sf-secondary)] text-slate-300 mt-8">
        <div className="max-w-5xl mx-auto px-4 py-8 grid gap-6 sm:grid-cols-3 text-sm">
          <div>
            <h2 className="text-white font-bold mb-2">{restaurantName}</h2>
            {content?.contact?.address && <p className="mb-1">{content.contact.address}</p>}
            {content?.contact?.phone && (
              <p className="mb-1">
                <a href={`tel:${content.contact.phone}`} className="hover:text-white">{content.contact.phone}</a>
              </p>
            )}
            {content?.contact?.email && (
              <p>
                <a href={`mailto:${content.contact.email}`} className="hover:text-white">{content.contact.email}</a>
              </p>
            )}
          </div>
          <nav aria-label="Footer navigation">
            <h2 className="text-white font-bold mb-2">Links</h2>
            <ul className="space-y-1">
              {FOOTER_LINKS.map((link) => (
                <li key={link.to}>
                  <Link to={`${base}/${link.to}`} className="hover:text-white">{link.label}</Link>
                </li>
              ))}
            </ul>
          </nav>
          <div>
            <h2 className="text-white font-bold mb-2">Follow us</h2>
            <ul className="space-y-1">
              {content?.socialLinks?.instagram && (
                <li><a href={content.socialLinks.instagram} target="_blank" rel="noreferrer" className="hover:text-white">Instagram</a></li>
              )}
              {content?.socialLinks?.facebook && (
                <li><a href={content.socialLinks.facebook} target="_blank" rel="noreferrer" className="hover:text-white">Facebook</a></li>
              )}
              {content?.socialLinks?.x && (
                <li><a href={content.socialLinks.x} target="_blank" rel="noreferrer" className="hover:text-white">X</a></li>
              )}
              {content?.socialLinks?.youtube && (
                <li><a href={content.socialLinks.youtube} target="_blank" rel="noreferrer" className="hover:text-white">YouTube</a></li>
              )}
            </ul>
          </div>
        </div>
        <div className="border-t border-slate-700 py-3 text-center text-xs text-slate-400">
          Powered by RestroPulse
        </div>
      </footer>
    </div>
  );
};

export default Layout;
