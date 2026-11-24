import Database from 'better-sqlite3';
import { ensureV2Schema, migrateLegacyToV2 } from './migrate-v2.js';

function parseArgs(argv: string[]) {
    let dbPath = process.env.DB_PATH || '/opt/question-site/data/app.db';
    let dryRun = false;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--dry-run') {
            dryRun = true;
        } else if (arg === '--db' && argv[i + 1]) {
            dbPath = argv[i + 1];
            i += 1;
        }
    }
    return { dbPath, dryRun };
}

const { dbPath, dryRun } = parseArgs(process.argv.slice(2));
const db = new Database(dbPath, { timeout: 10000 });
try {
    if (!dryRun) {
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('busy_timeout = 5000');
        ensureV2Schema(db);
    }
    const report = migrateLegacyToV2(db, { dryRun });
    console.log(JSON.stringify(report, null, 2));
} finally {
    db.close();
}
