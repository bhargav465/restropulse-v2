import express, { Request, Response } from 'express';
import {
    findInvoicesByRestaurant,
    findInvoiceById,
} from '@restropulse/db';
import { ApiResponse, Invoice } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// GET / -- list invoices for the authenticated restaurant
router.get('/', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Invoice[]>>) => {
    const restaurantId = req.user!.restaurantId;
    const invoices = await findInvoicesByRestaurant(restaurantId) as Invoice[];
    res.json({ success: true, data: invoices });
}));

// GET /:id -- get invoice details
router.get('/:id', requireAuth, handle(async (req: Request, res: Response<ApiResponse<Invoice>>) => {
    const restaurantId = req.user!.restaurantId;
    const invoice = await findInvoiceById(req.params.id) as Invoice | null;

    if (!invoice || invoice.restaurantId !== restaurantId) {
        return res.status(404).json({ success: false, error: 'Invoice not found' });
    }

    res.json({ success: true, data: invoice });
}));

export default router;
