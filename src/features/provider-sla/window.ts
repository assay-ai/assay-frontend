/**
 * What a "window" is, in one place: a binding's calls are measured in windows
 * that close on whichever comes first — enough checked calls, or a 7-day
 * deadline (`deadlineAt` = `openedAt` + 7 days, frozen at open). Every screen
 * that names the window's length uses these words.
 */
export const WINDOW_MAX_DAYS = 7;

/** "up to 7 days, shorter once enough calls are checked" */
export const WINDOW_WORDS = `up to ${WINDOW_MAX_DAYS} days, shorter once enough calls are checked`;
