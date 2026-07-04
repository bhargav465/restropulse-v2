import React from 'react';
import { useStorefront } from '../store/StorefrontContext';
import { Loading, ErrorState } from '../components/States';

export type StaticPageKey = 'about' | 'contact' | 'faqs' | 'privacy' | 'terms' | 'refund';

const TITLES: Record<StaticPageKey, string> = {
  about: 'About Us',
  contact: 'Contact',
  faqs: 'FAQs',
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  refund: 'Refund Policy',
};

const DEFAULT_FAQS: Array<{ q: string; a: string }> = [
  { q: 'How do I place an order?', a: 'Browse the menu, add dishes to your cart and check out. You can choose delivery or pickup depending on what the restaurant offers.' },
  { q: 'How do I pay?', a: 'Online payment is coming soon. For now, orders are paid on delivery or at pickup.' },
  { q: 'Can I track my order?', a: 'Yes — after placing an order you get a live tracking page that updates automatically.' },
  { q: 'Can I reserve a table?', a: 'If the restaurant accepts reservations, use the Dine-in page to request a table. The restaurant confirms by phone.' },
  { q: 'How do I cancel or change an order?', a: 'Call the restaurant directly using the phone number on the Contact page as soon as possible.' },
];

const StaticPage: React.FC<{ page: StaticPageKey }> = ({ page }) => {
  const { content, restaurantName, loading, error, reload } = useStorefront();

  if (loading) return <Loading />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const name = restaurantName || 'the restaurant';
  const contact = content?.contact;

  const renderBody = () => {
    switch (page) {
      case 'about':
        return (
          <p className="text-sm text-slate-600 whitespace-pre-line">
            {content?.about || `Welcome to ${name}. We serve honest, delicious food made with care. Our full story is coming soon.`}
          </p>
        );
      case 'contact':
        return (
          <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
              <h2 className="text-sm font-bold text-slate-700 mb-3">Get in touch</h2>
              {contact ? (
                <ul className="space-y-2 text-sm text-slate-600">
                  {contact.address && <li><span className="font-semibold">Address:</span> {contact.address}</li>}
                  {contact.phone && (
                    <li><span className="font-semibold">Phone:</span>{' '}
                      <a href={`tel:${contact.phone}`} className="text-[var(--sf-primary)] font-semibold">{contact.phone}</a>
                    </li>
                  )}
                  {contact.email && (
                    <li><span className="font-semibold">Email:</span>{' '}
                      <a href={`mailto:${contact.email}`} className="text-[var(--sf-primary)] font-semibold">{contact.email}</a>
                    </li>
                  )}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Contact details haven't been published yet.</p>
              )}
            </div>
            {content?.hours && content.hours.length > 0 && (
              <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h2 className="text-sm font-bold text-slate-700 mb-3">Opening hours</h2>
                <table className="w-full text-sm">
                  <caption className="sr-only">Weekly opening hours</caption>
                  <tbody>
                    {content.hours.map((h) => (
                      <tr key={h.day} className="border-b border-slate-100 last:border-0">
                        <th scope="row" className="py-1.5 text-left font-medium text-slate-600">{h.day}</th>
                        <td className="py-1.5 text-right text-slate-500">{h.closed ? 'Closed' : `${h.open} – ${h.close}`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      case 'faqs':
        return (
          <div className="space-y-3">
            {DEFAULT_FAQS.map((faq, i) => (
              <details key={i} className="bg-white rounded-2xl border border-slate-200 p-4 group">
                <summary className="text-sm font-bold text-slate-700 cursor-pointer list-none flex justify-between items-center">
                  {faq.q}
                  <span className="text-slate-400 group-open:rotate-180 transition-transform" aria-hidden="true">▾</span>
                </summary>
                <p className="text-sm text-slate-600 mt-2">{faq.a}</p>
              </details>
            ))}
          </div>
        );
      case 'privacy':
        return (
          <div className="prose-sm text-sm text-slate-600 space-y-3">
            <p>{name} collects only the information needed to serve you: your name, contact details, delivery addresses and order history.</p>
            <p>Your data is used to prepare and deliver your orders, confirm reservations and improve our service. We do not sell your personal information to third parties.</p>
            <p>Anonymous usage analytics (such as page views) help us understand how the site is used. You can request deletion of your account data by contacting us.</p>
          </div>
        );
      case 'terms':
        return (
          <div className="prose-sm text-sm text-slate-600 space-y-3">
            <p>By placing an order on this site you agree to provide accurate contact and delivery information, and to be available to receive your order.</p>
            <p>Menu prices, availability and delivery areas are set by {name} and may change without notice. Orders are subject to acceptance by the restaurant.</p>
            <p>Reservation requests are not confirmed until the restaurant contacts you. The restaurant may decline requests at busy times.</p>
          </div>
        );
      case 'refund':
        return (
          <div className="prose-sm text-sm text-slate-600 space-y-3">
            <p>If there is a problem with your order — missing items, wrong dishes or quality issues — contact {name} directly as soon as possible{contact?.phone ? ` on ${contact.phone}` : ''}.</p>
            <p>Since online payment is not yet live, orders are settled on delivery or at pickup; adjustments for issues are handled directly by the restaurant.</p>
            <p>Cancelled orders that were already paid for will be refunded through the original payment method once online payments launch.</p>
          </div>
        );
    }
  };

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-xl font-extrabold text-slate-800 mb-4">{TITLES[page]}</h1>
      {renderBody()}
    </div>
  );
};

export default StaticPage;
