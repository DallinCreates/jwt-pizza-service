const request = require('supertest');
const app = require('@src/service.js');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let testUserId;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  testUserId = registerRes.body.user.id;
});

test('get franchises returns the franchise list', async () => {
  const franchiseRes = await request(app).get('/api/franchise');
  expect(franchiseRes.status).toBe(200);
  expect(Array.isArray(franchiseRes.body.franchises)).toBe(true);
  expect(franchiseRes.body).toHaveProperty('more');
});

test('an authenticated user can get their own franchises', async () => {
  const res = await request(app)
    .get(`/api/franchise/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  expect(res.status).toBe(200);
  expect(Array.isArray(res.body)).toBe(true);
});

test('a non-admin gets an empty list when requesting another user\'s franchises', async () => {
  const otherUserId = testUserId + 1000;
  const res = await request(app)
    .get(`/api/franchise/${otherUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`);

  // The route does not 403 here -- it just returns nothing for anyone who is
  // neither the target user nor an admin.
  expect(res.status).toBe(200);
  expect(res.body).toEqual([]);
});

test('an unauthenticated user cannot get user franchises', async () => {
  const res = await request(app).get(`/api/franchise/${testUserId}`);

  expect(res.status).toBe(401);
  expect(res.body.message).toBe('unauthorized');
});
