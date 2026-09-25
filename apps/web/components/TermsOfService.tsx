import React from 'react';

const LAST_UPDATED = 'August 10, 2026';

interface TermsOfServiceProps {
    onBack: () => void;
}

/**
 * Public, unauthenticated page served at /terms. Required by Meta's app
 * review (Terms of Service URL). Also linked from ProfileSheet's cancellation
 * dialog via /terms#cancellation -- keep that section id stable.
 */
const TermsOfService: React.FC<TermsOfServiceProps> = ({ onBack }) => {
    return (
        <div className="min-h-screen bg-canvas text-ink">
            <header className="border-b border-line bg-surface">
                <div className="max-w-3xl mx-auto px-6 py-5 flex items-center justify-between">
                    <a href="/" onClick={(e) => { e.preventDefault(); onBack(); }} className="text-lg font-bold text-ink">
                        RestroPulse
                    </a>
                    <a href="/" onClick={(e) => { e.preventDefault(); onBack(); }} className="text-sm font-medium text-primary-strong hover:underline">
                        Back to home
                    </a>
                </div>
            </header>

            <main className="max-w-3xl mx-auto px-6 py-12">
                <h1 className="text-3xl font-bold text-ink mb-2">Terms of Service</h1>
                <p className="text-sm text-muted mb-10">Last updated: {LAST_UPDATED}</p>

                <div className="space-y-10 text-sm leading-relaxed text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:mb-3 [&_p]:mb-3 [&_p]:text-muted [&_li]:text-muted [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-primary-strong [&_a]:underline">

                    <section>
                        <p>
                            These Terms of Service (&quot;Terms&quot;) govern your use of RestroPulse, a social media
                            management platform for restaurants (&quot;Service&quot;) operated by Baxel Technologies
                            Pvt Ltd (&quot;Baxel Technologies&quot;, &quot;we&quot;, &quot;us&quot;). By creating an
                            account or using the Service, you agree to these Terms. If you are using RestroPulse on
                            behalf of a restaurant or business, you confirm you are authorized to act on its behalf.
                        </p>
                    </section>

                    <section>
                        <h2>The service</h2>
                        <p>
                            RestroPulse helps restaurants plan, generate, schedule, and publish content to Instagram
                            and Facebook via the Meta Graph API, and provides Restaurant Intelligence (competitor and
                            market analysis) and AI-assisted content generation. Features and pricing may change as
                            the product evolves; we will make reasonable efforts to communicate material changes.
                        </p>
                    </section>

                    <section>
                        <h2>Account registration</h2>
                        <p>
                            You sign in using phone number verification (OTP). You are responsible for keeping access
                            to your registered phone number secure, and for the accuracy of the restaurant information
                            you provide during onboarding.
                        </p>
                    </section>

                    <section>
                        <h2>Free trial and subscriptions</h2>
                        <ul>
                            <li>New accounts start with a free trial (no card required) for a limited number of days shown at signup.</li>
                            <li>Paid plans are billed monthly or annually through Razorpay, in INR, exclusive of applicable taxes (e.g. GST).</li>
                            <li>Some post types consume credits from your plan's included allowance (for example, image posts, carousels, and reels have different credit costs). Additional credits can be purchased separately as credit packs.</li>
                            <li>If a payment fails, your subscription may enter a past-due or halted state per Razorpay's retry schedule; continued non-payment may result in suspension of paid features until resolved or cancelled.</li>
                        </ul>
                    </section>

                    <section id="cancellation">
                        <h2>Cancellation and refunds</h2>
                        <ul>
                            <li>You can cancel your subscription at any time from Profile &gt; Subscription in the app.</li>
                            <li>When you cancel, your current plan and its features remain active until the end of the billing period you already paid for. After that, your account moves to free/credit-based usage rather than being deleted.</li>
                            <li>Fees already paid are non-refundable for the remaining portion of a billing period, except where required by applicable law.</li>
                            <li>Purchased one-time credit packs are non-refundable once the purchase is completed, except where required by applicable law.</li>
                            <li>We may suspend or cancel a subscription for non-payment, fraud, or breach of these Terms.</li>
                        </ul>
                    </section>

                    <section>
                        <h2>Your responsibilities</h2>
                        <ul>
                            <li>You are responsible for the accuracy of the restaurant details, offers, and content you submit or approve for publishing.</li>
                            <li>You must own or have the rights to any content (images, video, text) you upload or approve, and must not use the Service to publish content that is unlawful, infringing, or violates Meta's own platform policies.</li>
                            <li>You are responsible for reviewing AI-generated captions, images, and video before approving them for publishing -- AI-generated content may occasionally be inaccurate or require edits.</li>
                            <li>You must comply with Instagram's and Facebook's own terms of service and community standards, since RestroPulse publishes on your behalf using your authorized Meta account.</li>
                        </ul>
                    </section>

                    <section>
                        <h2>Content ownership</h2>
                        <p>
                            You retain ownership of the content you create or upload. By using RestroPulse to schedule
                            or publish that content, you grant us a limited license to store, process, and transmit it
                            to Instagram/Facebook (and to AI providers we use for generation) solely to provide the
                            Service to you.
                        </p>
                    </section>

                    <section>
                        <h2>Third-party platforms</h2>
                        <p>
                            Publishing depends on the Meta Graph API and your connected Instagram/Facebook account
                            remaining authorized and in good standing. RestroPulse is not responsible for outages,
                            API changes, rate limits, or account actions (including suspensions) taken by Meta,
                            Google, Razorpay, or any other third-party platform we integrate with.
                        </p>
                    </section>

                    <section>
                        <h2>Service availability</h2>
                        <p>
                            We aim for reliable service but do not guarantee uninterrupted availability. Scheduled
                            posts are published by a background worker that runs at regular intervals (typically every
                            few minutes), not instantaneously. We are not liable for missed publishing windows caused
                            by third-party platform failures outside our control.
                        </p>
                    </section>

                    <section>
                        <h2>Limitation of liability</h2>
                        <p>
                            To the maximum extent permitted by law, RestroPulse and its operators are not liable for
                            indirect, incidental, or consequential damages arising from your use of the Service,
                            including lost revenue, lost content, or account actions taken by third-party platforms.
                            Our total liability for any claim relating to the Service is limited to the amount you
                            paid us in the twelve months preceding the claim.
                        </p>
                    </section>

                    <section>
                        <h2>Termination</h2>
                        <p>
                            You may stop using the Service and delete your account at any time. We may suspend or
                            terminate your access if you breach these Terms, misuse the Service, or if required to do
                            so by a third-party platform (such as Meta) whose API we depend on.
                        </p>
                    </section>

                    <section>
                        <h2>Governing law</h2>
                        <p>
                            These Terms are governed by the laws of India, without regard to conflict-of-law
                            principles, and are between you and Baxel Technologies Pvt Ltd.
                        </p>
                    </section>

                    <section>
                        <h2>Changes to these terms</h2>
                        <p>
                            We may update these Terms from time to time. If we make material changes, we will update
                            the &quot;Last updated&quot; date above and, where appropriate, notify you in the app.
                        </p>
                    </section>

                    <section>
                        <h2>Contact us</h2>
                        <p>
                            RestroPulse is operated by Baxel Technologies Pvt Ltd. Questions about these Terms can be
                            sent to <a href="mailto:hello.restropulse@baxel.in">hello.restropulse@baxel.in</a>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
};

export default TermsOfService;
