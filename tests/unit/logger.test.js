const express = require('express');
const request = require('supertest');
const config = require('@src/config.js');
const logger = require('@src/logger.js');

const LOGGING_CONFIG = { source: 'test-source', endpointUrl: 'https://logs.example/loki/api/v1/push', accountId: '123', apiKey: 'test-key' };

let fetchSpy;
let originalLogging;

beforeEach(() => {
  originalLogging = config.logging;
  config.logging = LOGGING_CONFIG;
  logger.enabled = true;
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
});

afterEach(() => {
  logger.enabled = false;
  config.logging = originalLogging;
  jest.restoreAllMocks();
});

// Each log is one fetch call. This returns the labels and parsed entry of every log sent so far.
function sentLogs() {
  return fetchSpy.mock.calls.map(([, options]) => {
    const [stream] = JSON.parse(options.body).streams;
    return { labels: stream.stream, timestamp: stream.values[0][0], entry: JSON.parse(stream.values[0][1]) };
  });
}

function appWithLogging(user, configure) {
  const app = express();
  app.use(logger.httpLogger);
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = user;
    next();
  });
  app.use(logger.userContext);
  configure(app);
  app.use(logger.unhandledErrorLogger);
  app.use((err, req, res, next) => {
    res.status(err.statusCode ?? 500).json({ message: err.message });
    next();
  });
  return app;
}

test('sends logs to Grafana as Loki streams with credentials', async () => {
  await logger.log('info', 'test', { message: 'hello' });

  expect(fetchSpy).toHaveBeenCalledTimes(1);
  const [url, options] = fetchSpy.mock.calls[0];
  expect(url).toBe(LOGGING_CONFIG.endpointUrl);
  expect(options.method).toBe('POST');
  expect(options.headers.Authorization).toBe('Bearer 123:test-key');
  const [log] = sentLogs();
  expect(log.labels).toEqual({ source: 'test-source', level: 'info', type: 'test' });
  expect(log.timestamp).toMatch(/^\d{19}$/);
  expect(log.entry).toEqual({ message: 'hello' });
});

test('logs HTTP requests with method, path, status, auth, user, and bodies', async () => {
  const user = { id: 7, name: 'pizza diner', email: 'd@jwt.com', roles: [] };
  const app = appWithLogging(user, (a) => a.post('/api/thing', (req, res) => res.status(201).json({ id: 1, name: req.body.name })));

  await request(app).post('/api/thing?x=1').set('Authorization', 'Bearer abc.def.ghi').send({ name: 'pepperoni' });

  const [log] = sentLogs();
  expect(log.labels).toMatchObject({ level: 'info', type: 'http' });
  expect(log.entry).toEqual({
    method: 'POST',
    path: '/api/thing?x=1',
    statusCode: 201,
    authorized: true,
    reqBody: { name: 'pepperoni' },
    resBody: { id: 1, name: 'pepperoni' },
    user: { id: 7, email: 'd@jwt.com' },
  });
});

test('logs unauthenticated requests and non-JSON responses', async () => {
  const app = appWithLogging(null, (a) => a.get('/text', (req, res) => res.status(404).send('not here')));

  await request(app).get('/text');

  const [log] = sentLogs();
  expect(log.labels.level).toBe('warn');
  expect(log.entry).toMatchObject({ method: 'GET', statusCode: 404, authorized: false, resBody: 'not here' });
  expect(log.entry.user).toBeUndefined();
});

test('logs unhandled exceptions and passes them on', async () => {
  const app = appWithLogging({ id: 3, email: 'a@jwt.com' }, (a) =>
    a.get('/boom', () => {
      throw new Error('kaboom');
    })
  );

  const res = await request(app).get('/boom');

  expect(res.status).toBe(500);
  expect(res.body.message).toBe('kaboom');
  const exception = sentLogs().find((log) => log.labels.type === 'exception');
  expect(exception.labels.level).toBe('error');
  expect(exception.entry).toMatchObject({ method: 'GET', path: '/boom', statusCode: 500, message: 'kaboom', user: { id: 3 } });
  expect(exception.entry.stack).toContain('kaboom');
});

test('logs expected errors as warnings', () => {
  const next = jest.fn();
  const err = Object.assign(new Error('unknown user'), { statusCode: 404 });
  logger.unhandledErrorLogger(err, { method: 'PUT', originalUrl: '/api/auth' }, {}, next);

  expect(next).toHaveBeenCalledWith(err);
  expect(sentLogs()[0].labels.level).toBe('warn');
});

test('database and factory logs name the user of the current request', async () => {
  const req = { user: { id: 9, email: 'f@jwt.com' } };
  await new Promise((resolve) =>
    logger.userContext(req, {}, async () => {
      await Promise.resolve();
      logger.dbLogger('SELECT * FROM menu');
      logger.factoryLogger({ reqBody: { order: { id: 1 } }, resBody: { reportUrl: 'http://report' }, statusCode: 200 });
      resolve();
    })
  );
  logger.dbLogger('SELECT 1');

  const [db, factory, outsideRequest] = sentLogs();
  expect(db.labels).toMatchObject({ level: 'info', type: 'db' });
  expect(db.entry).toEqual({ sql: 'SELECT * FROM menu', user: { id: 9, email: 'f@jwt.com' } });
  expect(factory.labels).toMatchObject({ level: 'info', type: 'factory' });
  expect(factory.entry).toEqual({ statusCode: 200, reqBody: { order: { id: 1 } }, resBody: { reportUrl: 'http://report' }, user: { id: 9, email: 'f@jwt.com' } });
  expect(outsideRequest.entry.user).toBeUndefined();
});

test('failed factory requests are logged as errors', () => {
  logger.factoryLogger({ reqBody: {}, resBody: { message: 'nope' }, statusCode: 500 });
  expect(sentLogs()[0].labels.level).toBe('error');
});

test('sanitizes confidential values', async () => {
  const date = new Date('2024-01-02T03:04:05Z');
  await logger.log('info', 'test', {
    reqBody: { email: 'a@jwt.com', password: 'admin', nested: [{ token: 'abc', apiKey: 'xyz', keep: 'me' }] },
    resBody: { user: { id: 1 }, token: 'eyJhbGciOiJI.eyJpZCI6MX0.c2lnbmF0dXJl', jwt: 'pizza' },
    sql: "UPDATE user SET password='$2b$10$hash', email='a@jwt.com' WHERE id=1",
    message: 'jwt eyJhbGciOiJI.eyJpZCI6MX0.c2lnbmF0dXJl and Bearer secret-value failed',
    date,
  });

  const { entry } = sentLogs()[0];
  expect(entry.reqBody).toEqual({ email: 'a@jwt.com', password: '*****', nested: [{ token: '*****', apiKey: '*****', keep: 'me' }] });
  expect(entry.resBody).toEqual({ user: { id: 1 }, token: '*****', jwt: '*****' });
  expect(entry.sql).toBe("UPDATE user SET password='*****', email='a@jwt.com' WHERE id=1");
  expect(entry.message).toBe('jwt ***** and Bearer ***** failed');
  expect(entry.date).toBe(date.toISOString());
});

test('does not send when disabled or not configured', async () => {
  logger.enabled = false;
  await logger.log('info', 'test', {});
  logger.enabled = true;
  config.logging = { ...LOGGING_CONFIG, apiKey: '' };
  await logger.log('info', 'test', {});
  config.logging = undefined;
  await logger.log('info', 'test', {});

  expect(fetchSpy).not.toHaveBeenCalled();
});

test('reports failures to send logs without throwing', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  fetchSpy.mockResolvedValue({ ok: false, status: 401 });
  await logger.log('info', 'test', {});
  expect(logSpy).toHaveBeenCalledWith('Failed to send log to Grafana: 401');

  fetchSpy.mockRejectedValue(new Error('network down'));
  await expect(logger.log('info', 'test', {})).resolves.toBeUndefined();
  expect(logSpy).toHaveBeenCalledWith('Error sending log to Grafana', 'network down');
});

test('logs uncaught exceptions and rejections before exiting', async () => {
  const handlers = {};
  jest.spyOn(process, 'on').mockImplementation((event, handler) => (handlers[event] = handler));
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});

  logger.handleProcessErrors();
  await handlers.uncaughtException(new Error('crash'));
  await handlers.unhandledRejection('rejected');

  const [crash, rejection] = sentLogs();
  expect(crash.entry).toMatchObject({ message: 'crash', fatal: true });
  expect(rejection.entry).toMatchObject({ message: 'rejected', fatal: true });
  expect(exitSpy).toHaveBeenCalledTimes(2);
  expect(exitSpy).toHaveBeenCalledWith(1);
});
