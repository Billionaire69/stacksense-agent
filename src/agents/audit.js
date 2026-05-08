const { GoogleGenAI } = require('@google/genai')
const axios = require('axios')
const logger = require('../utils/logger')

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

// Fetch a page (best effort — many will block bots)
async function fetchToolPage(url) {
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; StackSenseBot/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
      },
      maxRedirects: 3,
    })
    // Return first 3000 chars — enough for pricing info
    return res.data?.toString().slice(0, 3000) || ''
  } catch {
    return '' // silently fail — many sites block scrapers
  }
}

// Pick the N tools with oldest lastReviewed dates
function pickToolsForAudit(tools, count = 10) {
  return [...tools]
    .sort((a, b) => {
      const dateA = new Date(a.lastReviewed || '2020-01-01')
      const dateB = new Date(b.lastReviewed || '2020-01-01')
      return dateA - dateB
    })
    .slice(0, count)
}

async function auditToolData(tools) {
  const today = new Date().toISOString().split('T')[0]
  const toAudit = pickToolsForAudit(tools, 10)

  if (toAudit.length === 0) {
    logger.info('No tools found to audit')
    return { updated: [], tools }
  }

  logger.info(`Auditing data for ${toAudit.length} tools...`)

  // Fetch pages in parallel (best effort)
  const pagesData = await Promise.allSettled(
    toAudit.map(async t => ({
      tool: t,
      pageContent: (t.url || t.pricingUrl) ? await fetchToolPage(t.url || t.pricingUrl) : ''
    }))
  )

  const toolsWithPages = pagesData
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)

  // Build the audit prompt
  const auditInput = toolsWithPages.map(({ tool, pageContent }) => `
Tool: ${tool.name}
Current category: ${tool.category}
Current subcategory: ${tool.subcategory}
Current desc: ${tool.desc}
Current integrates: ${Array.isArray(tool.integrates) ? tool.integrates.join(', ') : tool.integrates}
Current pricing: ${tool.pricing}
Current useCase: ${tool.useCase}
Page content snippet: ${pageContent ? pageContent.slice(0, 1500) : 'Could not fetch URL — use your extensive training knowledge'}
  `).join('\n---\n')

  logger.info('Sending tool data to Gemini for analysis...')

  const prompt = `You are the StackSense tool audit agent. Review the following tools and their current data.

Today: ${today}

For each tool, determine if ANY of the data fields are inaccurate, outdated, or incomplete.
Use the page content provided OR your extensive training knowledge about these developer tools.

${auditInput}

Respond ONLY with a valid JSON array of tools that need updates. 
If a tool's data is still completely accurate, DO NOT include it.
If nothing changed, return an empty array: []

For each tool that needs updates, return the ENTIRE tool object with the corrected fields. You must include all fields:
{
  "name": "exact tool name as listed",
  "category": "corrected or original",
  "subcategory": "corrected or original",
  "desc": "corrected or original",
  "integrates": ["corrected", "or", "original"],
  "pricing": "corrected or original",
  "useCase": "corrected or original",
  "notes": "brief note about what you changed (optional)",
  "lastReviewed": "${today}"
}

No markdown, no backticks, just the JSON array.`

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: "application/json"
    }
  })

  const raw = response.text ?? '[]'
  const clean = raw.replace(/```json|```/g, '').trim()

  let updates = []
  try {
    updates = JSON.parse(clean)
    if (!Array.isArray(updates)) updates = []
  } catch (err) {
    logger.error('Failed to parse audit response', { error: err.message })
    return { updated: [], tools }
  }

  // Apply updates to the tools array
  const updatedNames = []
  const updatedTools = tools.map(tool => {
    const update = updates.find(u => u.name?.toLowerCase() === tool.name?.toLowerCase())
    if (update) {
      updatedNames.push(tool.name)
      logger.info(`Data updated for: ${tool.name}`, { notes: update.notes })
      return { ...tool, ...update }
    }
    // Update lastReviewed for audited tools even if nothing changed
    if (toAudit.find(t => t.name === tool.name)) {
      return { ...tool, lastReviewed: today }
    }
    return tool
  })

  logger.info(`Data audit complete. Updated: ${updatedNames.length} tools`)
  return { updated: updatedNames, tools: updatedTools }
}

module.exports = { auditToolData }
