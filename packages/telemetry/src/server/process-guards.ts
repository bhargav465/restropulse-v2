import type pino from 'pino';

export interface ProcessGuardOptions {
    logger: pino.Logger;
    onShutdown?: () => Promise<void> | void;
    terminateOnUnhandledRejection?: boolean;
    terminateOnUncaughtException?: boolean;
}

const REGISTERED_KEY = Symbol.for('restropulse.processGuards.registered');

export function registerProcessGuards(options: ProcessGuardOptions): void {
    const {
        logger,
        onShutdown,
        terminateOnUnhandledRejection = true,
        terminateOnUncaughtException = true,
    } = options;

    const proc = process as NodeJS.Process & { [REGISTERED_KEY]?: boolean };
    if (proc[REGISTERED_KEY]) {
        return;
    }
    proc[REGISTERED_KEY] = true;

    let shuttingDown = false;

    const shutdown = async (reason: string, exitCode: 0 | 1): Promise<void> => {
        if (shuttingDown) return;
        shuttingDown = true;

        logger.info({ reason, exitCode }, 'Shutting down process');

        let finalCode: 0 | 1 = exitCode;
        if (onShutdown) {
            try {
                await onShutdown();
            } catch (err) {
                finalCode = 1;
                logger.error({ err, reason }, 'Shutdown hook failed');
            }
        }

        process.exit(finalCode);
    };

    process.on('unhandledRejection', (reason) => {
        logger.error({ err: reason }, 'Unhandled promise rejection');
        if (terminateOnUnhandledRejection) {
            void shutdown('unhandledRejection', 1);
        }
    });

    process.on('uncaughtException', (error) => {
        logger.error({ err: error }, 'Uncaught exception');
        if (terminateOnUncaughtException) {
            void shutdown('uncaughtException', 1);
        }
    });

    process.on('SIGINT', () => {
        void shutdown('SIGINT', 0);
    });

    process.on('SIGTERM', () => {
        void shutdown('SIGTERM', 0);
    });
}
