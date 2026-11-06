const os = require('os');
const config = require('./config.js');

// A user counts as active until they log out or go this long without an authenticated request.
const ACTIVE_USER_WINDOW_MS = 5 * 60 * 1000;

const startTimeUnixNano = toUnixNano(Date.now());

// Counters are cumulative, so a failed push is made up for by the next one.
// They start at zero so that Grafana sees the first increment as a change.
const httpRequests = { GET: 0, PUT: 0, POST: 0, DELETE: 0 };
const authAttempts = { success: 0, failure: 0 };
const pizzas = { sold: 0, creationFailures: 0, revenue: 0 };

const activeUsers = new Map();
const serviceLatency = { total: 0, count: 0 };
const pizzaCreationLatency = { total: 0, count: 0 };
let lastCpuTimes = readCpuTimes();

// Express middleware that records the method and latency of every request.
function requestTracker(req, res, next) {
  const start = Date.now();
  httpRequests[req.method] = (httpRequests[req.method] ?? 0) + 1;

  res.on('finish', () => {
    recordLatency(serviceLatency, Date.now() - start);
    if (req.user) {
      activeUsers.set(req.user.id, Date.now());
    }
  });
  next();
}

// Express middleware for the auth router. It records login attempts and tracks users as they
// log in and out. It relies on requestTracker's finish listener running first, so that a logout
// removes the user after that request has marked them as active.
function authTracker(req, res, next) {
  let authenticatedUser;
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    authenticatedUser = body?.user;
    return sendJson(body);
  };

  res.on('finish', () => {
    const succeeded = res.statusCode < 400;
    if (req.method === 'PUT') {
      authAttempts[succeeded ? 'success' : 'failure']++;
    }
    if (succeeded && authenticatedUser) {
      activeUsers.set(authenticatedUser.id, Date.now());
    }
    if (succeeded && req.method === 'DELETE' && req.user) {
      activeUsers.delete(req.user.id);
    }
  });
  next();
}

// Runs the factory request and records the outcome, including when the request itself throws.
async function trackPizzaPurchase(order, purchase) {
  const start = Date.now();
  let succeeded = false;
  try {
    const response = await purchase();
    succeeded = response.ok;
    return response;
  } finally {
    recordLatency(pizzaCreationLatency, Date.now() - start);
    if (succeeded) {
      pizzas.sold += order.items.length;
      pizzas.revenue += order.items.reduce((total, item) => total + Number(item.price), 0);
    } else {
      pizzas.creationFailures++;
    }
  }
}

function sendMetricsPeriodically(period) {
  const timer = setInterval(() => {
    try {
      sendToGrafana(buildMetrics());
    } catch (error) {
      console.log('Error sending metrics', error);
    }
  }, period);
  timer.unref();
  return timer;
}

function buildMetrics() {
  const metrics = [
    counter('http_requests', '{requests}', Object.entries(httpRequests).map(([method, count]) => dataPoint(count, { method }))),
    counter('auth_attempts', '{attempts}', Object.entries(authAttempts).map(([outcome, count]) => dataPoint(count, { outcome }))),
    counter('pizzas_sold', '{pizzas}', [dataPoint(pizzas.sold)]),
    counter('pizza_creation_failures', '{failures}', [dataPoint(pizzas.creationFailures)]),
    counter('pizza_revenue', '{BTC}', [dataPoint(pizzas.revenue)]),
    gauge('active_users', '{users}', [dataPoint(countActiveUsers())]),
    gauge('cpu_usage', '%', [dataPoint(getCpuUsagePercentage())]),
    gauge('memory_usage', '%', [dataPoint(getMemoryUsagePercentage())]),
  ];

  // Periods without traffic have no latency to report, which is different from a latency of zero.
  addAverageLatency(metrics, 'service_latency', serviceLatency);
  addAverageLatency(metrics, 'pizza_creation_latency', pizzaCreationLatency);
  return metrics;
}

function addAverageLatency(metrics, name, latency) {
  if (latency.count > 0) {
    metrics.push(gauge(name, 'ms', [dataPoint(latency.total / latency.count)]));
    latency.total = 0;
    latency.count = 0;
  }
}

function recordLatency(latency, milliseconds) {
  latency.total += milliseconds;
  latency.count++;
}

function countActiveUsers() {
  const cutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
  for (const [userId, lastSeen] of activeUsers) {
    if (lastSeen < cutoff) {
      activeUsers.delete(userId);
    }
  }
  return activeUsers.size;
}

function readCpuTimes() {
  let idle = 0;
  let total = 0;
  for (const { times } of os.cpus()) {
    idle += times.idle;
    total += times.user + times.nice + times.sys + times.idle + times.irq;
  }
  return { idle, total };
}

// Measures busy time since the previous call. os.loadavg() isn't used because it is always 0 on Windows.
function getCpuUsagePercentage() {
  const current = readCpuTimes();
  const idle = current.idle - lastCpuTimes.idle;
  const total = current.total - lastCpuTimes.total;
  lastCpuTimes = current;
  return total > 0 ? (1 - idle / total) * 100 : 0;
}

function getMemoryUsagePercentage() {
  return (1 - os.freemem() / os.totalmem()) * 100;
}

function dataPoint(value, attributes = {}) {
  return {
    asDouble: value,
    timeUnixNano: toUnixNano(Date.now()),
    attributes: Object.entries({ source: config.metrics.source, ...attributes }).map(([key, stringValue]) => ({ key, value: { stringValue } })),
  };
}

function counter(name, unit, dataPoints) {
  return {
    name,
    unit,
    sum: {
      dataPoints: dataPoints.map((point) => ({ ...point, startTimeUnixNano })),
      aggregationTemporality: 'AGGREGATION_TEMPORALITY_CUMULATIVE',
      isMonotonic: true,
    },
  };
}

function gauge(name, unit, dataPoints) {
  return { name, unit, gauge: { dataPoints } };
}

// OTLP timestamps are strings because nanoseconds don't fit exactly in a JavaScript number.
function toUnixNano(milliseconds) {
  return `${milliseconds}000000`;
}

async function sendToGrafana(metrics) {
  try {
    const response = await fetch(config.metrics.endpointUrl, {
      method: 'POST',
      body: JSON.stringify({ resourceMetrics: [{ scopeMetrics: [{ metrics }] }] }),
      headers: {
        Authorization: `Bearer ${config.metrics.accountId}:${config.metrics.apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!response.ok) {
      console.log(`Failed to push metrics to Grafana: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.log('Error pushing metrics to Grafana', error);
  }
}

module.exports = { requestTracker, authTracker, trackPizzaPurchase, sendMetricsPeriodically };
