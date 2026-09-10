const request = require('supertest');
const app = require('@src/service.js');
const { DB } = require('@src/database/database.js');
const { randomName, createAdminUser, loginUser } = require('../../testUtils');

const dinerUser = { name: 'pizza diner', email: 'reg@test.com', password: 'a' };
let dinerToken;
let menuItemId;

beforeAll(async () => {
  dinerUser.email = randomName() + '@test.com';
  const registerRes = await request(app).post('/api/auth').send(dinerUser);
  dinerToken = registerRes.body.token;

  const item = await DB.addMenuItem({ title: randomName(), description: 'veggie', image: 'pizza1.png', price: 0.0038 });
  menuItemId = item.id;
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

describe('create order', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('an authenticated user can create an order', async () => {
    // The route calls out to the pizza factory -- stub that network call.
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({ reportUrl: 'http://factory/report/1', jwt: 'factory-jwt' }),
    });

    const orderReq = {
      franchiseId: 1,
      storeId: 1,
      items: [{ menuId: menuItemId, description: 'veggie', price: 0.0038 }],
    };
    const orderRes = await request(app)
      .post('/api/order')
      .set('Authorization', `Bearer ${dinerToken}`)
      .send(orderReq);

    expect(orderRes.status).toBe(200);
    expect(orderRes.body.jwt).toBe('factory-jwt');
    expect(orderRes.body.order).toMatchObject({
      franchiseId: 1,
      storeId: 1,
      items: [{ menuId: menuItemId, description: 'veggie', price: 0.0038 }],
    });
    expect(orderRes.body.order.id).toBeDefined();
  });

  test('an unauthenticated user cannot create an order', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');

    const orderReq = {
      franchiseId: 1,
      storeId: 1,
      items: [{ menuId: menuItemId, description: 'veggie', price: 0.0038 }],
    };
    const orderRes = await request(app).post('/api/order').send(orderReq);

    expect(orderRes.status).toBe(401);
    expect(orderRes.body.message).toBe('unauthorized');
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

test('an authenticated user can get their orders', async () => {
  const ordersRes = await request(app)
    .get('/api/order')
    .set('Authorization', `Bearer ${dinerToken}`);

  expect(ordersRes.status).toBe(200);
  expect(ordersRes.body).toHaveProperty('dinerId');
  expect(Array.isArray(ordersRes.body.orders)).toBe(true);
  expect(ordersRes.body).toHaveProperty('page');
});

test('an unauthenticated user cannot get orders', async () => {
  const ordersRes = await request(app).get('/api/order');
  expect(ordersRes.status).toBe(401);
  expect(ordersRes.body.message).toBe('unauthorized');
});
