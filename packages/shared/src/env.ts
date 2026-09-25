import dotenv from 'dotenv';
import { z } from 'zod';

export { z };

interface LoadAndValidateEnvOptions<TSchema extends z.ZodTypeAny> {
    serviceName: string;
    schema: TSchema;
    envPath?: string;
}

export function loadEnvFile(envPath: string): void {
    dotenv.config({ path: envPath, override: false });
}

export function validateEnv<TSchema extends z.ZodTypeAny>(
    schema: TSchema,
    source: Record<string, string | undefined>,
    serviceName: string,
): z.infer<TSchema> {
    const parsed = schema.safeParse(source);

    if (!parsed.success) {
        const issues = parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
            .join('\n');

        throw new Error(`[Config] Invalid environment for ${serviceName}:\n${issues}`);
    }

    return parsed.data;
}

export function loadAndValidateEnv<TSchema extends z.ZodTypeAny>(
    options: LoadAndValidateEnvOptions<TSchema>,
): z.infer<TSchema> {
    if (options.envPath) {
        loadEnvFile(options.envPath);
    }

    return validateEnv(
        options.schema,
        process.env as Record<string, string | undefined>,
        options.serviceName,
    );
}
