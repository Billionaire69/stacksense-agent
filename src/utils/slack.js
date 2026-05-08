const axios = require('axios')
const logger = require('./logger')

async function notify(payload) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    logger.warn('No Slack webhook configured — skipping notification')
    return
  }

  try {
    await axios.post(webhookUrl, payload)
    logger.info('Slack notification sent')
  } catch (err) {
    logger.error('Failed to send Slack notification', { error: err.message })
  }
}

function scanCompleteMessage({ date, added, updated, skipped, total, nextScan, error }) {
  if (error) {
    return {
      blocks: [
        {
          type: 'header',
          text: { type: 'plain_text', text: '❌ StackSense KB Scan Failed' }
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*Date:* ${date}\n*Error:* ${error}` }
        }
      ]
    }
  }

  const addedText = added.length > 0 ? added.join(', ') : 'none'
  const updatedText = updated.length > 0 ? updated.join(', ') : 'none'

  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔍 StackSense KB Scan Complete' }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Date*\n${date}` },
          { type: 'mrkdwn', text: `*KB Size*\n${total} tools` },
          { type: 'mrkdwn', text: `*✅ Added*\n${addedText}` },
          { type: 'mrkdwn', text: `*🔄 Pricing Updated*\n${updatedText}` },
          { type: 'mrkdwn', text: `*⏭ Skipped*\n${skipped} candidates` },
          { type: 'mrkdwn', text: `*Next Scan*\n${nextScan}` },
        ]
      },
      {
        type: 'divider'
      },
      {
        type: 'context',
        elements: [
          { type: 'mrkdwn', text: 'StackSense Agent · Agentic Layer' }
        ]
      }
    ]
  }
}

function auditCompleteMessage({ date, reviewed, updated, deprecated }) {
  return {
    blocks: [
      {
        type: 'header',
        text: { type: 'plain_text', text: '🔎 StackSense Pricing Audit Complete' }
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `*Date*\n${date}` },
          { type: 'mrkdwn', text: `*Tools Reviewed*\n${reviewed}` },
          { type: 'mrkdwn', text: `*Pricing Updated*\n${updated.length > 0 ? updated.join(', ') : 'none'}` },
          { type: 'mrkdwn', text: `*Deprecated/Changed*\n${deprecated.length > 0 ? deprecated.join(', ') : 'none'}` },
        ]
      }
    ]
  }
}

module.exports = { notify, scanCompleteMessage, auditCompleteMessage }
