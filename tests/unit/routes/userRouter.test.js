const request = require('supertest');
const app = require('@src/service.js');
const { registerUser, createAdminUser, loginUser, randomName, expectValidJwt } = require('../../testUtils');

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

test('list users filters by name with wildcards', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);
  const uniqueName = `filter-${randomName()}`;
  const { id: filteredUserId } = await registerUser({ name: uniqueName });

  const matchRes = await request(app)
    .get(`/api/user?name=*${uniqueName.substring(3, 12)}*`)
    .set('Authorization', 'Bearer ' + adminToken);
  expect(matchRes.status).toBe(200);
  expect(matchRes.body.users).toEqual([expect.objectContaining({ id: filteredUserId, name: uniqueName })]);
  expect(matchRes.body.more).toBe(false);

  const noMatchRes = await request(app)
    .get(`/api/user?name=${uniqueName}-nobody`)
    .set('Authorization', 'Bearer ' + adminToken);
  expect(noMatchRes.status).toBe(200);
  expect(noMatchRes.body.users).toEqual([]);
});

test('admin deletes a user', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);
  const uniqueName = `delete-${randomName()}`;
  const { user: doomedUser, token: doomedToken, id: doomedId } = await registerUser({ name: uniqueName });

  const deleteRes = await request(app)
    .delete(`/api/user/${doomedId}`)
    .set('Authorization', 'Bearer ' + adminToken);
  expect(deleteRes.status).toBe(200);
  expect(deleteRes.body.message).toBe('user deleted');

  // The deleted user can no longer log in, and their old token no longer works.
  const loginRes = await request(app).put('/api/auth').send({ email: doomedUser.email, password: doomedUser.password });
  expect(loginRes.status).toBe(404);
  const meRes = await request(app).get('/api/user/me').set('Authorization', 'Bearer ' + doomedToken);
  expect(meRes.status).toBe(401);

  const listRes = await request(app)
    .get(`/api/user?name=${uniqueName}`)
    .set('Authorization', 'Bearer ' + adminToken);
  expect(listRes.body.users).toEqual([]);
});

test('delete user without authentication is rejected', async () => {
  const deleteRes = await request(app).delete(`/api/user/${otherUserId}`);
  expect(deleteRes.status).toBe(401);
});

test('diner cannot delete a user', async () => {
  const { id: victimId, user: victim } = await registerUser();

  const deleteRes = await request(app)
    .delete(`/api/user/${victimId}`)
    .set('Authorization', 'Bearer ' + testUserAuthToken);
  expect(deleteRes.status).toBe(403);
  expect(deleteRes.body.message).toBe('unauthorized');

  // The victim is untouched and can still log in.
  const loginRes = await request(app).put('/api/auth').send({ email: victim.email, password: victim.password });
  expect(loginRes.status).toBe(200);
});
