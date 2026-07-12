import React, { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Outlet, Navigate, useParams, useLocation } from 'react-router-dom';
import { StorefrontProvider, useStorefront } from './store/StorefrontContext';
import { AuthProvider } from './store/AuthContext';
import { CartProvider } from './store/CartContext';
import Layout from './components/Layout';
import { ErrorState, EmptyState } from './components/States';
import { track } from './lib/analytics';
import { DEMO_SLUG, isDemoMode } from './lib/demo';
import HomePage from './pages/HomePage';
import MenuPage from './pages/MenuPage';
import CartPage from './pages/CartPage';
import CheckoutPage from './pages/CheckoutPage';
import PaymentPage from './pages/PaymentPage';
import TrackOrderPage from './pages/TrackOrderPage';
import AccountPage from './pages/AccountPage';
import DineInPage from './pages/DineInPage';
import StoryPage from './pages/StoryPage';
import StaticPage from './pages/StaticPage';

/** Fires a page_view analytics event on every route change. */
const PageViewTracker: React.FC = () => {
  const { slug } = useStorefront();
  const location = useLocation();

  useEffect(() => {
    track(slug, 'page_view', { path: location.pathname });
  }, [slug, location.pathname]);

  return null;
};

/** Guard that renders a friendly 404 when the slug doesn't resolve. */
const StorefrontGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { notFound, error, loading, reload } = useStorefront();

  if (notFound) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <EmptyState
          title="Restaurant not found"
          text="We couldn't find a storefront at this address. Double-check the link."
        />
      </div>
    );
  }
  if (error && !loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <ErrorState message={error} onRetry={reload} />
      </div>
    );
  }
  return <>{children}</>;
};

/** Shell for /:slug/* — wires providers, layout, analytics and nested routes. */
const StorefrontShell: React.FC = () => {
  const { slug } = useParams<{ slug: string }>();

  if (!slug) return null;

  return (
    <StorefrontProvider slug={slug}>
      <StorefrontGate>
        <AuthProvider>
          <CartProvider>
            <PageViewTracker />
            <Layout>
              <Outlet />
            </Layout>
          </CartProvider>
        </AuthProvider>
      </StorefrontGate>
    </StorefrontProvider>
  );
};

const LandingPage: React.FC = () => (
  <main className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-50">
    <div className="w-14 h-14 rounded-2xl bg-orange-600 flex items-center justify-center mb-4" aria-hidden="true">
      <span className="text-white font-extrabold text-2xl">R</span>
    </div>
    <h1 className="text-2xl font-extrabold text-slate-800 mb-2">RestroPulse Storefronts</h1>
    <p className="text-sm text-slate-500 max-w-sm">
      This is the online ordering platform for RestroPulse restaurants. Visit your
      restaurant's link (for example <code className="bg-slate-100 px-1.5 py-0.5 rounded">/your-restaurant</code>) to browse the menu and order.
    </p>
  </main>
);

const NotFoundPage: React.FC = () => (
  <EmptyState title="Page not found" text="That page doesn't exist on this storefront." />
);

const App: React.FC = () => (
  <BrowserRouter basename={import.meta.env.BASE_URL}>
    <Routes>
      {/* DEMO MODE: the root path jumps straight to the demo storefront */}
      <Route path="/" element={isDemoMode() ? <Navigate to={`/${DEMO_SLUG}`} replace /> : <LandingPage />} />
      <Route path="/:slug" element={<StorefrontShell />}>
        <Route index element={<HomePage />} />
        <Route path="menu" element={<MenuPage />} />
        <Route path="cart" element={<CartPage />} />
        <Route path="checkout" element={<CheckoutPage />} />
        <Route path="pay/:orderId" element={<PaymentPage />} />
        <Route path="track/:orderId" element={<TrackOrderPage />} />
        <Route path="account" element={<AccountPage />} />
        <Route path="dine-in" element={<DineInPage />} />
        <Route path="story" element={<StoryPage />} />
        <Route path="about" element={<StaticPage page="about" />} />
        <Route path="contact" element={<StaticPage page="contact" />} />
        <Route path="faqs" element={<StaticPage page="faqs" />} />
        <Route path="privacy" element={<StaticPage page="privacy" />} />
        <Route path="terms" element={<StaticPage page="terms" />} />
        <Route path="refund" element={<StaticPage page="refund" />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  </BrowserRouter>
);

export default App;
