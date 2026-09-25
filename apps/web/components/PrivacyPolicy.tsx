import React from 'react';

const LAST_UPDATED = 'August 10, 2026';

interface PrivacyPolicyProps {
    onBack: () => void;
}

/**
 * Public, unauthenticated page served at /privacy-policy. Required by Meta's
 * app review (Privacy Policy URL) and by Google Maps/Firebase platform policies.
 * Rendered outside the SPA's auth gate -- see App.tsx pathname check.
 */
const PrivacyPolicy: React.FC<PrivacyPolicyProps> = ({ onBack }) => {
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
                <h1 className="text-3xl font-bold text-ink mb-2">Privacy Policy</h1>
                <p className="text-sm text-muted mb-10">Last updated: {LAST_UPDATED}</p>

                <div className="space-y-10 text-sm leading-relaxed text-ink [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink [&_h2]:mb-3 [&_p]:mb-3 [&_p]:text-muted [&_li]:text-muted [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1.5 [&_a]:text-primary-strong [&_a]:underline">

                    <section>
                        <p>
                            RestroPulse (&quot;RestroPulse&quot;, &quot;we&quot;, &quot;us&quot;) is a product of Baxel
                            Technologies Pvt Ltd, and provides a social media management platform for restaurants,
                            including content scheduling, AI-assisted content generation, and Restaurant Intelligence
                            (competitor and market analysis). This policy explains what information we collect through
                            the RestroPulse web app, how we use it, and the choices you have. It applies to restaurant
                            owners and staff who create a RestroPulse account (&quot;you&quot;).
                        </p>
                    </section>

                    <section>
                        <h2>Information we collect</h2>
                        <ul>
                            <li><strong>Account information:</strong> your phone number (verified via one-time passcode through Firebase Authentication), and optionally your name and email address.</li>
                            <li><strong>Restaurant information:</strong> restaurant name, cuisine, address and location (collected via Google Maps/Places during onboarding), and business details you add such as offers, chef specials, and menu updates.</li>
                            <li><strong>Instagram / Facebook data:</strong> when you connect your Instagram or Facebook account, Meta's OAuth flow shares your Page and Instagram Business Account profile information with us, and issues an access token that lets RestroPulse publish posts on your behalf. Access tokens are encrypted (AES-256) before storage and are never shown in plain text.</li>
                            <li><strong>Content you create:</strong> captions, images, videos, and scheduling details for posts you create or approve, whether written by you or generated with AI assistance.</li>
                            <li><strong>Billing information:</strong> subscription and payment records are processed by Razorpay. RestroPulse does not receive or store your card, UPI, or bank account details -- Razorpay handles that directly and is independently PCI-DSS compliant.</li>
                            <li><strong>Usage data:</strong> basic product analytics (pages viewed, feature usage, error diagnostics) collected via Azure Application Insights. Our logging pipeline is configured to never record personal fields such as phone numbers, emails, addresses, names, or access tokens.</li>
                        </ul>
                    </section>

                    <section>
                        <h2>How we use your information</h2>
                        <ul>
                            <li>To operate the service: publish and schedule your posts to Instagram/Facebook, generate content suggestions, and run Restaurant Intelligence scans of nearby competitors.</li>
                            <li>To manage your account, subscription, trial, and billing with Razorpay.</li>
                            <li>To communicate with you about your account, service changes, or support requests.</li>
                            <li>To maintain and improve the reliability and security of the platform.</li>
                            <li>To comply with legal obligations, including Meta's platform requirements and tax/billing recordkeeping.</li>
                        </ul>
                    </section>

                    <section>
                        <h2>Third-party services we use</h2>
                        <p>RestroPulse relies on the following processors to provide the service. Each only receives the data necessary to perform its function:</p>
                        <ul>
                            <li><strong>Meta Graph API</strong> (Instagram/Facebook) -- to publish content and read basic Page/account information you authorize.</li>
                            <li><strong>Firebase Authentication</strong> (Google) -- to verify your phone number via OTP.</li>
                            <li><strong>Razorpay</strong> -- to process subscription payments and generate invoices.</li>
                            <li><strong>Google Maps / Places API</strong> -- to look up your restaurant's address during onboarding and for competitor discovery in Restaurant Intelligence.</li>
                            <li><strong>Anthropic, Replicate, Google Calendar API, and Perplexity</strong> -- to generate AI captions, images/video, and current-affairs-aware content suggestions where enabled for your account.</li>
                            <li><strong>Microsoft Azure</strong> (App Service, Key Vault, Application Insights) and <strong>MongoDB Atlas</strong> -- to host the application, secure credentials, and store your account data.</li>
                        </ul>
                        <p>We do not sell your personal information, and we do not share it with third parties for their own marketing purposes.</p>
                    </section>

                    <section>
                        <h2>Data retention</h2>
                        <p>
                            We retain your account and restaurant data for as long as your account is active. If you
                            delete your account, your records are removed or anonymized as described below, subject to
                            what we are required to retain for billing, tax, or legal recordkeeping (for example,
                            Razorpay invoices).
                        </p>
                    </section>

                    <section>
                        <h2>Your rights and how to delete your data</h2>
                        <ul>
                            <li><strong>Disconnect Instagram/Facebook:</strong> revoke RestroPulse's access anytime from your Meta Business Suite or Facebook app settings, or from RestroPulse's Profile &gt; Instagram settings. This immediately deactivates the stored access token.</li>
                            <li><strong>Request account deletion:</strong> where enabled, you can delete your account and all associated data directly from Profile settings inside the app. This cancels any active subscription and permanently deletes your restaurant, posts, and account records.</li>
                            <li><strong>Meta Data Deletion requests:</strong> if you remove RestroPulse via Facebook's &quot;Apps and Websites&quot; settings, Meta notifies us automatically and we process the deletion request per Meta's Data Deletion Callback requirements.</li>
                            <li><strong>Access or correction requests:</strong> email us at <a href="mailto:hello.restropulse@baxel.in">hello.restropulse@baxel.in</a> to request a copy of your data, ask us to correct it, or ask us to delete it manually if in-app deletion is unavailable to you.</li>
                        </ul>
                    </section>

                    <section>
                        <h2>Data security</h2>
                        <p>
                            Instagram/Facebook access tokens are encrypted at rest (AES-256). Application secrets and
                            connection strings are stored in Azure Key Vault, not in application code. Traffic between
                            your browser and our servers is encrypted in transit (HTTPS/TLS).
                        </p>
                    </section>

                    <section>
                        <h2>Children's privacy</h2>
                        <p>
                            RestroPulse is a business tool intended for restaurant owners and staff. It is not directed
                            at, and we do not knowingly collect information from, children.
                        </p>
                    </section>

                    <section>
                        <h2>Changes to this policy</h2>
                        <p>
                            We may update this Privacy Policy from time to time. If we make material changes, we will
                            update the &quot;Last updated&quot; date above and, where appropriate, notify you in the app.
                        </p>
                    </section>

                    <section>
                        <h2>Contact us</h2>
                        <p>
                            RestroPulse is operated by Baxel Technologies Pvt Ltd. Questions about this policy or your
                            data can be sent to{' '}
                            <a href="mailto:hello.restropulse@baxel.in">hello.restropulse@baxel.in</a>.
                        </p>
                    </section>
                </div>
            </main>
        </div>
    );
};

export default PrivacyPolicy;
