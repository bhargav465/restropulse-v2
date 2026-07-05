import React, { useCallback, useEffect, useState } from 'react';
import { Users, Clock } from 'lucide-react';
import { Reservation, ReservationStatus } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import { ActionNotice } from '../ActionNotice';
import { PanelLoading, PanelError, PanelEmpty } from './PanelStates';

const STATUS_BADGE: Record<ReservationStatus, string> = {
    pending: 'bg-amber-50 text-amber-700',
    confirmed: 'bg-emerald-50 text-emerald-700',
    declined: 'bg-red-50 text-red-600',
    no_show: 'bg-slate-100 text-slate-500',
};

const STATUS_LABELS: Record<ReservationStatus, string> = {
    pending: 'Pending',
    confirmed: 'Confirmed',
    declined: 'Declined',
    no_show: 'No-show',
};

function todayISO(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

const ReservationsPanel: React.FC = () => {
    const [date, setDate] = useState(todayISO());
    const [reservations, setReservations] = useState<Reservation[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [updatingId, setUpdatingId] = useState<string | null>(null);

    const load = useCallback(async (forDate: string) => {
        setReservations(null);
        setError(null);
        try {
            setReservations(await orderingAdminAPI.getReservations({ date: forDate }));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load reservations');
        }
    }, []);

    useEffect(() => { load(date); }, [load, date]);

    const decide = async (reservation: Reservation, status: 'confirmed' | 'declined' | 'no_show') => {
        setUpdatingId(reservation.id);
        try {
            const updated = await orderingAdminAPI.decideReservation(reservation.id, status);
            setReservations((prev) => prev?.map((r) => (r.id === updated.id ? updated : r)) ?? prev);
        } catch (err) {
            setNotice({ message: err instanceof Error ? err.message : 'Failed to update reservation', type: 'error' });
        } finally {
            setUpdatingId(null);
        }
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-2">
                <label htmlFor="reservations-date" className="text-xs font-bold text-slate-500 uppercase tracking-wide">Date</label>
                <input
                    id="reservations-date"
                    type="date"
                    value={date}
                    onChange={(e) => e.target.value && setDate(e.target.value)}
                    className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-sm font-medium text-slate-700"
                />
            </div>

            {notice && <ActionNotice message={notice.message} type={notice.type} onDismiss={() => setNotice(null)} />}

            {error ? (
                <PanelError message={error} onRetry={() => load(date)} />
            ) : reservations === null ? (
                <PanelLoading label="Loading reservations…" />
            ) : reservations.length === 0 ? (
                <PanelEmpty title="No reservations" hint={`No reservations for ${date}.`} />
            ) : (
                <div className="space-y-3">
                    {reservations.map((reservation) => {
                        const busy = updatingId === reservation.id;
                        return (
                            <div key={reservation.id} className="bg-white rounded-2xl border border-slate-100 shadow-sm p-4">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div>
                                        <p className="font-extrabold text-slate-800 text-sm">{reservation.name}</p>
                                        <p className="text-xs text-slate-500 font-medium">{reservation.phone}{reservation.email ? ` · ${reservation.email}` : ''}</p>
                                    </div>
                                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide shrink-0 ${STATUS_BADGE[reservation.status]}`}>
                                        {STATUS_LABELS[reservation.status]}
                                    </span>
                                </div>
                                <div className="flex items-center gap-4 text-xs text-slate-600 font-medium mb-1">
                                    <span className="flex items-center gap-1"><Clock size={12} /> {reservation.time}</span>
                                    <span className="flex items-center gap-1"><Users size={12} /> Party of {reservation.partySize}</span>
                                </div>
                                {reservation.notes && <p className="text-xs text-slate-400 italic mb-1">“{reservation.notes}”</p>}

                                {reservation.status === 'pending' && (
                                    <div className="flex gap-2 mt-3">
                                        <button onClick={() => decide(reservation, 'confirmed')} disabled={busy} className="flex-1 py-2 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 active:scale-95 transition-all disabled:opacity-50">Confirm</button>
                                        <button onClick={() => decide(reservation, 'declined')} disabled={busy} className="flex-1 py-2 rounded-xl bg-white border border-red-200 text-red-600 text-xs font-bold hover:bg-red-50 active:scale-95 transition-all disabled:opacity-50">Decline</button>
                                    </div>
                                )}
                                {reservation.status === 'confirmed' && (
                                    <div className="flex gap-2 mt-3">
                                        <button onClick={() => decide(reservation, 'no_show')} disabled={busy} className="flex-1 py-2 rounded-xl bg-white border border-slate-200 text-slate-500 text-xs font-bold hover:bg-slate-50 active:scale-95 transition-all disabled:opacity-50">Mark no-show</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

export default ReservationsPanel;
