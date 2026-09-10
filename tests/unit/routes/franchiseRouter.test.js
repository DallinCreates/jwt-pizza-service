const request = require('supertest');
const app = require('@src/service.js');

test('get franchises returns the franchise list', async () => {
  const franchiseRes = await request(app).get('/api/franchise');
  expect(franchiseRes.status).toBe(200);
  expect(Array.isArray(franchiseRes.body.franchises)).toBe(true);
  expect(franchiseRes.body).toHaveProperty('more');
});
