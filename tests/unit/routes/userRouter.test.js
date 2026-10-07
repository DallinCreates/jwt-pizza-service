const request = require('supertest');
const app = require('@src/service.js');
const { registerUser, createAdminUser, loginUser, expectValidJwt } = require('../../testUtils');

let testUser, testUserAuthToken, testUserId;
let otherUser, otherUserId;

beforeAll(async () => {
  ({ user: testUser, token: testUserAuthToken, id: testUserId } = await registerUser());
  expectValidJwt(testUserAuthToken);

  ({ user: otherUser, id: otherUserId } = await registerUser());
});

test('get me with a valid user', async () => {
  const meRes = await request(app).get('/api/user/me').set('Authorization', `Bearer ${testUserAuthToken}`);
  expect(meRes.status).toBe(200);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(meRes.body).toMatchObject(expectedUser);
});

test('get me without authentication is rejected', async () => {
  const meRes = await request(app).get('/api/user/me');
  expect(meRes.status).toBe(401);
  expect(meRes.body.message).toBe('unauthorized');
});

test('update user changes the name and leaves everything else the same', async () => {
  const newName = 'renamed diner';
  const updateRes = await request(app)
    .put(`/api/user/${testUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: newName, email: testUser.email, password: testUser.password });

  expect(updateRes.status).toBe(200);
  expect(updateRes.body.user).toMatchObject({
    id: testUserId,
    name: newName,
    email: testUser.email,
    roles: [{ role: 'diner' }],
  });
  expectValidJwt(updateRes.body.token);
});

// test('user cannot change their email to another user\'s email', async () => {
//   const updateRes = await request(app)
//     .put(`/api/user/${testUserId}`)
//     .set('Authorization', `Bearer ${testUserAuthToken}`)
//     .send({ name: testUser.name, email: otherUser.email, password: testUser.password });

//   // Taking over an email already in use must be rejected.
//   expect(updateRes.status).not.toBe(200);
// });

test('user cannot update another user\'s information', async () => {
  const updateRes = await request(app)
    .put(`/api/user/${otherUserId}`)
    .set('Authorization', `Bearer ${testUserAuthToken}`)
    .send({ name: 'hijacked name', email: otherUser.email, password: otherUser.password });

  expect(updateRes.status).toBe(403);
  expect(updateRes.body.message).toBe('unauthorized');
});

test('list users unauthorized', async () => {
  const listUsersRes = await request(app).get('/api/user');
  expect(listUsersRes.status).toBe(401);
});

test('list users as a diner is forbidden', async () => {
  const { token: userToken } = await registerUser();
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + userToken);
  expect(listUsersRes.status).toBe(403);
  expect(listUsersRes.body.message).toBe('unauthorized');
});

test('list users as admin returns users without passwords', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);
  const listUsersRes = await request(app)
    .get('/api/user')
    .set('Authorization', 'Bearer ' + adminToken);

  expect(listUsersRes.status).toBe(200);
  expect(listUsersRes.body.users.length).toBeGreaterThan(0);
  for (const user of listUsersRes.body.users) {
    expect(user).toEqual({ id: expect.any(Number), name: expect.any(String), email: expect.any(String), roles: expect.any(Array) });
  }
});

test('list users pages through results with limit and more', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);

  const page1Res = await request(app)
    .get('/api/user?page=1&limit=2')
    .set('Authorization', 'Bearer ' + adminToken);
  expect(page1Res.status).toBe(200);
  expect(page1Res.body.users).toHaveLength(2);
  expect(page1Res.body.more).toBe(true);

  const page2Res = await request(app)
    .get('/api/user?page=2&limit=2')
    .set('Authorization', 'Bearer ' + adminToken);
  expect(page2Res.status).toBe(200);
  expect(page2Res.body.users).toHaveLength(2);

  const page1Ids = page1Res.body.users.map((u) => u.id);
  const page2Ids = page2Res.body.users.map((u) => u.id);
  expect(page2Ids.some((id) => page1Ids.includes(id))).toBe(false);
});
