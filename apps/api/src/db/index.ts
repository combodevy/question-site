import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type Database from 'better-sqlite3';
import * as schema from './schema.js';

export type DrizzleDb = BetterSQLite3Database<typeof schema>;

export function createDrizzleDb(rawDb: Database.Database): DrizzleDb {
    return drizzle(rawDb, { schema });
}

export { schema };
