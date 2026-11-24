import type Database from 'better-sqlite3';
import type { AppConfig } from './config.js';
import type { DrizzleDb } from './db/index.js';

export interface AuthUser {
    id: string;
    username: string;
    tokenVersion: number;
    isAdmin: boolean;
}

export interface AppEnv {
    Variables: {
        config: AppConfig;
        rawDb: Database.Database;
        db: DrizzleDb;
        authUser: AuthUser;
    };
}
