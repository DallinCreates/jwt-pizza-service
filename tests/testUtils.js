const request = require('supertest');
const app = require('@src/service.js');
const { DB, Role } = require('@src/database/database.js');

const DEFAULT_PASSWORD = 'toomanysecrets';

// Short random string, handy for unique names / emails so tests don't collide.
function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

function randomEmail(domain = 'test.com') {
  return `${randomName()}@${domain}`;
}

// Create a user straight in the DB with the given roles (defaults to a single
// admin role) and return the credentials, including the plaintext password.
async function createUser(roles = [{ role: Role.Admin }]) {
  const user = { name: randomName(), email: randomEmail('admin.com'), password: DEFAULT_PASSWORD, roles };
  await DB.addUser(user);
  return { ...user, password: DEFAULT_PASSWORD };
}

async function createAdminUser() {
  return createUser([{ role: Role.Admin }]);
}

// Register a normal diner through the public API and return the user plus token/id.
async function registerUser(overrides = {}) {
  const user = { name: randomName(), email: randomEmail(), password: DEFAULT_PASSWORD, ...overrides };
  const res = await request(app).post('/api/auth').send(user);
  return { user, token: res.body.token, id: res.body.user?.id };
}

// Log a user in through the public API and return their auth token.
async function loginUser(user) {
  const res = await request(app).put('/api/auth').send({ email: user.email, password: user.password });
  return res.body.token;
}

module.exports = {
  DEFAULT_PASSWORD,
  randomName,
  randomEmail,
  createUser,
  createAdminUser,
  registerUser,
  loginUser,
};
