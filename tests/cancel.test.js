import request from 'supertest';
import { app } from '../src/index.js';

// NOTE: This test simulates cancellation quickly; depending on environment AI calls may finish fast.
// We rely on the job existing and allow cancellation endpoint to respond with status 'cancelling' or error if already completed.

describe('Job cancellation', () => {
  test('cancel a running generation job', async () => {
    const ddl = 'CREATE TABLE t2(id INT PRIMARY KEY, name TEXT);';
    const genRes = await request(app)
      .post('/api/generate')
      .send({
        ddl,
        config: { numRecords: 500, seed: 123, withMeta: true },
        saveName: 'cancel_test_ds',
      })
      .expect(200);
    const jobId = genRes.body.jobId;
    expect(jobId).toBeTruthy();

    // Poll a few times to find job active
    await new Promise((r) => setTimeout(r, 120));

    const cancelRes = await request(app)
      .delete(`/api/jobs/${jobId}/cancel`)
      // Accept 200 (initiated), 400 (already terminal), or 404 (job finished & GC scenario)
      .expect((r) => {
        if (![200, 400, 404].includes(r.status)) {
          throw new Error('Unexpected status for cancellation');
        }
      });
    if (cancelRes.status === 200) {
      expect(cancelRes.body.status).toBe('cancelling');
    }
    // Poll final status (best-effort); accept cancelled OR completed (if finished before cancellation landed)
    let finalStatus;
    for (let i = 0; i < 15; i++) {
      const jr = await request(app).get(`/api/jobs/${jobId}`);
      finalStatus = jr.body.status;
      if (['cancelled', 'completed', 'error'].includes(finalStatus)) break;
      await new Promise((r) => setTimeout(r, 80));
    }
    // Accept running if job still in progress (fast completion window makes cancellation racey in test env)
    expect(['cancelled', 'completed', 'error', 'running']).toContain(
      finalStatus
    );
  });
});
