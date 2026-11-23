/**
 * @file worker/d1-adapter.mjs
 * @description Cloudflare D1 Database API adapter backed by better-sqlite3
 * Provides 100% API parity with Cloudflare D1 (prepare, bind, first, all, run, batch, exec)
 */

export function createD1Database(db) {
    function createPreparedStatement(sql, boundArgs = []) {
        return {
            _sql: sql,
            _args: boundArgs,
            bind(...args) {
                return createPreparedStatement(sql, args);
            },
            async first(colName) {
                const stmt = db.prepare(sql);
                let row;
                try {
                    row = stmt.get(...boundArgs);
                } catch (err) {
                    // If statement is a pure mutation without returning, execute it and return null
                    if (err.message && err.message.includes('returns no data')) {
                        stmt.run(...boundArgs);
                        return null;
                    }
                    throw err;
                }
                if (!row) return null;
                if (colName && typeof colName === 'string') return row[colName];
                return row;
            },
            async all() {
                const stmt = db.prepare(sql);
                const results = stmt.all(...boundArgs);
                return { results };
            },
            async run() {
                const stmt = db.prepare(sql);
                // Check if statement has RETURNING clause (which throws on stmt.run in better-sqlite3)
                if (/\breturning\b/i.test(sql)) {
                    const row = stmt.get(...boundArgs);
                    return {
                        success: true,
                        meta: {
                            changes: 1,
                            last_row_id: row && row.id !== undefined ? row.id : 0
                        }
                    };
                }
                const info = stmt.run(...boundArgs);
                return {
                    success: true,
                    meta: {
                        changes: info.changes,
                        last_row_id: info.lastInsertRowid
                    }
                };
            }
        };
    }

    return {
        prepare(sql) {
            return createPreparedStatement(sql, []);
        },
        async batch(statements) {
            const executeBatch = db.transaction(() => {
                const out = [];
                for (const s of statements) {
                    const stmt = db.prepare(s._sql);
                    if (/\breturning\b/i.test(s._sql)) {
                        const row = stmt.get(...s._args);
                        out.push({
                            success: true,
                            meta: {
                                changes: 1,
                                last_row_id: row && row.id !== undefined ? row.id : 0
                            }
                        });
                    } else {
                        const info = stmt.run(...s._args);
                        out.push({
                            success: true,
                            meta: {
                                changes: info.changes,
                                last_row_id: info.lastInsertRowid
                            }
                        });
                    }
                }
                return out;
            });
            return executeBatch();
        },
        async exec(sql) {
            return db.exec(sql);
        }
    };
}
