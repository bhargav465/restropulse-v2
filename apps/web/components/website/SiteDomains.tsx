import React, { useEffect, useState } from 'react';
import { sitesAPI, type SiteDomain, type SiteView } from '../../api';
import { Badge, Button, Card, SectionHeader } from '../ui';

const inputClass = 'w-full rounded-xl border border-[var(--rp-line)] bg-[var(--rp-surface)] px-3 py-2 text-sm text-[var(--rp-text)]';

const STATUS: Record<SiteDomain['status'], { label: string; tone: 'success' | 'warning' | 'danger' | 'muted' }> = {
    pending_dns: { label: 'Add DNS records', tone: 'warning' },
    verifying: { label: 'Checking', tone: 'muted' },
    active: { label: 'Connected', tone: 'success' },
    failed: { label: 'Not found yet', tone: 'danger' },
};

/** What the TLS state means for the owner, in one line. */
export function sslNote(d: SiteDomain): string | null {
    if (d.status !== 'active') return null;
    if (d.sslStatus === 'active') return 'Secure (https) and live.';
    if (d.sslStatus === 'failed') return "Ownership is confirmed. We're still setting up the secure certificate.";
    return 'Ownership is confirmed. The secure (https) address is switched on by the RestroPulse team, usually within a day.';
}

const CopyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        } catch {
            /* clipboard blocked: the value is still selectable */
        }
    };
    return (
        <div className="min-w-0">
            <span className="block text-[11px] uppercase tracking-wide text-[var(--rp-muted)]">{label}</span>
            <div className="flex items-center gap-2">
                <code className="min-w-0 break-all text-xs text-[var(--rp-text)]">{value}</code>
                <button type="button" onClick={() => void copy()} className="shrink-0 text-xs font-semibold text-[var(--rp-primary-strong)]" aria-label={`Copy ${label.toLowerCase()} ${value}`}>
                    {copied ? 'Copied' : 'Copy'}
                </button>
            </div>
        </div>
    );
};

const DomainCard: React.FC<{ domain: SiteDomain; busy: boolean; onVerify: () => void; onRemove: () => void }> = ({ domain, busy, onVerify, onRemove }) => {
    const status = STATUS[domain.status];
    const note = sslNote(domain);
    return (
        <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
                <h3 className="break-all text-sm font-bold text-[var(--rp-text)]">{domain.hostname}</h3>
                <Badge tone={status.tone}>{status.label}</Badge>
            </div>
            {domain.status !== 'active' && (
                <>
                    <p className="text-sm text-[var(--rp-muted)]">Add these two records where you bought the domain, then check.</p>
                    <ul className="space-y-2">
                        {domain.records.map((r) => (
                            <li key={r.type} className="grid gap-2 rounded-xl border border-[var(--rp-line)] p-3 sm:grid-cols-[4rem_1fr_1fr]">
                                <span className="text-xs font-bold text-[var(--rp-text)]">{r.type}</span>
                                <CopyValue label="Name" value={r.name} />
                                <CopyValue label="Value" value={r.value} />
                            </li>
                        ))}
                    </ul>
                </>
            )}
            {domain.lastError && <p className="text-sm text-[var(--rp-warning)]">{domain.lastError}</p>}
            {note && <p className="text-sm text-[var(--rp-muted)]">{note}</p>}
            <div className="flex flex-wrap gap-2">
                {domain.status !== 'active' && (
                    <Button onClick={onVerify} disabled={busy}>{busy ? 'Checking…' : 'Check DNS'}</Button>
                )}
                <Button variant="secondary" onClick={onRemove} disabled={busy}>Remove</Button>
            </div>
        </Card>
    );
};

/** The restaurant's website addresses and the owner's own domains. */
const SiteDomains: React.FC = () => {
    const [view, setView] = useState<SiteView | null>(null);
    const [hostname, setHostname] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState<string | null>(null);

    const load = () => sitesAPI.getSite().then(setView).catch((e: Error) => setError(e.message));
    useEffect(() => { void load(); }, []);

    if (!view) {
        return error
            ? <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>
            : <p className="text-sm text-[var(--rp-muted)]">Loading your website…</p>;
    }

    const replace = (d: SiteDomain) => setView({ ...view, domains: view.domains.map((x) => (x.id === d.id ? d : x)) });

    const run = async (key: string, fn: () => Promise<void>) => {
        setBusy(key);
        setError(null);
        try {
            await fn();
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(null);
        }
    };

    const add = () => run('add', async () => {
        const d = await sitesAPI.addDomain(hostname);
        setView({ ...view, domains: [...view.domains, d] });
        setHostname('');
    });
    const verify = (id: string) => run(id, async () => replace(await sitesAPI.verifyDomain(id)));
    const remove = (d: SiteDomain) => {
        if (!window.confirm(`Remove ${d.hostname}? Visitors to it will stop reaching your site.`)) return;
        void run(d.id, async () => {
            await sitesAPI.removeDomain(d.id);
            setView({ ...view, domains: view.domains.filter((x) => x.id !== d.id) });
        });
    };

    const live = view.subdomainUrl ?? view.previewUrl;
    const full = view.domains.length >= view.maxDomains;

    return (
        <div className="space-y-4">
            <SectionHeader title="Your website" subtitle="Your menu, offers and online ordering, on the web." />
            {error && <p role="alert" className="text-sm font-medium text-[var(--rp-danger)]">{error}</p>}

            <Card className="space-y-2">
                {!view.slug ? (
                    <p className="text-sm text-[var(--rp-muted)]">Choose a web address in Settings first. Your site is built from it.</p>
                ) : live ? (
                    <>
                        <p className="text-sm text-[var(--rp-muted)]">Your site is at</p>
                        <a href={live} target="_blank" rel="noopener noreferrer" className="break-all text-sm font-semibold text-[var(--rp-primary-strong)]">{live}</a>
                        {view.subdomainUrl && view.previewUrl && (
                            <p className="text-xs text-[var(--rp-muted)]">Preview link: <a href={view.previewUrl} target="_blank" rel="noopener noreferrer" className="break-all underline">{view.previewUrl}</a></p>
                        )}
                        <p className="text-xs text-[var(--rp-muted)]">Changes you publish in Menu, Offers and Site content show up within a minute.</p>
                    </>
                ) : (
                    <p className="text-sm text-[var(--rp-muted)]">Your site isn't live yet. It goes live when RestroPulse switches websites on.</p>
                )}
            </Card>

            <Card className="space-y-3">
                <h3 className="text-sm font-bold text-[var(--rp-text)]">Use your own domain</h3>
                {!view.domainsAvailable ? (
                    <p className="text-sm text-[var(--rp-muted)]">Own domains aren't available yet.</p>
                ) : (
                    <>
                        <label htmlFor="site-domain" className="block text-sm text-[var(--rp-muted)]">
                            Already own a domain? Connect it so customers find you at your own address.
                        </label>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                                id="site-domain"
                                className={inputClass}
                                placeholder="www.yourrestaurant.in"
                                value={hostname}
                                onChange={(e) => setHostname(e.target.value)}
                                disabled={full}
                            />
                            <Button onClick={() => void add()} disabled={full || !hostname.trim() || busy === 'add'}>
                                {busy === 'add' ? 'Adding…' : 'Connect'}
                            </Button>
                        </div>
                        {full && <p className="text-xs text-[var(--rp-muted)]">You can connect up to {view.maxDomains} domains.</p>}
                    </>
                )}
            </Card>

            {view.domains.map((d) => (
                <DomainCard key={d.id} domain={d} busy={busy === d.id} onVerify={() => void verify(d.id)} onRemove={() => remove(d)} />
            ))}
        </div>
    );
};

export default SiteDomains;
