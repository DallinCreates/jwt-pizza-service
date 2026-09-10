const request = require('supertest');
const app = require('@src/service.js');
const { randomName, createAdminUser, loginUser } = require('../../testUtils');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;
let testUserId;

beforeAll(async () => {
  testUser.email = randomName() + '@test.com';
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

test('an admin can create a franchise', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);

  const newFranchise = { name: randomName(), admins: [{ email: admin.email }] };
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(newFranchise);

  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ name: newFranchise.name });
  expect(res.body.id).toBeDefined();
});

test('a normal authenticated user cannot create a franchise', async () => {
  const newFranchise = { name: randomName(), admins: [{ email: testUser.email }] };
  const res = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send(newFranchise);

  expect(res.status).toBe(403);
  expect(res.body.message).toBe('unable to create a franchise');
});

test('an admin can delete a franchise', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);

  const createRes = await request(app)
    .post('/api/franchise')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: randomName(), admins: [{ email: admin.email }] });
  const franchiseId = createRes.body.id;

  const deleteRes = await request(app)
    .delete(`/api/franchise/${franchiseId}`)
    .set('Authorization', `Bearer ${adminToken}`);

  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('franchise deleted');

  // it should no longer show up in the franchise list
  const listRes = await request(app).get(`/api/franchise?name=${createRes.body.name}`);
  expect(listRes.body.franchises.find((f) => f.id === franchiseId)).toBeUndefined();
});
