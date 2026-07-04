/**
 * Express Request augmentation
 * Extends the standard Request type to include the authenticated user context
 * populated by the requireAuth middleware.
 */
declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                phone: string;
                restaurantId: string;
                role?: string;
            };
            /** Credit cost set by enforcePlanLimits middleware when credits should be deducted */
            creditCost?: number;
        }
    }
}

export {};
