import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Sparkles, Radar, ShoppingBag, Check, TrendingUp, Camera, Eye,
} from 'lucide-react';
import { subscriptionAPI } from '../api';
import type { SubscriptionPlan } from '@restropulse/shared';
import './Landing.css';

interface LandingProps {
    /** Primary CTA -- start on the free tier (no card): routes to the real OTP login. */
    onStartFree: () => void;
    /** Per-plan CTA -- begin that plan's free trial: routes to login, remembering the plan. */
    onSelectPlan: (planSlug: string) => void;
    /** Low-emphasis link for returning users. */
    onLogin: () => void;
}

/**
 * Marketing landing page, rendered pre-auth as the app's default view.
 * Single scrolling page (anchor nav), themed via the app's live --rp-* tokens
 * (see Landing.css). Copy is trimmed to what the product actually does today
 * (AI social Content Engine + Restaurant Intelligence); the rest is "Coming soon".
 */

// Curated, product-accurate marketing copy per plan slug. Prices always come
// from the API (source of truth); these describe the tier honestly against the
// real seeded limits (Starter = Instagram only, Growth = + Facebook, Premium = higher limits).
const PLAN_COPY: Record<string, { tagline: string; bullets: string[] }> = {
    starter: {
        tagline: 'Get your restaurant posting',
        bullets: [
            'AI content plan tuned to your cuisine',
            'Auto-publish to Instagram',
            'Approval queue — you okay every post',
            'Weekly posting schedule',
            'Email support',
        ],
    },
    growth: {
        tagline: 'Marketing on autopilot',
        bullets: [
            'Everything in Starter',
            'Instagram + Facebook auto-publish',
            'Higher weekly posting limits',
            'Restaurant Intelligence insights',
            'Priority support',
        ],
    },
    premium: {
        tagline: 'For ambitious, multi-outlet brands',
        bullets: [
            'Everything in Growth',
            'Highest posting limits',
            'Full Restaurant Intelligence + competitor tracking',
            'Adhoc posts on demand',
            'Dedicated onboarding & phone support',
        ],
    },
};

// Static fallback used if the plans API is unreachable. Uses the REAL seeded
// names and prices (rupees) so the page is never misleading.
const FALLBACK_PLANS: Array<{ slug: string; name: string; monthlyRupees: number }> = [
    { slug: 'starter', name: 'Starter', monthlyRupees: 2999 },
    { slug: 'growth', name: 'Growth', monthlyRupees: 9999 },
    { slug: 'premium', name: 'Premium', monthlyRupees: 16999 },
];

interface PlanCard {
    slug: string;
    name: string;
    monthlyRupees: number;
    tagline: string;
    bullets: string[];
    featured: boolean;
    badge?: string;
}

function buildCards(source: Array<{ slug: string; name: string; monthlyRupees: number }>): PlanCard[] {
    return source.map((p) => {
        const copy = PLAN_COPY[p.slug] ?? { tagline: '', bullets: [] };
        return {
            slug: p.slug,
            name: p.name,
            monthlyRupees: p.monthlyRupees,
            tagline: copy.tagline,
            bullets: copy.bullets,
            featured: p.slug === 'growth',
            badge: p.slug === 'growth' ? 'Most popular' : undefined,
        };
    });
}

const MARQUEE_TERMS = [
    'AI content strategy', 'Auto-publish to Instagram', 'Facebook publishing',
    'Approval queue', 'Competitor tracking', 'Restaurant Intelligence',
    'Content calendar', 'Caption generation', 'Nearby rankings',
];

const Landing: React.FC<LandingProps> = ({ onStartFree, onSelectPlan, onLogin }) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const pricingRef = useRef<HTMLDivElement>(null);
    const productRef = useRef<HTMLDivElement>(null);
    const [scrolled, setScrolled] = useState(false);

    const [plans, setPlans] = useState<PlanCard[]>(() => buildCards(FALLBACK_PLANS));

    // Hydrate real plans/prices from the public plans endpoint. Falls back to the
    // (correct) static list if the API is unreachable, so prices always match Razorpay.
    useEffect(() => {
        let active = true;
        subscriptionAPI.getPlans()
            .then((apiPlans: SubscriptionPlan[]) => {
                if (!active || !apiPlans?.length) return;
                const order: Record<string, number> = { starter: 0, growth: 1, premium: 2 };
                const mapped = [...apiPlans]
                    .sort((a, b) => (order[a.slug] ?? 99) - (order[b.slug] ?? 99))
                    .map((p) => ({ slug: p.slug, name: p.name, monthlyRupees: Math.round(p.pricing.monthly / 100) }));
                setPlans(buildCards(mapped));
            })
            .catch(() => { /* keep static fallback */ });
        return () => { active = false; };
    }, []);

    // Scroll-reveal + nav shadow, scoped to this component's scroll container.
    useEffect(() => {
        const container = scrollRef.current;
        if (!container) return;

        const onScroll = () => setScrolled(container.scrollTop > 8);
        container.addEventListener('scroll', onScroll, { passive: true });

        let io: IntersectionObserver | null = null;
        if ('IntersectionObserver' in window) {
            io = new IntersectionObserver((entries) => {
                entries.forEach((e) => {
                    if (!e.isIntersecting) return;
                    e.target.classList.add('in');
                    io!.unobserve(e.target);
                });
            }, { root: container, threshold: 0.18 });
            container.querySelectorAll('.reveal, .spark').forEach((el) => io!.observe(el));
        } else {
            container.querySelectorAll('.reveal, .spark').forEach((el) => el.classList.add('in'));
        }

        return () => {
            container.removeEventListener('scroll', onScroll);
            io?.disconnect();
        };
    }, [plans.length]);

    const scrollTo = (ref: React.RefObject<HTMLElement | null>) => {
        ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const scrollTop = () => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });

    const fmt = (n: number) => '₹' + n.toLocaleString('en-IN');

    const marquee = useMemo(() => [...MARQUEE_TERMS, ...MARQUEE_TERMS], []);

    const Wordmark = ({ small }: { small?: boolean }) => (
        <button className="wordmark" style={small ? { fontSize: 15 } : undefined} onClick={scrollTop} aria-label="RestroPulse home">
            Restro<b>pulse</b><span className="dot" />
        </button>
    );

    return (
        <div className="rp-landing" ref={scrollRef} style={{ height: '100%', overflowY: 'auto', overflowX: 'hidden' }}>
            <header className={`lp-header${scrolled ? ' scrolled' : ''}`}>
                <div className="wrap nav">
                    <Wordmark />
                    <nav className="nav-links">
                        <button className="linklike hide-m" onClick={() => scrollTo(productRef)}>Product</button>
                        <button className="linklike" onClick={() => scrollTo(pricingRef)}>Pricing</button>
                        <button className="linklike" onClick={onLogin}>Log in</button>
                        <button className="btn btn-primary nav-cta" onClick={onStartFree}>Start free</button>
                    </nav>
                </div>
            </header>

            <main>
                {/* ==================== HERO ==================== */}
                <div className="wrap">
                    <div className="hero">
                        <div className="aurora"><i /><i /><i /></div>
                        <span className="hero-chip reveal"><span className="live" /> AI social marketing + competitor intelligence</span>
                        <h1 className="reveal" style={{ '--d': '.08s' } as React.CSSProperties}>
                            Everything your restaurant needs to <span className="grad-text">market &amp; grow</span>
                        </h1>
                        <p className="lead reveal" style={{ '--d': '.16s' } as React.CSSProperties}>
                            RestroPulse plans, writes, and publishes your restaurant&rsquo;s social content &mdash;
                            and shows you exactly how you stack up against the restaurants nearby.
                            One elegant dashboard.
                        </p>
                        <div className="hero-ctas reveal" style={{ '--d': '.24s' } as React.CSSProperties}>
                            <button className="btn btn-primary" onClick={onStartFree}>Start free trial</button>
                            <button className="btn btn-ghost" onClick={() => scrollTo(pricingRef)}>See plans</button>
                        </div>
                        <p className="hero-note reveal" style={{ '--d': '.3s' } as React.CSSProperties}>
                            14 days free &middot; full access &middot; no credit card
                        </p>

                        {/* Dashboard preview */}
                        <div className="preview-zone reveal" style={{ '--d': '.2s' } as React.CSSProperties}>
                            <div className="float-chip chip-order">
                                <span className="ico" style={{ background: 'var(--primary-soft)', color: 'var(--primary-strong)' }}>
                                    <Camera size={16} />
                                </span>
                                <span>Post published<small>Instagram &middot; just now</small></span>
                            </div>
                            <div className="float-chip chip-rev">
                                <span className="ico" style={{ background: 'color-mix(in srgb, var(--success) 14%, transparent)', color: 'var(--success)' }}>
                                    <TrendingUp size={16} />
                                </span>
                                <span>Reach +18%<small>vs last week</small></span>
                            </div>
                            <div className="float-chip chip-post">
                                <span className="ico" style={{ background: 'color-mix(in srgb, var(--info) 16%, transparent)', color: 'var(--info)' }}>
                                    <Eye size={16} />
                                </span>
                                <span>New rival spotted<small>400m away &middot; 4.3&#9733;</small></span>
                            </div>

                            <div className="preview" aria-hidden="true">
                                <div className="preview-inner">
                                    <div className="preview-rail">
                                        <span className="wordmark">Restro<b>pulse</b></span>
                                        <div className="rail-item active">&#9672; Dashboard</div>
                                        <div className="rail-item">&#10022; Content</div>
                                        <div className="rail-item">&#9684; Intelligence</div>
                                    </div>
                                    <div className="preview-main">
                                        <div className="ptitle">Good evening, Spice Garden</div>
                                        <div className="psub">Here&rsquo;s how your restaurant is doing today</div>
                                        <div className="kpis">
                                            <div className="kpi"><div className="label">Posts this week</div><div className="num">6</div><div className="delta">on schedule</div></div>
                                            <div className="kpi"><div className="label">Pending approval</div><div className="num">3</div><div className="delta">review now</div></div>
                                            <div className="kpi"><div className="label">Local rank</div><div className="num">#2</div><div className="delta">&#9650; up 1</div></div>
                                            <div className="kpi"><div className="label">Reach</div><div className="num">+18%</div><div className="delta">this week</div></div>
                                        </div>
                                        <div className="spark">
                                            <span className="label">7-day reach</span>
                                            <div className="spark-bars">
                                                <i style={{ '--i': 0, height: '38%' } as React.CSSProperties} />
                                                <i style={{ '--i': 1, height: '52%' } as React.CSSProperties} />
                                                <i style={{ '--i': 2, height: '44%' } as React.CSSProperties} />
                                                <i style={{ '--i': 3, height: '66%' } as React.CSSProperties} />
                                                <i style={{ '--i': 4, height: '58%' } as React.CSSProperties} />
                                                <i style={{ '--i': 5, height: '82%' } as React.CSSProperties} />
                                                <i style={{ '--i': 6, height: '100%' } as React.CSSProperties} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ==================== MARQUEE ==================== */}
                <div className="marquee-band" aria-hidden="true">
                    <div className="marquee">
                        {marquee.map((term, i) => <span key={i}>{term}</span>)}
                    </div>
                </div>

                {/* ==================== PILLARS ==================== */}
                <section ref={productRef}>
                    <div className="wrap">
                        <div className="sec-head reveal">
                            <span className="label">The platform</span>
                            <h2>Two products. One login.</h2>
                            <p className="lead">Your social presence and your competitive edge, powered by the same restaurant data.</p>
                        </div>
                        <div className="pillars">
                            <div className="pillar reveal">
                                <div className="icon"><Sparkles size={22} /></div>
                                <h3>Content Engine</h3>
                                <p>AI that plans and writes your social media, so your feed stays alive while you run the kitchen.</p>
                                <ul>
                                    <li>Monthly content strategy for your cuisine</li>
                                    <li>Posts generated with your photos &amp; tone</li>
                                    <li>Approval queue &mdash; nothing publishes without you</li>
                                    <li>Auto-publish to Instagram &amp; Facebook</li>
                                </ul>
                            </div>
                            <div className="pillar reveal" style={{ '--d': '.12s' } as React.CSSProperties}>
                                <div className="icon"><Radar size={22} /></div>
                                <h3>Restaurant Intelligence</h3>
                                <p>Know exactly how you stack up against the restaurants competing for your guests.</p>
                                <ul>
                                    <li>Competitor discovery &amp; tracking nearby</li>
                                    <li>Ratings, pricing &amp; positioning compared</li>
                                    <li>Weekly trends and movement alerts</li>
                                    <li>Daily snapshots of your standing</li>
                                </ul>
                            </div>
                            <div className="pillar soon-pillar reveal" style={{ '--d': '.24s' } as React.CSSProperties}>
                                <span className="soon-tag">Coming soon</span>
                                <div className="icon"><ShoppingBag size={22} /></div>
                                <h3>Ordering, CRM &amp; Website</h3>
                                <p>On the roadmap &mdash; the tools to sell and retain, added to the same dashboard.</p>
                                <ul>
                                    <li>Commission-free online ordering</li>
                                    <li>Guest CRM &amp; WhatsApp campaigns</li>
                                    <li>Branded website builder</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ==================== HOW IT WORKS ==================== */}
                <section className="lp-secondary" style={{ paddingTop: 0 }}>
                    <div className="wrap">
                        <div className="sec-head reveal">
                            <span className="label">How it works</span>
                            <h2>Live in an afternoon</h2>
                        </div>
                        <div className="steps">
                            <div className="step reveal">
                                <div className="n">1</div>
                                <h3>Connect your restaurant</h3>
                                <p>Add your profile and connect Instagram &amp; Facebook.</p>
                            </div>
                            <div className="step reveal" style={{ '--d': '.12s' } as React.CSSProperties}>
                                <div className="n">2</div>
                                <h3>Approve your content plan</h3>
                                <p>AI drafts a monthly plan and each post; you approve before anything goes live.</p>
                            </div>
                            <div className="step reveal" style={{ '--d': '.24s' } as React.CSSProperties}>
                                <div className="n">3</div>
                                <h3>Publish &amp; outsmart rivals</h3>
                                <p>Auto-publish on schedule and track how you rank against nearby restaurants.</p>
                            </div>
                        </div>
                    </div>
                </section>

                {/* ==================== WHY BAND ==================== */}
                <section className="lp-secondary" style={{ paddingTop: 0 }}>
                    <div className="wrap">
                        <div className="band reveal">
                            <div>
                                <span className="label" style={{ color: 'var(--info)' }}>Why RestroPulse</span>
                                <h2>Marketing and market intelligence, in one place</h2>
                                <p>
                                    Most tools either post for you or watch your competitors &mdash; never both.
                                    RestroPulse writes your content and tells you how you stack up locally,
                                    from the same dashboard.
                                </p>
                                <button className="btn btn-primary" onClick={() => scrollTo(pricingRef)}>See plans</button>
                            </div>
                            <ul className="tick-list">
                                {[
                                    'AI content trained on restaurant marketing',
                                    'You approve every post before it publishes',
                                    'See how you rank against nearby restaurants',
                                    'One dashboard instead of scattered tools',
                                ].map((t) => (
                                    <li key={t}><Check size={16} color="var(--success)" strokeWidth={3} /> {t}</li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </section>

                {/* ==================== PRICING ==================== */}
                <div className="wrap" ref={pricingRef}>
                    <div className="pricing-head">
                        <div className="aurora"><i /><i /><i /></div>
                        <span className="label">Pricing</span>
                        <h2 style={{ fontSize: 38, marginTop: 12 }}>Simple plans that <span className="grad-text">grow with you</span></h2>
                        <p className="lead" style={{ marginTop: 14 }}>
                            Every plan starts with a 14-day free trial &mdash; full access, no credit card.
                        </p>
                    </div>
                    <div className="plans">
                        {plans.map((p) => (
                            <div key={p.slug} className={`plan${p.featured ? ' featured' : ''} reveal in`}>
                                {p.badge && <span className="badge">{p.badge}</span>}
                                <h3>{p.name}</h3>
                                <p className="tag">{p.tagline}</p>
                                <div className="price">
                                    <span className="amount">{fmt(p.monthlyRupees)}</span>
                                    <span className="period">/ month</span>
                                </div>
                                <p className="billed">billed monthly</p>
                                <ul>
                                    {p.bullets.map((f) => (
                                        <li key={f}><Check size={15} color="var(--primary-strong)" strokeWidth={3} /> {f}</li>
                                    ))}
                                </ul>
                                <button
                                    className={`btn ${p.featured ? 'btn-primary' : 'btn-ghost'} btn-block`}
                                    onClick={() => onSelectPlan(p.slug)}
                                >
                                    Start 14-day free trial
                                </button>
                            </div>
                        ))}
                    </div>
                    <p className="pricing-note">
                        14-day free trial &middot; no credit card &middot;
                        Prices in INR, exclusive of GST &middot; Payments powered by Razorpay &middot;
                        Need a custom plan for multiple outlets? <a href="mailto:hello.restropulse@baxel.in">Talk to us</a>
                    </p>
                </div>

                {/* ==================== FOOTER ==================== */}
                <footer className="lp-footer">
                    <div className="wrap foot">
                        <Wordmark small />
                        <nav className="nav-links">
                            <button className="linklike" onClick={() => scrollTo(productRef)}>Product</button>
                            <button className="linklike" onClick={() => scrollTo(pricingRef)}>Pricing</button>
                            <button className="linklike" onClick={onLogin}>Log in</button>
                            <a className="linklike" href="/privacy-policy">Privacy Policy</a>
                            <a className="linklike" href="/terms">Terms of Service</a>
                        </nav>
                        <span>&copy; {new Date().getFullYear()} RestroPulse</span>
                    </div>
                </footer>
            </main>
        </div>
    );
};

export default Landing;
