const app = require('./service.js');
const metrics = require('./metrics.js');
const logger = require('./logger.js');

metrics.sendMetricsPeriodically(10000);
logger.handleProcessErrors();

const port = process.argv[2] || 3000;
app.listen(port, () => {
  console.log(`Server started on port ${port}`);
});
