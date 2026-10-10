/** True when `value` parses as a URL with exactly the given scheme(s). */
function hasScheme(value: string, schemes: string[]): boolean {
  try {
    return schemes.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

/** The filing form only accepts https upstreams (the API's `@IsUrl({ protocols: ['https'] })`). */
export function isHttpsUrl(value: string): boolean {
  return hasScheme(value, ["https:"]);
}

/** Safe to put in an `href`: anything stored with another scheme (e.g. `javascript:`) is shown as text. */
export function isLinkableUrl(value: string): boolean {
  return hasScheme(value, ["https:", "http:"]);
}
