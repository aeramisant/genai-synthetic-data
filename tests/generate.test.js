import request from 'supertest';
import { app } from '../src/index.js';
import { pool } from '../src/lib/database.js';

describe('POST /api/generate', () => {
  it('returns jobId and completes generation (poll job)', async () => {
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
    let attempt = 0;
    let jobStatus;
    let datasetId;
    while (attempt < 30) {
      const jr = await request(app).get(`/api/jobs/${res.body.jobId}`);
      jobStatus = jr.body.status;
      if (jobStatus === 'completed') {
        datasetId = jr.body.result.datasetId;
        break;
      }
      if (['error', 'cancelled'].includes(jobStatus)) break;
      attempt += 1;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(jobStatus).toBe('completed');
    expect(datasetId).toBeTruthy();
  }, 20000);
  afterAll(async () => {
    await pool.end();
  });
});
