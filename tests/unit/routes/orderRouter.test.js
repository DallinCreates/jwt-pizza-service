const request = require('supertest');
const app = require('@src/service.js');
const { DB, Role } = require('@src/database/database.js');

function randomName() {
  return Math.random().toString(36).substring(2, 12);
}

async function createAdminUser() {
  const user = { name: randomName(), email: randomName() + '@admin.com', password: 'toomanysecrets', roles: [{ role: Role.Admin }] };
  await DB.addUser(user);
  return { ...user, password: 'toomanysecrets' };
}

async function loginUser(user) {
  const res = await request(app).put('/api/auth').send({ email: user.email, password: user.password });
  return res.body.token;
}

const dinerUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let dinerToken;

beforeAll(async () => {
  dinerUser.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(dinerUser);
  dinerToken = registerRes.body.token;
});

test('get menu returns the pizza menu', async () => {
  const menuRes = await request(app).get('/api/order/menu');
  expect(menuRes.status).toBe(200);
  expect(Array.isArray(menuRes.body)).toBe(true);
});

test('an admin can add a menu item', async () => {
  const admin = await createAdminUser();
  const adminToken = await loginUser(admin);

  const newItem = { title: randomName(), description: 'just carbs', image: 'pizza9.png', price: 0.0001 };
  const addRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${adminToken}`)
    .send(newItem);

  expect(addRes.status).toBe(200);
  expect(Array.isArray(addRes.body)).toBe(true);
  expect(addRes.body).toEqual(
    expect.arrayContaining([expect.objectContaining({ title: newItem.title, price: newItem.price })])
  );
});

test('a non-admin user cannot add a menu item', async () => {
  const newItem = { title: randomName(), description: 'just carbs', image: 'pizza9.png', price: 0.0001 };
  const addRes = await request(app)
    .put('/api/order/menu')
    .set('Authorization', `Bearer ${dinerToken}`)
    .send(newItem);

  expect(addRes.status).toBe(403);
  expect(addRes.body.message).toBe('unable to add menu item');
});
