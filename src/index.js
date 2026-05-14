require('dotenv').config()

const cron = require('node-cron')
const { runScan } = require('./agents/scanner')
const logger = require('./utils/logger')
const { startServer, updateState } = require('./server')

const SCAN_SCHEDULE = process.env.SCAN_SCHEDULE || '0 4,12,20 * * *'

function validateEnv() {
  const required = ['GEMINI_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  if (!process.env.BRAVE_API_KEY) {
    logger.warn('BRAVE_API_KEY not set — web search disabled')
  }

  if (!process.env.SLACK_WEBHOOK_URL) {
    logger.warn('SLACK_WEBHOOK_URL not set — Slack notifications disabled')
  }
}

// Lock to prevent concurrent scans
let isRunning = false

async function main() {
  logger.info('╔════════════════════════════════════════╗')
  logger.info('║     StackSense Agent — Starting        ║')
  logger.info('╚════════════════════════════════════════╝')

  validateEnv()

  // Single cron — scan + audit run sequentially as one job
  // No timezone — runs in UTC, schedule in UTC
  cron.schedule(SCAN_SCHEDULE, async () => {
    if (isRunning) {
      logger.warn('Previous scan still running — skipping this tick')
      return
    }

    isRunning = true
    logger.info(`Cron triggered: KB scan (${SCAN_SCHEDULE})`)
    updateState({ status: 'Running Scan' })

    try {
      await runScan()
    } catch (err) {
      logger.error('Scheduled scan failed', { error: err.message })
    } finally {
      isRunning = false
      updateState({ status: 'Idle', lastRun: new Date() })
    }
  })

  logger.info(`KB scan scheduled: ${SCAN_SCHEDULE} (UTC)`)
  logger.info('Agent is running. Waiting for next scheduled scan...')

  startServer()

  process.on('SIGTERM', () => { logger.info('SIGTERM — shutting down'); process.exit(0) })
  process.on('SIGINT', () => { logger.info('SIGINT — shutting down'); process.exit(0) })
  process.on('uncaughtException', (err) => { logger.error('Uncaught exception', { error: err.message }) })
  process.on('unhandledRejection', (reason) => { logger.error('Unhandled rejection', { reason }) })
}

main()
