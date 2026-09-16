const request = require('supertest');
const app = require('@src/service.js');
const { registerUser, expectValidJwt } = require('../../testUtils');

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
