import express, { Request, Response } from 'express';
import {
    findCouponByCode,
    createCoupon,
    updateCoupon,
    findAllCoupons,
    hasRestaurantRedeemedCoupon,
} from '@restropulse/db';
import { ApiResponse, Coupon } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { createRazorpayOffer } from '../services/razorpay.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('coupons');

const router = express.Router();

// POST / -- admin only, create coupon
router.post('/', requireAuth, requireRole('ADMIN'), handle(async (req: Request, res: Response<ApiResponse<Coupon>>) => {
    const {
        code, type, value, maxBillingCycles, maxRedemptions,
        assignedTo, applicablePlans, applicableCycles,
        validFrom, validUntil,
    } = req.body;

    if (!code || !type || value === undefined || !validFrom) {
        return res.status(400).json({ success: false, error: 'code, type, value, and validFrom are required' });
    }

    const normalizedCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (normalizedCode.length < 8) {
        return res.status(400).json({ success: false, error: 'Coupon code must be at least 8 characters (alphanumeric)' });
    }

    if (type === 'PERCENTAGE' && (value < 0 || value > 100)) {
        return res.status(400).json({ success: false, error: 'Percentage value must be between 0 and 100' });
    }

    // Check for duplicate code
    const existing = await findCouponByCode(normalizedCode);
    if (existing) {
        return res.status(409).json({ success: false, error: 'Coupon code already exists' });
    }

    // Sync to Razorpay as an Offer (optional, may fail if Razorpay not configured)
    let razorpayOfferId: string | undefined;
    try {
        const offer = await createRazorpayOffer({
            name: normalizedCode,
            paymentMethod: 'card',
            discountType: type.toLowerCase() as 'percentage' | 'flat',
            discountValue: value,
            maxBillingCycles,
        });
        razorpayOfferId = offer.id;
    } catch (error) {
        log.info({ err: (error as Error).message }, 'Razorpay offer creation skipped');
    }

    const coupon = await createCoupon({
        code: normalizedCode,
        type,
        value,
        maxBillingCycles,
        maxRedemptions,
        redemptionCount: 0,
        assignedTo,
        applicablePlans,
        applicableCycles,
        validFrom: new Date(validFrom),
        validUntil: validUntil ? new Date(validUntil) : undefined,
        status: 'ACTIVE',
        razorpayOfferId,
        createdBy: req.user!.userId,
    });

    res.status(201).json({ success: true, data: coupon });
}));

// GET / -- admin only, list coupons
router.get('/', requireAuth, requireRole('ADMIN'), handle(async (_req: Request, res: Response<ApiResponse<Coupon[]>>) => {
    const coupons = await findAllCoupons();
    res.json({ success: true, data: coupons });
}));

// PATCH /:id -- admin only, update/disable coupon
router.patch('/:id', requireAuth, requireRole('ADMIN'), handle(async (req: Request, res: Response<ApiResponse<Coupon>>) => {
    const { id } = req.params;
    const allowedFields = ['status', 'maxRedemptions', 'validUntil', 'applicablePlans', 'applicableCycles'];
    const updates: Record<string, any> = {};

    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            updates[field] = req.body[field];
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({ success: false, error: 'No valid fields to update' });
    }

    const coupon = await updateCoupon(id, updates);
    if (!coupon) {
        return res.status(404).json({ success: false, error: 'Coupon not found' });
    }

    res.json({ success: true, data: coupon });
}));

// POST /validate -- requireAuth, validate coupon code
router.post('/validate', requireAuth, handle(async (req: Request, res: Response<ApiResponse>) => {
    const { code, planSlug, billingCycle } = req.body;

    if (!code) {
        return res.status(400).json({ success: false, error: 'Coupon code is required' });
    }

    const coupon = await findCouponByCode(code);
    if (!coupon) {
        return res.json({ success: true, data: { valid: false, reason: 'Invalid coupon code' } });
    }

    if (coupon.status !== 'ACTIVE') {
        return res.json({ success: true, data: { valid: false, reason: 'Coupon is not active' } });
    }

    if (coupon.validUntil && new Date(coupon.validUntil) < new Date()) {
        return res.json({ success: true, data: { valid: false, reason: 'Coupon has expired' } });
    }

    if (coupon.maxRedemptions && coupon.redemptionCount >= coupon.maxRedemptions) {
        return res.json({ success: true, data: { valid: false, reason: 'Coupon has been fully redeemed' } });
    }

    const restaurantId = req.user!.restaurantId;

    if (coupon.assignedTo && coupon.assignedTo !== restaurantId) {
        return res.json({ success: true, data: { valid: false, reason: 'Invalid coupon code' } });
    }

    if (planSlug && coupon.applicablePlans?.length && !coupon.applicablePlans.includes(planSlug)) {
        return res.json({ success: true, data: { valid: false, reason: 'Coupon is not applicable to this plan' } });
    }

    if (billingCycle && coupon.applicableCycles?.length && !coupon.applicableCycles.includes(billingCycle)) {
        return res.json({ success: true, data: { valid: false, reason: 'Coupon is not applicable to this billing cycle' } });
    }

    const alreadyRedeemed = await hasRestaurantRedeemedCoupon(coupon.id, restaurantId);
    if (alreadyRedeemed) {
        return res.json({ success: true, data: { valid: false, reason: 'Coupon already redeemed' } });
    }

    res.json({
        success: true,
        data: {
            valid: true,
            type: coupon.type,
            value: coupon.value,
            maxBillingCycles: coupon.maxBillingCycles,
        },
    });
}));

export default router;
