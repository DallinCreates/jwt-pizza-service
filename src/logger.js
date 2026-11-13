const { AsyncLocalStorage } = require('async_hooks');
const config = require('./config.js');

const REDACTED = '*****';

// Values under these keys are never logged, wherever they appear in a log entry.
const SENSITIVE_KEY = /password|token|jwt|secret|api_?key|authorization/i;

// Credentials that can show up inside strings, such as the hashed password updateUser writes into its SQL.
const SENSITIVE_TEXT = [
  [/(password\s*=\s*)'[^']*'/gi, `$1'${REDACTED}'`],
  [/eyJ[\w-]*\.[\w-]*\.[\w-]*/g, REDACTED],
  [/(bearer\s+)\S+/gi, `$1${REDACTED}`],
];

const SEND_TIMEOUT_MS = 5000;

// Carries the authenticated user through each request so that database and factory logs can name them.
const requestContext = new AsyncLocalStorage();

class Logger {
  constructor() {
    // Tests stub fetch and assert on its calls, so logs are only shipped when a test turns this on.
    this.enabled = process.env.NODE_ENV !== 'test';
  }

  // Express middleware that logs every request once its response is finished.
  httpLogger = (req, res, next) => {
    let resBody;
    const send = res.send;
    res.send = function (body) {
      resBody = body;
      // res.send calls itself again when given an object, so only the first call is captured.
      res.send = send;
      return send.call(this, body);
    };

    res.on('finish', () => {
      this.log(
        levelForStatus(res.statusCode),
        'http',
        {
          method: req.method,
          path: req.originalUrl,
          statusCode: res.statusCode,
          authorized: !!req.headers.authorization,
          reqBody: req.body,
          resBody: parseJson(resBody),
        },
        req.user
      );
    });
    next();
  };

  // Express middleware that must come after authentication, so that later logs know who made the request.
  userContext = (req, res, next) => {
    requestContext.run({ user: req.user }, next);
  };

  // Express error middleware that logs the error and passes it on to the app's own error handler.
  unhandledErrorLogger = (err, req, res, next) => {
    const statusCode = err.statusCode ?? 500;
    this.log(statusCode >= 500 ? 'error' : 'warn', 'exception', { method: req.method, path: req.originalUrl, statusCode, message: err.message, stack: err.stack }, req.user);
    next(err);
  };

  dbLogger(sql) {
    return this.log('info', 'db', { sql });
  }

  factoryLogger({ reqBody, resBody, statusCode }) {
    return this.log(statusCode >= 400 ? 'error' : 'info', 'factory', { statusCode, reqBody, resBody });
  }

  // Node crashes on these by default. This logs them first and then exits the same way.
  handleProcessErrors() {
    const logAndExit = async (error) => {
      console.error(error);
      await this.log('error', 'exception', { message: error?.message ?? String(error), stack: error?.stack, fatal: true });
      process.exit(1);
    };
    process.on('uncaughtException', logAndExit);
    process.on('unhandledRejection', logAndExit);
  }

  // Returns a promise that never rejects, so callers don't have to wait for or guard the send.
  log(level, type, data, user = requestContext.getStore()?.user) {
    const entry = sanitize({ ...data, user: user ? { id: user.id, email: user.email } : undefined });
    const labels = { source: config.logging?.source, level, type };
    return this.sendLogToGrafana({ streams: [{ stream: labels, values: [[`${Date.now()}000000`, JSON.stringify(entry)]] }] });
  }

  async sendLogToGrafana(event) {
    const { endpointUrl, accountId, apiKey } = config.logging ?? {};
    if (!this.enabled || !endpointUrl || !accountId || !apiKey) {
      return;
    }
    try {
      const response = await fetch(endpointUrl, {
        method: 'POST',
        body: JSON.stringify(event),
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accountId}:${apiKey}`,
        },
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.log(`Failed to send log to Grafana: ${response.status}`);
      }
    } catch (error) {
      console.log('Error sending log to Grafana', error.message);
    }
  }
}

function levelForStatus(statusCode) {
  if (statusCode >= 500) return 'error';
  if (statusCode >= 400) return 'warn';
  return 'info';
}

function parseJson(body) {
  if (typeof body !== 'string') {
    return body;
  }
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}

function sanitize(value) {
  if (typeof value === 'string') {
    return SENSITIVE_TEXT.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitize);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, SENSITIVE_KEY.test(key) ? REDACTED : sanitize(field)]));
  }
  return value;
}

// Only plain objects are walked, so values such as Dates still serialize normally.
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

module.exports = new Logger();
module.exports.sanitize = sanitize;
