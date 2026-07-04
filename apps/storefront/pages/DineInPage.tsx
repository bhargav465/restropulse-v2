import React, { useMemo, useState } from 'react';
import type { ReservationSlotConfig } from '@restropulse/shared';
import { useStorefront } from '../store/StorefrontContext';
import { reservationAPI } from '../api';
import { Loading, ErrorState } from '../components/States';

const DEFAULT_SLOTS: ReservationSlotConfig = {
  daysAhead: 7,
  slotMinutes: 30,
  maxPartySize: 10,
  startTime: '12:00',
  endTime: '22:00',
};

function generateTimeSlots(config: ReservationSlotConfig): string[] {
  const [startH, startM] = config.startTime.split(':').map(Number);
  const [endH, endM] = config.endTime.split(':').map(Number);
  const start = startH * 60 + startM;
  const end = endH * 60 + endM;
  const step = Math.max(config.slotMinutes, 5);
  const slots: string[] = [];
  for (let mins = start; mins <= end; mins += step) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
  }
  return slots;
}

function toDateInputValue(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const DineInPage: React.FC = () => {
  const { slug, content, ordering, loading, error, reload } = useStorefront();
  const slotConfig = content?.reservations ?? DEFAULT_SLOTS;
  const timeSlots = useMemo(() => generateTimeSlots(slotConfig), [slotConfig]);

  const today = new Date();
  const maxDate = new Date(today.getTime() + slotConfig.daysAhead * 24 * 60 * 60 * 1000);

  const [form, setForm] = useState({
    date: toDateInputValue(today),
    time: timeSlots[0] ?? '19:00',
    partySize: 2,
    name: '',
    phone: '',
    email: '',
    notes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (loading) return <Loading label="Loading dine-in info…" />;
  if (error) return <ErrorState message={error} onRetry={reload} />;

  const dineInEnabled = ordering.dineIn?.enabled !== false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      await reservationAPI.create(slug, {
        date: form.date,
        time: form.time,
        partySize: form.partySize,
        name: form.name,
        phone: form.phone,
        ...(form.email.trim() ? { email: form.email.trim() } : {}),
        ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
      });
      setSubmitted(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to request the reservation');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-extrabold text-slate-800">Dine in with us</h1>

      {/* Reservation widget */}
      <section aria-labelledby="reservation-heading" className="bg-white rounded-2xl border border-slate-200 p-5 max-w-xl">
        <h2 id="reservation-heading" className="text-base font-bold text-slate-800 mb-1">Reserve a table</h2>
        {!dineInEnabled ? (
          <p className="text-sm text-slate-500">Table reservations are not available at this restaurant right now.</p>
        ) : submitted ? (
          <div role="status">
            <p className="text-sm font-semibold text-green-700 mt-2">
              Reservation requested! The restaurant will confirm it shortly — you'll hear from them on the phone number you provided.
            </p>
            <button
              onClick={() => { setSubmitted(false); setForm((f) => ({ ...f, notes: '' })); }}
              className="mt-3 text-sm font-semibold text-[var(--sf-primary)] hover:underline"
            >
              Make another reservation
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3 mt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="res-date" className="block text-xs font-bold text-slate-600 mb-1">Date *</label>
                <input
                  id="res-date"
                  type="date"
                  required
                  min={toDateInputValue(today)}
                  max={toDateInputValue(maxDate)}
                  value={form.date}
                  onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
                />
              </div>
              <div>
                <label htmlFor="res-time" className="block text-xs font-bold text-slate-600 mb-1">Time *</label>
                <select
                  id="res-time"
                  required
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
                >
                  {timeSlots.map((slot) => <option key={slot} value={slot}>{slot}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label htmlFor="res-party" className="block text-xs font-bold text-slate-600 mb-1">
                Party size * <span className="font-normal text-slate-400">(max {slotConfig.maxPartySize})</span>
              </label>
              <select
                id="res-party"
                value={form.partySize}
                onChange={(e) => setForm((f) => ({ ...f, partySize: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white"
              >
                {Array.from({ length: Math.max(slotConfig.maxPartySize, 1) }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>{n} {n === 1 ? 'guest' : 'guests'}</option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="res-name" className="block text-xs font-bold text-slate-600 mb-1">Name *</label>
                <input
                  id="res-name"
                  type="text"
                  required
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  autoComplete="name"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
              <div>
                <label htmlFor="res-phone" className="block text-xs font-bold text-slate-600 mb-1">Phone *</label>
                <input
                  id="res-phone"
                  type="tel"
                  required
                  value={form.phone}
                  onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                  autoComplete="tel"
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
                />
              </div>
            </div>
            <div>
              <label htmlFor="res-email" className="block text-xs font-bold text-slate-600 mb-1">Email</label>
              <input
                id="res-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                autoComplete="email"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </div>
            <div>
              <label htmlFor="res-notes" className="block text-xs font-bold text-slate-600 mb-1">Notes</label>
              <textarea
                id="res-notes"
                rows={2}
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Birthday, window seat, high chair…"
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </div>
            {submitError && <p className="text-sm text-red-600 font-semibold" role="alert">{submitError}</p>}
            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3 rounded-xl bg-[var(--sf-primary)] text-white font-bold text-sm hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? 'Requesting…' : 'Request reservation'}
            </button>
          </form>
        )}
      </section>

      {/* Dine-in info blocks */}
      {content?.dineIn && content.dineIn.length > 0 && (
        <section aria-label="Dining information" className="grid gap-4 sm:grid-cols-2">
          {content.dineIn.map((block, i) => (
            <article key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
              {block.image && <img src={block.image} alt={block.title} className="w-full h-36 object-cover" />}
              <div className="p-4">
                <h2 className="text-base font-bold text-slate-800 mb-1">{block.title}</h2>
                <p className="text-sm text-slate-600">{block.text}</p>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Gallery */}
      {content?.gallery && content.gallery.length > 0 && (
        <section aria-labelledby="gallery-heading">
          <h2 id="gallery-heading" className="text-lg font-bold text-slate-800 mb-3">Gallery</h2>
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {content.gallery.map((url, i) => (
              <li key={i}>
                <img src={url} alt={`Restaurant gallery photo ${i + 1}`} className="w-full h-32 sm:h-40 object-cover rounded-xl" loading="lazy" />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default DineInPage;
