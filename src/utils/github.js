const axios = require('axios')
const logger = require('./logger')

const BASE = 'https://api.github.com'
const OWNER = process.env.GITHUB_REPO_OWNER
const REPO = process.env.GITHUB_REPO_NAME
const BRANCH = process.env.GITHUB_BRANCH || 'main'
const FILE_PATH = process.env.TOOLS_JSON_PATH || 'lib/tools.json'

const headers = {
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github.v3+json',
  'X-GitHub-Api-Version': '2022-11-28',
}

// In-memory cache — stops 30 second polling
let cache = { tools: null, sha: null, timestamp: null }
const CACHE_TTL = 60 * 60 * 1000 // 1 hour

async function readToolsFromGitHub(force = false) {
  const now = Date.now()
  const cacheValid = cache.tools && cache.timestamp && (now - cache.timestamp) < CACHE_TTL

  if (!force && cacheValid) {
    return { tools: cache.tools, sha: cache.sha }
  }

  try {
    const url = `${BASE}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`
    const res = await axios.get(url, { headers })
    const content = Buffer.from(res.data.content, 'base64').toString('utf8')
    const tools = JSON.parse(content)

    // Update cache
    cache = { tools, sha: res.data.sha, timestamp: Date.now() }
    logger.info(`Read ${tools.length} tools from GitHub`)
    return { tools, sha: res.data.sha }
  } catch (err) {
    logger.error('Failed to read tools.json from GitHub', { error: err.message })
    throw err
  }
}

async function writeToolsToGitHub(tools, sha, commitMessage) {
  try {
    // Always fetch fresh SHA right before writing
    // prevents 409 conflict on concurrent scans
    const fresh = await readToolsFromGitHub(true) // force=true bypasses cache
    const freshSha = fresh.sha

    const content = Buffer.from(JSON.stringify(tools, null, 2)).toString('base64')
    const url = `${BASE}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`

    await axios.put(url, {
      message: commitMessage,
      content,
      sha: freshSha,
      branch: BRANCH,
    }, { headers })

    // Invalidate cache after write
    cache = { tools, sha: null, timestamp: Date.now() }
    logger.info(`Committed to GitHub: ${commitMessage}`)
    return true
  } catch (err) {
    logger.error('Failed to write tools.json to GitHub', { error: err.message })
    throw err
  }
}

function invalidateCache() {
  cache = { tools: null, sha: null, timestamp: null }
}

module.exports = { readToolsFromGitHub, writeToolsToGitHub, invalidateCache }
