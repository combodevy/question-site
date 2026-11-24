import { z } from 'zod';

const DEFAULT_ORIGINS = [
    'https://quiz.devy.cc.cd',
    'https://question-site-front.pages.dev',
    'https://question-site-mirror.pages.dev',
    'https://question-site-mirror2.pages.dev',
    'http://localhost:8788',
    'http://127.0.0.1:8788',
];

const EnvSchema = z.object({
    JWT_SECRET: z
        .string({ required_error: 'JWT_SECRET is required' })
        .trim()
        .min(16, 'JWT_SECRET must be at least 16 characters'),
    DB_PATH: z.string().trim().min(1).default('/opt/question-site/data/app.db'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    HOST: z.string().trim().min(1).default('127.0.0.1'),
    ADMIN_USERNAMES: z.string().default('devy-admin,admin'),
    CORS_ORIGINS: z.string().optional(),
    CORS_ORIGIN: z.string().optional(),
    NODE_ENV: z.string().default('production'),
});

export interface AppConfig {
    jwtSecret: string;
    dbPath: string;
    port: number;
    host: string;
    adminUsernames: string[];
    allowedOrigins: string[];
    isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
    const parsed = EnvSchema.safeParse(env);
    if (!parsed.success) {
        const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`Invalid server configuration: ${msg}`);
    }
    const v = parsed.data;
    const adminUsernames = v.ADMIN_USERNAMES.split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);

    const extraOrigins = [v.CORS_ORIGINS, v.CORS_ORIGIN]
        .filter(Boolean)
        .join(',')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    return {
        jwtSecret: v.JWT_SECRET,
        dbPath: v.DB_PATH,
        port: v.PORT,
        host: v.HOST,
        adminUsernames: adminUsernames.length > 0 ? adminUsernames : ['admin'],
        allowedOrigins: [...new Set([...DEFAULT_ORIGINS, ...extraOrigins])],
        isProduction: v.NODE_ENV === 'production',
    };
}
