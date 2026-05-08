const { GoogleGenAI } = require('@google/genai')
const { multiSearch } = require('../utils/search')
const logger = require('../utils/logger')

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })

const SEARCH_QUERIES = [
  'new developer tool launched site:producthunt.com',
  'new AI automation tool 2025 launch',
  'Show HN new developer tool site:news.ycombinator.com',
  'new no-code tool launched this week',
  'new AI API launched developer tools',
  'devtools startup launch product hunt',
  'new SaaS automation tool pricing',
]

const TOOL_SCHEMA = `{
  "name": "Tool Name",
  "category": "trigger|orchestration|ai|storage|compute|crm|devops|auth|payments",
  "subcategory": "specific type e.g. llm, vectordb, cicd, messaging",
  "desc": "One sentence what it does",
  "integrates": ["Tool1", "Tool2", "Tool3", "Tool4"],
  "pricing": "Free: X / Paid from $Y/mo",
  "pricingUrl": "https://tool.com/pricing",
  "useCase": "When and why you would use this over alternatives",
  "status": "active",
  "lastReviewed": "[today]",
  "addedBy": "stacksense-agent"
}`

async function researchNewTools(existingTools, maxTools = 3) {
  const today = new Date().toISOString().split('T')[0]
  const existingNames = existingTools.map(t => t.name.toLowerCase())

  logger.info('Starting web search for new tools...')
  const searchResults = await multiSearch(SEARCH_QUERIES)
  logger.info(`Found ${searchResults.length} search results to analyze`)

  if (searchResults.length === 0) {
    logger.warn('No search results returned — check Brave API key')
    return []
  }

  // Format search results for Gemini
  const resultsText = searchResults
    .slice(0, 40) // cap to avoid token overflow
    .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.description || ''}\n`)
    .join('\n')

  const existingList = existingTools
    .map(t => `${t.name} (${t.category})`)
    .join(', ')

  logger.info('Sending results to Gemini for analysis...')

  const prompt = `You are the StackSense knowledge base research agent. Your job is to identify new developer tools worth adding to a curated tool recommendation database.

Today's date: ${today}

## Already in knowledge base (DO NOT re-add these):
${existingList}

## Search results from the last 48 hours:
${resultsText}

## Your task:
Analyze these search results and identify up to ${maxTools} tools that:
1. Are NOT already in the knowledge base (check the list carefully)
2. Have a real public website and pricing page
3. Are production-ready (not vaporware, not closed beta)
4. Are relevant to: AI, automation, DevOps, developer tools, no-code, APIs, databases, auth, payments
5. Are meaningfully different from existing tools — not direct clones

For each qualifying tool, research what you know about it and return it in the exact schema below.

## Quality bar:
- Skip anything without a clear pricing page
- Skip anything in stealth/closed beta
- Skip crypto/web3 tools
- Skip marketing tools unless they have strong automation/API features
- Prefer tools with native integrations and API access

## Output format:
Respond ONLY with a valid JSON array. No markdown, no explanation, no backticks.
If no tools qualify, return an empty array: []

Each tool must follow this exact schema:
${TOOL_SCHEMA}

Replace [today] with: ${today}`

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
    config: {
        responseMimeType: "application/json"
    }
  })

  const raw = response.text ?? '[]'
  const clean = raw.replace(/```json|```/g, '').trim()

  try {
    const newTools = JSON.parse(clean)
    if (!Array.isArray(newTools)) return []

    // Final dedup check — Gemini sometimes misses existing tools
    const filtered = newTools.filter(t => {
      const nameLower = t.name?.toLowerCase()
      if (!nameLower) return false
      if (existingNames.includes(nameLower)) {
        logger.info(`Skipping duplicate: ${t.name}`)
        return false
      }
      return true
    })

    logger.info(`Research agent found ${filtered.length} qualifying new tools`)
    return filtered
  } catch (err) {
    logger.error('Failed to parse Gemini response', { error: err.message, raw: clean.slice(0, 200) })
    return []
  }
}

module.exports = { researchNewTools }
