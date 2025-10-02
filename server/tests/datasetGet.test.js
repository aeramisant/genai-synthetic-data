import request from 'supertest';
import { app } from '../src/index.js';
import { pool } from '../src/lib/database.js';

// Creates a dataset then fetches it with includeData
describe('GET /api/datasets/:id', () => {
  let datasetId;
  it('creates dataset via generate then fetches it including data', async () => {
    const gen = await request(app)
      .post('/api/generate')
      .send({
        ddl: 'CREATE TABLE simple(id INT PRIMARY KEY, name TEXT);',
        config: { numRecords: 2, withMeta: true },
        saveName: 'jest_get_dataset',
      })
      .expect(200);
    expect(gen.body.jobId).toBeTruthy();
    // Poll job
    let attempt = 0;
    while (attempt < 25) {
      const jr = await request(app).get(`/api/jobs/${gen.body.jobId}`);
      if (jr.body.status === 'completed') {
        datasetId = jr.body.result.datasetId;
        break;
      }
      if (['error', 'cancelled'].includes(jr.body.status)) break;
      attempt += 1;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(datasetId).toBeDefined();

    const res = await request(app)
      .get(`/api/datasets/${datasetId}?includeData=true`)
      .expect(200);
    expect(res.body?.metadata?.id).toBe(datasetId);
    // rowCounts when includeData should reflect table size
    expect(typeof res.body.data).toBe('object');
    const tableNames = Object.keys(res.body.data);
    expect(tableNames.length).toBeGreaterThanOrEqual(1);
    const firstTable = tableNames[0];
    expect(Array.isArray(res.body.data[firstTable])).toBe(true);
  }, 25000);

  afterAll(async () => {
    await pool.end();
  });
});
