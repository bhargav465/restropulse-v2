import React from 'react';
import type { IntelligenceNotification } from '@restropulse/shared';
import { relativeTime, SEVERITY_DOT } from './notifications';

/**
 * "While you were away" — the landing card at the top of Intelligence when there
 * are unread items in the feed. Answers "why should I look today?" before the
 * score dial does. Shows the top three, links each into the right tab, and
 * marks the feed seen on dismiss. Hidden entirely when there is nothing unread:
 * an empty nudge trains people to ignore the real ones.
 */
const WhileYouWereAway: React.FC<{
    items: IntelligenceNotification[];
    onOpen: (n: IntelligenceNotification) => void;
    onDismiss: () => void;
}> = ({ items, onOpen, onDismiss }) => {
    const unread = items.filter((n) => n.unread);
    if (unread.length === 0) return null;
    const top = unread.slice(0, 3);
    const more = unread.length - top.length;

    return (
        <section
            aria-label="While you were away"
            data-testid="while-you-were-away"
            className="bg-surface rounded-2xl p-4 sm:p-5 border border-line border-l-[3px] border-l-primary"
        >
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-base font-semibold text-ink">While you were away</h3>
                    <p className="text-xs text-muted mt-0.5">
                        {unread.length === 1 ? '1 thing changed' : `${unread.length} things changed`} since you last looked.
                    </p>
                </div>
                <button type="button" onClick={onDismiss} className="text-xs font-semibold text-muted hover:text-ink whitespace-nowrap">
                    Got it
                </button>
            </div>
            <ul className="mt-3 grid gap-2">
                {top.map((n) => (
                    <li key={n.id}>
                        <button
                            type="button"
                            onClick={() => onOpen(n)}
                            className="w-full text-left rounded-xl border border-line px-3 py-2.5 hover:border-primary/40 hover:bg-primary-soft transition-colors flex items-start gap-2.5"
                        >
                            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[n.severity]}`} aria-hidden="true" />
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-semibold text-ink leading-snug">{n.title}</span>
                                {n.body && <span className="block text-xs text-muted mt-0.5 leading-relaxed">{n.body}</span>}
                            </span>
                            <span className="text-[11px] text-muted whitespace-nowrap">{relativeTime(n.at)}</span>
                        </button>
                    </li>
                ))}
            </ul>
            {more > 0 && <p className="text-xs text-muted mt-2">And {more} more in the bell at the top.</p>}
        </section>
    );
};

export default WhileYouWereAway;
