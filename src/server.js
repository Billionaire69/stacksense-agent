const express = require('express')
const http = require('http')
const { Server } = require('socket.io')
const path = require('path')
const fs = require('fs')
const { CronExpressionParser } = require('cron-parser')
const logger = require('./utils/logger')
const { runScan } = require('./agents/scanner')
const { readToolsFromGitHub, writeToolsToGitHub } = require('./utils/github')
const { auditToolData } = require('./agents/audit')

// ── Last Scan Summary Parser ───────────────────────────────────────────────
function parseScanSummary() {
  const logPath = path.join(__dirname, '../logs/agent.log')
  const errorPath = path.join(__dirname, '../logs/error.log')
  const summary = {
    lastScanDate: null,
    added: 0,
    updated: 0,
    total: 0,
    commitMsg: null,
    lastAuditDate: null,
    auditUpdated: [],
    recentErrors: []
  }

  try {
    if (fs.existsSync(logPath)) {
      const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n')

      // Walk backwards to find the most recent scan result line
      for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]
        // Added/Updated/Total summary
        const scanMatch = line.match(/Added: (\d+) \| Updated: (\d+) \| Total: (\d+)/)
        if (scanMatch && !summary.lastScanDate) {
          summary.added = parseInt(scanMatch[1])
          summary.updated = parseInt(scanMatch[2])
          summary.total = parseInt(scanMatch[3])
          // Extract date from same line
          const dateMatch = line.match(/\[(.*?)\]/)
          if (dateMatch) summary.lastScanDate = dateMatch[1]
        }

        // Most recent commit message
        const commitMatch = line.match(/Committed to GitHub: (.+)/)
        if (commitMatch && !summary.commitMsg) {
          summary.commitMsg = commitMatch[1].trim()
        }

        // Most recent audit completion line
        const auditMatch = line.match(/Data audit complete\. Updated: (\d+) tools/)
        if (auditMatch && !summary.lastAuditDate) {
          const dateMatch = line.match(/\[(.*?)\]/)
          if (dateMatch) summary.lastAuditDate = dateMatch[1]
        }

        // Collect audit-updated tool names from most recent audit block
        const auditUpdateMatch = line.match(/Data updated for: ([^{]+)/)
        if (auditUpdateMatch && summary.lastAuditDate && summary.auditUpdated.length < 10) {
          summary.auditUpdated.unshift(auditUpdateMatch[1].trim())
        }

        // Stop collecting audit items once we've gone past the scan we care about
        if (summary.lastScanDate && summary.commitMsg && summary.lastAuditDate && summary.total > 0) break
      }
    }
  } catch (e) { /* ignore */ }

  // Recent errors (last 5 from error.log)
  try {
    if (fs.existsSync(errorPath)) {
      const errLines = fs.readFileSync(errorPath, 'utf8').trim().split('\n').filter(Boolean)
      summary.recentErrors = errLines.slice(-5).map(l => {
        const m = l.match(/\[(.*?)\] ERROR (.+)/)
        return m ? { time: m[1].split(' ')[1], msg: m[2].split('{')[0].trim() } : { time: '', msg: l }
      })
    }
  } catch (e) { /* ignore */ }

  return summary
}

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(path.join(__dirname, '../public')))
app.use(express.json())

// Agent State
let agentState = {
  status: 'ONLINE',
  lastRun: null,
  totalTools: 0,
  scansCompleted: 0,
  auditsCompleted: 0,
  kbBreakdown: {}
}

function computeKBBreakdown(tools) {
  const breakdown = {}
  for (const t of tools) {
    const cat = (t.category || 'OTHER').toUpperCase()
    breakdown[cat] = (breakdown[cat] || 0) + 1
  }
  return breakdown
}

// Update state and broadcast to clients
function updateState(newState) {
  agentState = { ...agentState, ...newState }
  io.emit('state_update', {
    ...agentState,
    ...getNextRuns()
  })
}

// Calculate next run times
function getNextRuns() {
  try {
    // Strip surrounding quotes that dotenv may include
    const stripQuotes = (s) => (s || '').replace(/^"|"$/g, '').replace(/^'|'$/g, '').trim()
    const scanStr = stripQuotes(process.env.SCAN_SCHEDULE) || '0 9 * * *'
    const auditStr = stripQuotes(process.env.AUDIT_SCHEDULE) || '0 10 * * *'
    const opts = { tz: 'Asia/Karachi' }
    const nextScan = CronExpressionParser.parse(scanStr, opts).next().toDate()
    const nextAudit = CronExpressionParser.parse(auditStr, opts).next().toDate()
    return { nextScan, nextAudit, scanStr }
  } catch (err) {
    logger.error('Cron parse error: ' + err.message)
    return { nextScan: null, nextAudit: null, scanStr: process.env.SCAN_SCHEDULE }
  }
}

// Hook up logger to socket.io
logger.logEmitter.on('log', (msg) => {
  io.emit('log', msg)
})

// Read and refresh stats
async function refreshStats() {
  try {
    const { tools } = await readToolsFromGitHub()
    updateState({
      totalTools: tools.length,
      kbBreakdown: computeKBBreakdown(tools)
    })
    logger.info(`Dashboard stats refreshed — ${tools.length} tools`)
  } catch (err) {
    logger.error('Failed to refresh dashboard stats', { error: err.message })
  }
}

// Call at startup
refreshStats()

// Endpoint to fetch full state on load
app.get('/api/status', async (req, res) => {

  const systemHealth = {
    brave: process.env.BRAVE_API_KEY ? 'OK' : 'MISSING',
    gemini: process.env.GEMINI_API_KEY ? 'OK' : 'MISSING',
    github: process.env.GITHUB_TOKEN ? 'OK' : 'MISSING',
    slack: process.env.SLACK_WEBHOOK_URL ? 'OK' : 'OFFLINE'
  }

  res.json({
    ...agentState,
    ...getNextRuns(),
    uptime: process.uptime(),
    systemHealth,
    lastScanSummary: parseScanSummary()
  })
})

// Endpoint to fetch recent logs
app.get('/api/logs', (req, res) => {
  const logPath = path.join(__dirname, '../logs/agent.log')
  try {
    if (fs.existsSync(logPath)) {
      const content = fs.readFileSync(logPath, 'utf8')
      const lines = content.trim().split('\n').slice(-100)
      res.json({ logs: lines })
    } else {
      res.json({ logs: [] })
    }
  } catch (err) {
    res.json({ logs: [`Failed to read logs: ${err.message}`] })
  }
})

// Trigger Full Scan
app.post('/api/scan', async (req, res) => {
  if (agentState.status !== 'ONLINE') return res.status(400).json({ error: 'Agent is already busy' })
  res.json({ message: 'Scan started in background' })
  logger.info('Manual full scan triggered via Dashboard')
  
  updateState({ status: 'SCANNING' })
  try {
    await runScan()
    await refreshStats()
    updateState({ scansCompleted: agentState.scansCompleted + 1 })
  } catch (err) {
    logger.error('Manual scan failed', { error: err.message })
  } finally {
    updateState({ status: 'ONLINE', lastRun: new Date() })
  }
})

// Trigger Audit Only
app.post('/api/audit', async (req, res) => {
  if (agentState.status !== 'ONLINE') return res.status(400).json({ error: 'Agent is already busy' })
  res.json({ message: 'Audit started in background' })
  logger.info('Manual data audit triggered via Dashboard')
  
  updateState({ status: 'AUDITING' })
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
    updateState({ 
      totalTools: auditedTools.length,
      kbBreakdown: computeKBBreakdown(auditedTools),
      auditsCompleted: agentState.auditsCompleted + 1
    })
  } catch (err) {
    logger.error('Manual audit failed', { error: err.message })
  } finally {
    updateState({ status: 'ONLINE', lastRun: new Date() })
  }
})

function startServer(port = process.env.PORT || 3001) {
  server.listen(port, () => {
    logger.info(`Arena Dashboard running at http://localhost:${port}`)
  })
}

module.exports = { startServer, updateState, refreshStats }
