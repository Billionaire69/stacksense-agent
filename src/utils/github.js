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

// Read current tools.json from GitHub
async function readToolsFromGitHub() {
  try {
    const url = `${BASE}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}?ref=${BRANCH}`
    const res = await axios.get(url, { headers })
    const content = Buffer.from(res.data.content, 'base64').toString('utf8')
    const tools = JSON.parse(content)
    logger.info(`Read ${tools.length} tools from GitHub`)
    return { tools, sha: res.data.sha }
  } catch (err) {
    logger.error('Failed to read tools.json from GitHub', { error: err.message })
    throw err
  }
}

// Write updated tools.json back to GitHub
async function writeToolsToGitHub(tools, sha, commitMessage) {
  try {
    const content = Buffer.from(JSON.stringify(tools, null, 2)).toString('base64')
    const url = `${BASE}/repos/${OWNER}/${REPO}/contents/${FILE_PATH}`

    await axios.put(url, {
      message: commitMessage,
      content,
      sha,
      branch: BRANCH,
    }, { headers })

    logger.info(`Committed to GitHub: ${commitMessage}`)
    return true
  } catch (err) {
    logger.error('Failed to write tools.json to GitHub', { error: err.message })
    throw err
  }
}

// Get latest commit SHA for the branch
async function getLatestCommit() {
  const url = `${BASE}/repos/${OWNER}/${REPO}/commits/${BRANCH}`
  const res = await axios.get(url, { headers })
  return res.data.sha
}

module.exports = { readToolsFromGitHub, writeToolsToGitHub, getLatestCommit }
