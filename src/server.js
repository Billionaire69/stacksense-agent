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

// Endpoint to fetch full state on load
app.get('/api/status', async (req, res) => {
  // Update total tools count asynchronously if possible
  try {
    const { tools } = await readToolsFromGitHub()
    agentState.totalTools = tools.length
    agentState.kbBreakdown = computeKBBreakdown(tools)
  } catch (e) {}

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
    systemHealth
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

module.exports = { startServer, updateState }
