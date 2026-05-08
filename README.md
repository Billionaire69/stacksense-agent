# StackSense Agent

Autonomous research agent that keeps the StackSense tool knowledge base current. Runs on a schedule, researches new tools, audits pricing, commits updates to GitHub, and notifies via Slack.

---

## What it does

- Every 2 days → searches Product Hunt, Hacker News, dev.to for new tools
- Evaluates candidates against quality bar (real pricing page, not beta, meaningfully different)
- Adds up to 3 new tools per scan to `lib/tools.json` in your StackSense repo
- Audits 10 oldest-reviewed tools for pricing changes each scan
- Commits directly to GitHub → Vercel auto-deploys StackSense with fresh data
- Sends Slack notification with summary after every scan

---

## Architecture

```
node-cron (scheduler)
      ↓
Research Agent
  → Brave Search API (finds new tools)
  → Claude API (evaluates and formats)
      ↓
Audit Agent  
  → Fetches pricing pages
  → Claude API (detects changes)
      ↓
GitHub API (commits tools.json)
      ↓
Vercel (auto-deploys StackSense)
      ↓
Slack (notification)
```

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/yourusername/stacksense-agent
cd stacksense-agent
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | console.anthropic.com |
| `GITHUB_TOKEN` | GitHub → Settings → Developer Settings → Personal Access Tokens → Fine-grained → contents: read+write |
| `GITHUB_REPO_OWNER` | your GitHub username |
| `GITHUB_REPO_NAME` | stacksense |
| `BRAVE_API_KEY` | api.search.brave.com (free: 2000 searches/mo) |
| `SLACK_WEBHOOK_URL` | api.slack.com/apps → Incoming Webhooks |

### 3. Run locally

```bash
# Start the scheduler
npm start

# Trigger a manual scan right now
npm run scan
```

---

## Deploy on AWS t4g.small (alongside StackSense)

```bash
# SSH into your instance
ssh ubuntu@your-ec2-ip

# Clone the agent repo
git clone https://github.com/yourusername/stacksense-agent
cd stacksense-agent

# Set up environment
cp .env.example .env
nano .env  # fill in your keys

# Build and run with Docker
docker-compose up -d

# Check it's running
docker-compose logs -f

# Trigger a manual scan to test
docker-compose exec stacksense-agent node src/scan-now.js
```

---

## Manual commands

```bash
# Trigger scan immediately
npm run scan

# Watch logs
tail -f logs/agent.log

# Docker
docker-compose up -d        # start
docker-compose down         # stop
docker-compose logs -f      # logs
docker-compose restart      # restart
```

---

## Cron schedule

| Job | Default schedule | Description |
|---|---|---|
| KB scan | `0 9 */2 * *` | Every 2 days at 9am PKT |
| Pricing audit | `0 10 * * 1` | Every Monday at 10am PKT |

Change via `SCAN_SCHEDULE` and `AUDIT_SCHEDULE` in `.env`.

---

## Extending

### Change scan frequency
```
SCAN_SCHEDULE="0 9 */3 * *"   # every 3 days
SCAN_SCHEDULE="0 9 * * *"     # daily
```

### Add search queries
Edit `src/agents/research.js` → `SEARCH_QUERIES` array.

### Change max tools per scan
```
MAX_TOOLS_PER_SCAN=5
```

---

## Built by Agentic Layer
