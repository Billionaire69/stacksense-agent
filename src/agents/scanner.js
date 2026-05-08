const { readToolsFromGitHub, writeToolsToGitHub } = require('../utils/github')
const { notify, scanCompleteMessage } = require('../utils/slack')
const { researchNewTools } = require('./research')
const { auditToolData } = require('./audit')
const logger = require('../utils/logger')

function getNextScanDate(days = 2) {
  const next = new Date()
  next.setDate(next.getDate() + days)
  return next.toISOString().split('T')[0]
}

async function runScan() {
  const today = new Date().toISOString().split('T')[0]
  const maxTools = parseInt(process.env.MAX_TOOLS_PER_SCAN || '3')

  logger.info('═══════════════════════════════════════')
  logger.info(`StackSense KB Scan starting — ${today}`)
  logger.info('═══════════════════════════════════════')

  let addedTools = []
  let updatedPricing = []
  let skippedCount = 0

  try {
    // Step 1 — Read current KB from GitHub
    logger.info('Step 1/5 — Reading current KB from GitHub...')
    const { tools, sha } = await readToolsFromGitHub()
    const originalCount = tools.length

    // Step 2 — Research new tools
    logger.info('Step 2/5 — Researching new tools...')
    const newTools = await researchNewTools(tools, maxTools)
    addedTools = newTools.map(t => t.name)

    // Step 3 — Audit existing tool data
    logger.info('Step 3/5 — Auditing existing tool data...')
    const { updated, tools: auditedTools } = await auditToolData(tools)
    updatedPricing = updated // keeping variable name for compatibility

    // Step 4 — Merge and commit
    logger.info('Step 4/5 — Merging and committing to GitHub...')
    const finalTools = [...auditedTools, ...newTools]

    const hasChanges = newTools.length > 0 || updated.length > 0
    if (hasChanges) {
      const commitMsg = [
        `chore: KB scan ${today}`,
        newTools.length > 0 ? `added [${addedTools.join(', ')}]` : '',
        updated.length > 0 ? `updated pricing [${updatedPricing.join(', ')}]` : '',
      ].filter(Boolean).join(' — ')

      await writeToolsToGitHub(finalTools, sha, commitMsg)
      logger.info(`Committed ${finalTools.length} tools (was ${originalCount})`)
    } else {
      logger.info('No changes detected — skipping commit')
    }

    // Step 5 — Notify Slack
    logger.info('Step 5/5 — Sending Slack notification...')
    await notify(scanCompleteMessage({
      date: today,
      added: addedTools,
      updated: updatedPricing,
      skipped: skippedCount,
      total: finalTools.length,
      nextScan: getNextScanDate(2),
    }))

    logger.info('Scan complete ✓')
    logger.info(`Added: ${addedTools.length} | Updated: ${updatedPricing.length} | Total: ${finalTools.length}`)

    return {
      success: true,
      added: addedTools,
      updated: updatedPricing,
      total: finalTools.length,
    }

  } catch (err) {
    logger.error('Scan failed', { error: err.message, stack: err.stack })

    await notify(scanCompleteMessage({
      date: today,
      error: err.message,
      added: [],
      updated: [],
      skipped: 0,
      total: 0,
      nextScan: getNextScanDate(2),
    }))

    return { success: false, error: err.message }
  }
}

module.exports = { runScan }
