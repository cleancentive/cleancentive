/**
 * Removes what the Playwright suite leaves behind in the dev database.
 *
 * Every e2e run signs up throwaway users and creates teams and cleanups under
 * them, so after a few runs the local app is mostly test rows and unusable for
 * looking at anything by hand. This deletes exactly those rows and nothing else.
 *
 * Dry run by default; pass --apply to delete. Refuses to touch anything but a
 * local database.
 *
 *   bun run data:clean-e2e            # show what would go
 *   bun run data:clean-e2e -- --apply # delete it
 */
import { Client } from 'pg';

// What the e2e helpers produce: generateTestEmail() in frontend/e2e/helpers/api.ts
// mints <prefix>-<timestamp>@example.com, and the specs name what they create "E2E …".
const E2E_EMAIL_PATTERN = '%@example.com';
const E2E_NAME_PATTERN = 'E2E %';

/**
 * Test accounts, minus anyone who left real traces. Deleting a user cascades
 * their spots, so an account that has logged a pick is kept even if it looks
 * like a test one — losing a real pick to a cleanup script is not a trade worth
 * making. The edit tables block deletes outright (no cascade), so they are
 * excluded here rather than left to fail mid-run.
 */
const DISPOSABLE_USER = `
  FROM users u
  WHERE EXISTS (SELECT 1 FROM user_emails ue WHERE ue.user_id = u.id AND ue.email LIKE $1)
    AND NOT EXISTS (SELECT 1 FROM user_emails ue WHERE ue.user_id = u.id AND ue.email NOT LIKE $1)
    AND NOT EXISTS (SELECT 1 FROM spots s WHERE s.user_id = u.id)
    AND NOT EXISTS (SELECT 1 FROM spot_edits se WHERE se.created_by = u.id)
    AND NOT EXISTS (SELECT 1 FROM detected_item_edits de WHERE de.created_by = u.id)
`;

interface Step {
  label: string;
  where: string;
  table: string;
  pattern: string;
}

const STEPS: Step[] = [
  { label: 'cleanups', table: 'cleanups', where: 'WHERE name LIKE $1', pattern: E2E_NAME_PATTERN },
  { label: 'teams', table: 'teams', where: 'WHERE name LIKE $1', pattern: E2E_NAME_PATTERN },
];

function assertLocalDatabase(host: string, database: string): void {
  const isLocal = ['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(host);
  if (!isLocal) {
    throw new Error(`refusing to clean a non-local database (DB_HOST=${host})`);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('refusing to clean with NODE_ENV=production');
  }
  console.log(`Target: ${database} on ${host}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const host = process.env.DB_HOST || 'localhost';
  const database = process.env.DB_DATABASE || 'cleancentive';

  assertLocalDatabase(host, database);

  const client = new Client({
    host,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USERNAME || 'cleancentive',
    password: process.env.DB_PASSWORD || 'cleancentive_dev_password',
    database,
  });
  await client.connect();

  const verb = apply ? 'Deleted' : 'Would delete';

  try {
    for (const step of STEPS) {
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM ${step.table} ${step.where}`,
        [step.pattern],
      );
      const count = rows[0].n as number;
      if (apply && count > 0) {
        await client.query(`DELETE FROM ${step.table} ${step.where}`, [step.pattern]);
      }
      console.log(`${verb} ${count} ${step.label}`);
    }

    const { rows: userRows } = await client.query(
      `SELECT count(*)::int AS n ${DISPOSABLE_USER}`,
      [E2E_EMAIL_PATTERN],
    );
    const userCount = userRows[0].n as number;
    if (apply && userCount > 0) {
      await client.query(`DELETE ${DISPOSABLE_USER}`, [E2E_EMAIL_PATTERN]);
    }
    console.log(`${verb} ${userCount} test accounts`);

    const { rows: keptRows } = await client.query(
      `SELECT count(*)::int AS n FROM users u
       WHERE EXISTS (SELECT 1 FROM user_emails ue WHERE ue.user_id = u.id AND ue.email LIKE $1)
         AND EXISTS (SELECT 1 FROM spots s WHERE s.user_id = u.id)`,
      [E2E_EMAIL_PATTERN],
    );
    if ((keptRows[0].n as number) > 0) {
      console.log(`Kept ${keptRows[0].n} test accounts that own spots`);
    }

    if (!apply) {
      console.log('\nDry run. Re-run with --apply to delete.');
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Clean failed:', error.message);
  process.exit(1);
});
