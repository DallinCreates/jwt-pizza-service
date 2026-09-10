const request = require('supertest');
const app = require('@src/service.js');

const testUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let testUserAuthToken;

beforeAll(async () => {
  testUser.email = Math.random().toString(36).substring(2, 12) + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(testUser);
  testUserAuthToken = registerRes.body.token;
  expectValidJwt(testUserAuthToken);
});

test('register', async () => {
  const newUser = {
    name: 'new diner',
    email: Math.random().toString(36).substring(2, 12) + '@test.com',
    password: 'b',
  };
  const registerRes = await request(app).post('/api/auth').send(newUser);
  expect(registerRes.status).toBe(200);
  expectValidJwt(registerRes.body.token);

  const expectedUser = { ...newUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(registerRes.body.user).toMatchObject(expectedUser);
});

test('register without email returns 400', async () => {
  const registerRes = await request(app).post('/api/auth').send({ name: 'no email', password: 'x' });
  expect(registerRes.status).toBe(400);
  expect(registerRes.body.token).toBeUndefined();
});

test('login', async () => {
  const loginRes = await request(app).put('/api/auth').send(testUser);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);

  const expectedUser = { ...testUser, roles: [{ role: 'diner' }] };
  delete expectedUser.password;
  expect(loginRes.body.user).toMatchObject(expectedUser);
});

test('login with wrong password does not return a token', async () => {
  const loginRes = await request(app)
    .put('/api/auth')
    .send({ email: testUser.email, password: 'wrong-password' });
  expect(loginRes.status).not.toBe(200);
  expect(loginRes.body.token).toBeUndefined();
});

test('register, login, and logout a user', async () => {
  const user = {
    name: 'lifecycle diner',
    email: Math.random().toString(36).substring(2, 12) + '@test.com',
    password: 'c',
  };

  // create the user
  const registerRes = await request(app).post('/api/auth').send(user);
  expect(registerRes.status).toBe(200);
  expectValidJwt(registerRes.body.token);

  // log that user in
  const loginRes = await request(app).put('/api/auth').send(user);
  expect(loginRes.status).toBe(200);
  expectValidJwt(loginRes.body.token);
  const authToken = loginRes.body.token;

  // log the user out
  const logoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${authToken}`);
  expect(logoutRes.status).toBe(200);
  expect(logoutRes.body.message).toBe('logout successful');

  // the token should no longer be valid for authenticated requests
  const secondLogoutRes = await request(app).delete('/api/auth').set('Authorization', `Bearer ${authToken}`);
  expect(secondLogoutRes.status).toBe(401);
});

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}