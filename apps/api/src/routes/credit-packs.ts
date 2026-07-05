import express, { Request, Response } from 'express';
import {
    findActiveCreditPacks,
    createCreditPack,
    updateCreditPack,
    findCreditPackById,
} from '@restropulse/db';
import { ApiResponse, CreditPack } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';

const router = express.Router();

// GET / -- requireAuth, list active credit packs (for purchase UI)
router.get('/', requireAuth, handle(async (_req: Request, res: Response<ApiResponse<CreditPack[]>>) => {
    const packs = await findActiveCreditPacks();
    res.json({ success: true, data: packs });
}));

// POST / -- admin only, create credit pack
router.post('/', requireAuth, requireRole('ADMIN'), handle(async (req: Request, res: Response<ApiResponse<CreditPack>>) => {
    const { name, description, credits, priceInPaise, sortOrder } = req.body;

    if (!name || !credits || !priceInPaise) {
        return res.status(400).json({ success: false, error: 'name, credits, and priceInPaise are required' });
    }

    const pack = await createCreditPack({
        name,
        description: description || '',
        credits,
        priceInPaise,
        isActive: true,
        sortOrder: sortOrder || 0,
    });

    res.status(201).json({ success: true, data: pack });
}));

// PATCH /:id -- admin only, update/deactivate credit pack
router.patch('/:id', requireAuth, requireRole('ADMIN'), handle(async (req: Request, res: Response<ApiResponse<CreditPack>>) => {
    const { id } = req.params;
    const allowedFields = ['name', 'description', 'credits', 'priceInPaise', 'isActive', 'sortOrder'];
    const updates: Record<string, any> = {};

    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const pack = await updateCreditPack(id, updates);
    if (!pack) {
        return res.status(404).json({ success: false, error: 'Credit pack not found' });
    }

    res.json({ success: true, data: pack });
}));

export default router;
