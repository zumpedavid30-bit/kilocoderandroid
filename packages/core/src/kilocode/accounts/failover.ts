// kilocode_change - new file
/**
 * Detects provider failures that another account of the same provider can
 * resolve: rejected credentials, missing permissions, and exhausted quota.
 *
 * The `@opencode-ai/llm` stream only classifies context overflow, so account
 * failures are matched on the provider message. Keep the patterns narrow enough
 * that a genuine model or request error never silently switches accounts.
 */
const patterns = [
  /\b401\b/,
  /\b403\b/,
  /\b429\b/,
  /unauthorized/i,
  /unauthenticated/i,
  /forbidden/i,
  /invalid[_ -]?api[_ -]?key/i,
  /invalid x-api-key/i,
  /incorrect api key/i,
  /authentication (?:error|failed|failure)/i,
  /not (?:authorized|logged in|authenticated)/i,
  /rate limit/i,
  /too many requests/i,
  /quota/i,
  /insufficient[_ ](?:quota|credits|balance|funds)/i,
  /billing/i,
  /credit balance is too low/i,
]

export const failoverable = (message: string) => patterns.some((pattern) => pattern.test(message))

/** Upper bound for account switches inside one provider turn. */
export const MAX_ACCOUNT_ATTEMPTS = 4
