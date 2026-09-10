const request = require('supertest');
const app = require('@src/service.js');

test('get menu returns the pizza menu', async () => {
  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.status).toBe(200);
  expect(Array.isArray(menuRes.body)).toBe(true);
});
