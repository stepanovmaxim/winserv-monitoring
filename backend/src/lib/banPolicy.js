// Auto-ban decision, kept pure so the discriminator is unit-tested.
//
// Lesson from production: a single employee whose Outlook/RDP client has a stale
// password hammers ONE account thousands of times from the office IP — that must
// never be auto-banned. A real brute-force / password-spray tries MANY distinct
// accounts. So account *diversity*, not raw failure count, is the signal.
//
// distinctAccounts < minAccounts  -> misconfigured client, do NOT ban (alert only).
// distinctAccounts >= minAccounts -> spray/brute-force, ban.
function shouldAutoBan({ enabled, count, threshold, distinctAccounts, minAccounts = 3 }) {
  if (!enabled) return { ban: false, reason: 'disabled' };
  if (!(count >= threshold)) return { ban: false, reason: 'below-threshold' };
  if (distinctAccounts < Math.max(1, minAccounts)) {
    return { ban: false, reason: 'single-account' }; // one/few accounts → likely a broken client
  }
  return { ban: true, reason: 'spray' };
}

module.exports = { shouldAutoBan };
