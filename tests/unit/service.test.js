const request = require('supertest');
const app = require('@src/service.js');
const version = require('@src/version.json');

test('root endpoint returns the welcome message and version', async () => {
  const res = await request(app).get('/');
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    message: 'welcome to JWT Pizza',
    version: version.version,
  });
});

test('docs endpoint returns the version and endpoint list', async () => {
  const res = await request(app).get('/api/docs');
  expect(res.status).toBe(200);
  expect(res.body.version).toBe(version.version);
  expect(Array.isArray(res.body.endpoints)).toBe(true);
  expect(res.body.endpoints.length).toBeGreaterThan(0);
  expect(res.body.endpoints[0]).toHaveProperty('method');
  expect(res.body.endpoints[0]).toHaveProperty('path');
});

test('unknown route returns 404', async () => {
  const res = await request(app).get('/api/not-a-real-endpoint');
  expect(res.status).toBe(404);
  expect(res.body.message).toBe('unknown endpoint');
});
