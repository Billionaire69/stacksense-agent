require('dotenv').config()
const { auditToolData } = require('./agents/audit')
const { readToolsFromGitHub, writeToolsToGitHub } = require('./utils/github')
const logger = require('./utils/logger')

async function runAuditNow() {
  logger.info('Manual audit triggered')
  try {
    const { tools, sha } = await readToolsFromGitHub()
    const { updated, tools: auditedTools } = await auditToolData(tools)
    
    if (updated.length > 0) {
      const commitMsg = `chore: Data audit ${new Date().toISOString().split('T')[0]} — updated [${updated.join(', ')}]`
      await writeToolsToGitHub(auditedTools, sha, commitMsg)
      logger.info('Audit changes committed to GitHub')
    } else {
      logger.info('No data changes detected during manual audit')
    }
    process.exit(0)
  } catch (err) {
    logger.error('Manual audit failed', { error: err.message, stack: err.stack })
    process.exit(1)
  }
}

runAuditNow()
