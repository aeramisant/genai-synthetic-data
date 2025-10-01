import request from 'supertest';
import { app } from '../src/index.js';
import { pool } from '../src/lib/database.js';

describe('POST /api/generate', () => {
  it('returns jobId, datasetId, validation, and meta (with temperature when provided)', async () => {
    const res = await request(app)
      .post('/api/generate')
      .send({
        ddl: 'CREATE TABLE test_items(id INT PRIMARY KEY, name TEXT);',
        instructions: 'short',
        config: { numRecords: 2, temperature: 0.2, withMeta: true },
        saveName: 'jest_temp_dataset',
      })
      .expect(200);

    expect(res.body).toHaveProperty('jobId');
    expect(res.body).toHaveProperty('datasetId');
    expect(res.body).toHaveProperty('validation');
    expect(res.body).toHaveProperty('meta');
    if (res.body.meta.temperature !== undefined) {
      expect(res.body.meta.temperature).toBeGreaterThanOrEqual(0);
      expect(res.body.meta.temperature).toBeLessThanOrEqual(1);
    }
  }, 20000);
  afterAll(async () => {
    await pool.end();
  });
});
