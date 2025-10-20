// Since project uses ESM modules (type: module), require won't load database.js directly.
// We'll spawn a Node process that runs an ESM snippet to perform the assertions.
const { execSync } = require('child_process');

describe('Database migrations', () => {
  test('schema_migrations populated', () => {
    const script = `import { setupDatabase, pool } from './src/lib/database.js';
      (async () => { await setupDatabase(); const r = await pool.query(\`SELECT COUNT(*)::int AS cnt FROM schema_migrations\`); console.log('CNT='+r.rows[0].cnt); await pool.end(); })();`;
    const out = execSync(
      `node --input-type=module -e "${script.replace(/"/g, '\\"')}"`,
      { encoding: 'utf8' }
    );
    const match = out.match(/CNT=(\d+)/);
    expect(match).not.toBeNull();
    const cnt = parseInt(match[1], 10);
    expect(cnt).toBeGreaterThan(0);
  });
});
