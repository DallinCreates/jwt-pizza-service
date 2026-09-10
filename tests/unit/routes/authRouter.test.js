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

function expectValidJwt(potentialJwt) {
  expect(potentialJwt).toMatch(/^[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*\.[a-zA-Z0-9\-_]*$/);
}