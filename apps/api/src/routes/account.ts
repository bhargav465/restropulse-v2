import express, { Request, Response } from 'express';
import { getDB, archiveAccount, deleteAccountData } from '@restropulse/db';
import type { ApiResponse } from '@restropulse/shared';
import { handle } from '../middleware/async-handler.js';
import { requireAuth } from '../middleware/auth.js';
import { requireRole } from '../middleware/require-role.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('account');
const router = express.Router();

router.delete(
  '/',
  requireAuth,
  requireRole('OWNER'),
  handle(async (req: Request, res: Response<ApiResponse>) => {
    if (process.env.FEATURE_DELETE_ACCOUNT !== 'true') {
      return res.status(403).json({
        success: false,
        error: 'Account self-deletion is not enabled. Please contact your account manager.',
      });
    }

    const { userId, restaurantId, phone } = req.user!;
    const db = getDB();
    const dbName = process.env.MONGODB_DB_NAME || 'restropulse';

    // 1. Archive first (fail fast if this throws)
    await archiveAccount(db, userId, restaurantId ?? null, 'API', dbName, phone);

    // 2. Delete all records
    await deleteAccountData(db, userId, restaurantId ?? null);

    log.info({ userId, restaurantId }, 'Account deleted');
    res.json({ success: true });
  }),
);

export default router;
