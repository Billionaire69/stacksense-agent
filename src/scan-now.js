require('dotenv').config()
const { runScan } = require('./agents/scanner')
const logger = require('./utils/logger')

logger.info('Manual scan triggered')

runScan().then(result => {
  if (result.success) {
    logger.info('Manual scan completed successfully', result)
    process.exit(0)
  } else {
    logger.error('Manual scan failed', result)
    process.exit(1)
  }
})
