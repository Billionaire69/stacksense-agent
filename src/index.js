require('dotenv').config()

const cron = require('node-cron')
const { runScan } = require('./agents/scanner')
const { auditToolData } = require('./agents/audit')
const logger = require('./utils/logger')
const { startServer, updateState } = require('./server')

const SCAN_SCHEDULE = process.env.SCAN_SCHEDULE || '0 9 */2 * *'   // every 2 days at 9am
const AUDIT_SCHEDULE = process.env.AUDIT_SCHEDULE || '0 10 * * 1'  // every Monday at 10am

function validateEnv() {
  const required = ['GEMINI_API_KEY', 'GITHUB_TOKEN', 'GITHUB_REPO_OWNER', 'GITHUB_REPO_NAME']
  const missing = required.filter(k => !process.env[k])
  if (missing.length > 0) {
    logger.error(`Missing required environment variables: ${missing.join(', ')}`)
    process.exit(1)
  }

  if (!process.env.BRAVE_API_KEY) {
    logger.warn('BRAVE_API_KEY not set — web search disabled, agent will rely on Gemini training data only')
  }

  if (!process.env.SLACK_WEBHOOK_URL) {
    logger.warn('SLACK_WEBHOOK_URL not set — Slack notifications disabled')
  }
}

async function main() {
  logger.info('╔════════════════════════════════════════╗')
  logger.info('║     StackSense Agent — Starting        ║')
  logger.info('╚════════════════════════════════════════╝')

  validateEnv()

  // KB scan cron
  cron.schedule(SCAN_SCHEDULE, async () => {
    logger.info(`Cron triggered: KB scan (${SCAN_SCHEDULE})`)
    updateState({ status: 'Running Full Scan' })
    try {
      await runScan()
    } catch (err) {
      logger.error('Scheduled scan failed', { error: err.message })
    } finally {
      updateState({ status: 'Idle', lastRun: new Date() })
    }
  }, { timezone: 'Asia/Karachi' })

  // Dedicated pricing audit cron — every Monday
  cron.schedule(AUDIT_SCHEDULE, async () => {
    logger.info('Triggering scheduled Audit job...')
    updateState({ status: 'Running Data Audit' })
    try {
      const { readToolsFromGitHub, writeToolsToGitHub } = require('./utils/github')
      const { tools, sha } = await readToolsFromGitHub()
      const { updated, tools: auditedTools } = await auditToolData(tools)
      
      if (updated.length > 0) {
        const commitMsg = `chore: Data audit ${new Date().toISOString().split('T')[0]} — updated [${updated.join(', ')}]`
        await writeToolsToGitHub(auditedTools, sha, commitMsg)
      }
      updateState({ totalTools: auditedTools.length })
    } catch (err) {
      logger.error('Scheduled audit job failed', { error: err.message })
    } finally {
      updateState({ status: 'Idle', lastRun: new Date() })
    }
  })

  logger.info('Agent scheduled tasks initialized.')
  startServer()

  // Keep process alive
  process.on('SIGTERM', () => {
    logger.info('SIGTERM received — shutting down gracefully')
    process.exit(0)
  })

  process.on('SIGINT', () => {
    logger.info('SIGINT received — shutting down')
    process.exit(0)
  })

  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack })
  })

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason })
  })
}

main()
