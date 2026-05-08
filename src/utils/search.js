const axios = require('axios')
const logger = require('./logger')

const BRAVE_API_KEY = process.env.BRAVE_API_KEY
const BASE_URL = 'https://api.search.brave.com/res/v1/web/search'

async function search(query, count = 10) {
  if (!BRAVE_API_KEY) {
    logger.warn('No Brave API key — using fallback search simulation')
    return []
  }

  try {
    const res = await axios.get(BASE_URL, {
      headers: {
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': BRAVE_API_KEY,
      },
      params: {
        q: query,
        count,
        freshness: 'pd', // past 2 days
        text_decorations: false,
        search_lang: 'en',
      }
    })

    const results = res.data.web?.results || []
    return results.map(r => ({
      title: r.title,
      url: r.url,
      description: r.description,
      age: r.age,
    }))
  } catch (err) {
    logger.error('Brave search failed', { query, error: err.message })
    return []
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

// Run searches sequentially with a delay to respect Brave's 1 req/sec rate limit
async function multiSearch(queries) {
  const all = []

  for (let i = 0; i < queries.length; i++) {
    const results = await search(queries[i], 8)
    all.push(...results)
    if (i < queries.length - 1) {
      await sleep(1200) // 1.2s between requests — safe for free tier
    }
  }

  // Deduplicate by URL
  const seen = new Set()
  return all.filter(r => {
    if (seen.has(r.url)) return false
    seen.add(r.url)
    return true
  })
}

module.exports = { search, multiSearch }
