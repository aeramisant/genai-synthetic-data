import request from 'supertest';
import { app } from '../src/index.js';

// Basic test to ensure /api/datasets/latest returns a dataset after generation

describe('GET /api/datasets/latest', () => {
  test('generate then fetch latest (structure + data presence)', async () => {
    const ddl = 'CREATE TABLE t1(id INT PRIMARY KEY, name TEXT);';
    const genRes = await request(app)
      .post('/api/generate')
      .send({
        ddl,
        config: { numRecords: 3, seed: 1, withMeta: true },
        saveName: 'latest_test_ds',
      })
      .expect(200);
    expect(genRes.body.jobId).toBeTruthy();
    let datasetId;
    for (let i = 0; i < 25; i++) {
      const jr = await request(app).get(`/api/jobs/${genRes.body.jobId}`);
      if (jr.body.status === 'completed') {
        datasetId = jr.body.result.datasetId;
        break;
      }
      if (['error', 'cancelled'].includes(jr.body.status)) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    expect(typeof datasetId).toBe('number');

    const latestRes = await request(app)
      .get('/api/datasets/latest?includeData=true')
      .expect(200);
    // We cannot guarantee equality because parallel tests may create newer datasets.
    expect(typeof latestRes.body.metadata.id).toBe('number');
    expect(latestRes.body.data.t1.length).toBeGreaterThan(0);
    expect(latestRes.body.meta).toBeTruthy();
  });
});
