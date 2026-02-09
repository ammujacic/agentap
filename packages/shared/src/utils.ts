/**
 * Tag names used by Claude Code for system/IDE injected content.
 */
const TAG_NAMES =
  'system-reminder|ide_opened_file|ide_selection|ide_context|gitStatus|command-name|claudeMd';

/**
 * Regex matching paired system/IDE tags with their content:
 *   <tag>...</tag>
 * Also matches antml:* namespaced tags.
 */
const PAIRED_TAG_PATTERN = new RegExp(
  `<(?:${TAG_NAMES}|antml:[^>]*)>[\\s\\S]*?<\\/(?:${TAG_NAMES}|antml:[^>]*)>`,
  'g'
);

/**
 * Regex matching orphaned/truncated opening tags (no closing tag found).
 * Captures the tag and everything after it — used as a final cleanup
 * for already-truncated strings like "<ide_opened_file>The user op...".
 */
const ORPHAN_TAG_PATTERN = new RegExp(`<(?:${TAG_NAMES}|antml:[^>]*)>[\\s\\S]*`, 'g');

/**
 * Quick check if text contains any system/IDE tags.
 */
export function hasSystemTags(text: string): boolean {
  return new RegExp(`<(?:${TAG_NAMES}|antml:)`).test(text);
}

/**
 * Strip system/IDE tags and their content from user message text,
 * returning only the actual user-authored content.
 * Handles both paired tags and truncated/orphaned opening tags.
 */
export function stripSystemTags(text: string): string {
  // First strip fully paired tags
  let cleaned = text.replace(PAIRED_TAG_PATTERN, '');
  // Then strip any remaining orphaned opening tags (e.g. from truncated text)
  cleaned = cleaned.replace(ORPHAN_TAG_PATTERN, '');
  return cleaned.trim();
}

/**
 * Extract a clean session title from user message text.
 * Returns null if the text is entirely system tags with no real user content.
 * Truncates to 100 characters.
 */
export function extractSessionTitle(text: string): string | null {
  const cleaned = stripSystemTags(text);
  if (!cleaned) return null;
  return cleaned.length > 100 ? cleaned.slice(0, 100) + '...' : cleaned;
}
