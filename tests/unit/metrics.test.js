const { EventEmitter } = require('events');
const metrics = require('@src/metrics.js');

const PERIOD = 1000;
let fetchSpy;
let timer;

function mockResponse(statusCode = 200) {
  const res = new EventEmitter();
  res.statusCode = statusCode;
  res.json = jest.fn();
  return res;
}

// Sends one report and returns its values, keyed by metric name and then by attribute.
async function nextReport() {
  fetchSpy.mockClear();
  await jest.advanceTimersByTimeAsync(PERIOD);
  const [url, options] = fetchSpy.mock.calls[0];
  const report = { url, headers: options.headers, values: {} };
  const body = JSON.parse(options.body);
  for (const metric of body.resourceMetrics[0].scopeMetrics[0].metrics) {
    report.values[metric.name] = {};
    for (const point of (metric.sum ?? metric.gauge).dataPoints) {
      const label = point.attributes.find((a) => a.key !== 'source')?.value.stringValue ?? 'value';
      report.values[metric.name][label] = point.asDouble;
    }
  }
  return report;
}

function track(tracker, req, statusCode, body) {
  const res = mockResponse(statusCode);
  tracker(req, res, jest.fn());
  if (body) {
    res.json(body);
  }
  return res;
}

beforeEach(() => {
  jest.useFakeTimers();
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true });
  timer = metrics.sendMetricsPeriodically(PERIOD);
});

afterEach(() => {
  clearInterval(timer);
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('reports system metrics as percentages', async () => {
  const { values } = await nextReport();
  expect(values.cpu_usage.value).toBeGreaterThanOrEqual(0);
  expect(values.cpu_usage.value).toBeLessThanOrEqual(100);
  expect(values.memory_usage.value).toBeGreaterThan(0);
  expect(values.memory_usage.value).toBeLessThanOrEqual(100);
});

test('counts requests by method and averages their latency for one period', async () => {
  const before = (await nextReport()).values.http_requests;

  const res1 = track(metrics.requestTracker, { method: 'GET' });
  const res2 = track(metrics.requestTracker, { method: 'OPTIONS' });
  jest.advanceTimersByTime(100);
  res1.emit('finish');
  jest.advanceTimersByTime(100);
  res2.emit('finish');

  const { values } = await nextReport();
  expect(values.http_requests.GET).toBe(before.GET + 1);
  expect(values.http_requests.OPTIONS).toBe((before.OPTIONS ?? 0) + 1);
  expect(values.service_latency.value).toBe(150);

  expect((await nextReport()).values.service_latency).toBeUndefined();
});

test('counts login attempts by outcome', async () => {
  const before = (await nextReport()).values.auth_attempts;

  track(metrics.authTracker, { method: 'PUT' }, 200).emit('finish');
  track(metrics.authTracker, { method: 'PUT' }, 404).emit('finish');
  track(metrics.authTracker, { method: 'PUT' }, 404).emit('finish');
  track(metrics.authTracker, { method: 'POST' }, 200).emit('finish');

  const { auth_attempts } = (await nextReport()).values;
  expect(auth_attempts.success).toBe(before.success + 1);
  expect(auth_attempts.failure).toBe(before.failure + 2);
});

test('tracks active users through login, requests, logout, and inactivity', async () => {
  const activeUsers = async () => (await nextReport()).values.active_users.value;
  const baseline = await activeUsers();

  track(metrics.authTracker, { method: 'PUT' }, 200, { user: { id: 'login-user' } }).emit('finish');
  track(metrics.authTracker, { method: 'PUT' }, 404, { message: 'unknown user' }).emit('finish');
  track(metrics.requestTracker, { method: 'GET', user: { id: 'token-user' } }).emit('finish');
  expect(await activeUsers()).toBe(baseline + 2);

  track(metrics.authTracker, { method: 'DELETE', user: { id: 'login-user' } }, 200).emit('finish');
  expect(await activeUsers()).toBe(baseline + 1);

  jest.setSystemTime(Date.now() + 6 * 60 * 1000);
  expect(await activeUsers()).toBe(0);
});

test('records a successful pizza purchase', async () => {
  const before = (await nextReport()).values;
  const order = { items: [{ price: 0.05 }, { price: 0.25 }] };

  const response = await metrics.trackPizzaPurchase(order, async () => {
    jest.advanceTimersByTime(40);
    return { ok: true };
  });

  const { values } = await nextReport();
  expect(response.ok).toBe(true);
  expect(values.pizzas_sold.value).toBe(before.pizzas_sold.value + 2);
  expect(values.pizza_revenue.value).toBeCloseTo(before.pizza_revenue.value + 0.3);
  expect(values.pizza_creation_failures.value).toBe(before.pizza_creation_failures.value);
  expect(values.pizza_creation_latency.value).toBe(40);
});

test('records a failure when the factory rejects the order or cannot be reached', async () => {
  const before = (await nextReport()).values;
  const order = { items: [{ price: 0.05 }] };

  await metrics.trackPizzaPurchase(order, async () => ({ ok: false }));
  await expect(
    metrics.trackPizzaPurchase(order, async () => {
      throw new Error('factory down');
    })
  ).rejects.toThrow('factory down');

  const { values } = await nextReport();
  expect(values.pizza_creation_failures.value).toBe(before.pizza_creation_failures.value + 2);
  expect(values.pizzas_sold.value).toBe(before.pizzas_sold.value);
  expect(values.pizza_revenue.value).toBe(before.pizza_revenue.value);
  expect(values.pizza_creation_latency.value).toBeDefined();
});

test('authenticates with the configured Grafana credentials', async () => {
  const config = require('@src/config.js');
  const { url, headers } = await nextReport();
  expect(url).toBe(config.metrics.endpointUrl);
  expect(headers.Authorization).toBe(`Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`);
});

test('logs push failures without throwing', async () => {
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

  fetchSpy.mockResolvedValue({ ok: false, status: 401, text: async () => 'bad credentials' });
  await jest.advanceTimersByTimeAsync(PERIOD);
  expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('401 bad credentials'));

  fetchSpy.mockRejectedValue(new Error('network down'));
  await jest.advanceTimersByTimeAsync(PERIOD);
  expect(logSpy).toHaveBeenCalledWith('Error pushing metrics to Grafana', expect.any(Error));
});
