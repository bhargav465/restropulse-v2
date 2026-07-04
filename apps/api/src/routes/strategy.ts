import express, { Request, Response } from 'express';
import {
    findContentStrategy,
    updateContentStrategy,
    findAllCycles,
    findCycleById,
    createCycle,
    updateCycle,
    getStrategyCyclesCollection,
    findActiveSubscription,
} from '@restropulse/db';
import { ApiResponse, StrategyCycle, ContentStrategy, isCyclePastApprovalDeadline } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

// Get content strategy
router.get('/', requireAuth, handle(async (req: Request, res: Response<ApiResponse<ContentStrategy & { suggestCreateCycle?: boolean }>>) => {
    const { restaurantId } = req.user!;
    let strategy = await findContentStrategy(restaurantId);

    // Return default if none exists
    if (!strategy) {
        strategy = {
            id: 'default',
            postsPerWeek: 5,
            focusCategories: [],
            bestTime: '6:00 PM - 8:00 PM',
            nextScheduledDate: new Date().toISOString(),
            theme: ''
        } as ContentStrategy;
    }

    // Check if we should suggest creating a cycle
    const cyclesCol = getStrategyCyclesCollection();
    const existingCycle = await cyclesCol.findOne({
        restaurantId,
        status: { $in: ['PENDING_GENERATION', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'ACTIVE'] },
    });

    const activeSubscription = await findActiveSubscription(restaurantId);
    const suggestCreateCycle = !existingCycle && !!activeSubscription &&
        ['ACTIVE', 'AUTHENTICATED'].includes(activeSubscription.status);

    res.json({
        success: true,
        data: { ...strategy, suggestCreateCycle },
    });
}));

// Update content strategy
router.put('/', requireAuth, handle(async (req: Request, res: Response<ApiResponse<ContentStrategy>>) => {
    const { restaurantId } = req.user!;
    const strategy = await updateContentStrategy(restaurantId, {
        ...req.body,
        restaurantId
    });

    res.json({
        success: true,
        data: strategy!,
        message: 'Content strategy updated successfully'
    });
}));

// Get all cycles
router.get('/cycles', requireAuth, handle(async (req: Request, res: Response<ApiResponse<StrategyCycle[]>>) => {
    const cycles = await findAllCycles(req.user!.restaurantId);
    res.json({
        success: true,
        data: cycles
    });
}));

// Get cycle by ID
router.get('/cycles/:id', requireAuth, handle(async (req: Request, res: Response<ApiResponse<StrategyCycle>>) => {
    const { id } = req.params;
    const cycle = await findCycleById(id);

    if (cycle) {
        res.json({
            success: true,
            data: cycle
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Strategy cycle not found'
        });
    }
}));

// Create new cycle
router.post('/cycles', requireAuth, handle(async (req: Request, res: Response<ApiResponse<StrategyCycle>>) => {
    const { restaurantId } = req.user!;
    const newCycle = await createCycle({
        ...req.body,
        restaurantId
    });

    res.status(201).json({
        success: true,
        data: newCycle,
        message: 'Strategy cycle created successfully'
    });
}));

// Update cycle
router.put('/cycles/:id', requireAuth, handle(async (req: Request, res: Response<ApiResponse<StrategyCycle>>) => {
    const { id } = req.params;

    // Block CHANGES_REQUESTED transitions past the approval deadline.
    // Approval transitions (APPROVED/ACTIVE) remain allowed so the
    // content-engine's auto-advance and rolling-window can proceed.
    if (req.body?.status === 'CHANGES_REQUESTED') {
        const existing = await findCycleById(id);
        const cycleBufferHours = parseInt(process.env.CYCLE_APPROVAL_BUFFER_MINS ?? '4320', 10) / 60;
        if (existing && isCyclePastApprovalDeadline(existing, new Date(), cycleBufferHours)) {
            return res.status(409).json({
                success: false,
                error: 'Cycle is past the approval deadline'
            });
        }
    }

    const cycle = await updateCycle(id, req.body);

    if (cycle) {
        res.json({
            success: true,
            data: cycle,
            message: 'Strategy cycle updated successfully'
        });
    } else {
        res.status(404).json({
            success: false,
            error: 'Strategy cycle not found'
        });
    }
}));

export default router;
