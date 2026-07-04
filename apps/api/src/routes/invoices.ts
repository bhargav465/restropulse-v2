import express, { Request, Response } from 'express';
import {
    findInvoicesByRestaurant,
    findInvoiceById,
    findActiveSubscription,
    updateInvoice,
} from '@restropulse/db';
import { ApiResponse, Invoice } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { fetchRazorpayInvoice } from '../services/razorpay.js';

const router = express.Router();

// GET / -- list invoices for the authenticated restaurant
router.get('/', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Invoice[]>>) => {
    const restaurantId = req.user!.restaurantId;
    const invoices = await findInvoicesByRestaurant(restaurantId) as Invoice[];
    res.json({ success: true, data: invoices });
}));

// GET /:id -- get invoice details (refreshes PDF URL from Razorpay if available)
router.get('/:id', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Invoice>>) => {
    const restaurantId = req.user!.restaurantId;
    const invoice = await findInvoiceById(req.params.id) as Invoice | null;

    if (!invoice || invoice.restaurantId !== restaurantId) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    // Refresh PDF URL from Razorpay if we have a Razorpay invoice ID
    if (invoice.razorpayInvoiceId) {
        try {
            const rpInvoice = await fetchRazorpayInvoice(invoice.razorpayInvoiceId);
            if (rpInvoice.short_url && rpInvoice.short_url !== invoice.pdfUrl) {
                await updateInvoice(invoice.id, { pdfUrl: rpInvoice.short_url });
                invoice.pdfUrl = rpInvoice.short_url;
            }
        } catch {
            // Non-critical: return invoice without updated PDF URL
        }
    }

    res.json({ success: true, data: invoice });
}));

// GET /subscription/sync -- sync invoices from Razorpay for current subscription
router.get('/subscription/sync', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const restaurantId = req.user!.restaurantId;
    const subscription = await findActiveSubscription(restaurantId);

    if (!subscription?.razorpaySubscriptionId) {
        return res.json({ success: true, data: { synced: 0 } });
    }

    // Fetching all invoices from Razorpay for this subscription would require
    // the listRazorpayInvoices call. For now, invoices are created via webhooks
    // which is the recommended approach.
    res.json({ success: true, data: { message: 'Invoices are synced automatically via webhooks' } });
}));

export default router;
