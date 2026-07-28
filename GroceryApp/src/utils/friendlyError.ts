/**
 * friendlyError — turn a caught error into a short, human sentence for an
 * Alert/toast. Raw technical messages (relay JSON, exception stacks, module
 * names like "Ollama or Qwen") should never reach end users; log those to the
 * console/Sentry and show the mapped sentence instead.
 */

export function friendlyError(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  const msg = raw.toLowerCase();

  // Network / relay reachability
  if (msg.includes('network') || msg.includes('fetch') || msg.includes('timeout') || msg.includes('econnrefused')) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  // Auth / enrollment
  if (msg.includes('401') || msg.includes('unauthorized') || msg.includes('token')) {
    return 'Your sync connection needs to be set up again (Settings → Pair a device).';
  }
  if (msg.includes('already been used')) {
    return 'That invite has already been used. Ask for a fresh one.';
  }
  if (msg.includes('expired')) {
    return 'That invite has expired. Ask the person who invited you for a new one.';
  }
  if (msg.includes('invite') || msg.includes('pairing') || msg.includes('signature')) {
    return "That invite link isn't valid. Ask for a new one.";
  }
  // Log the raw detail for developers; return the friendly fallback.
  if (raw) {
    // eslint-disable-next-line no-console
    console.warn('[friendlyError] suppressed technical message:', raw);
  }
  return fallback;
}
