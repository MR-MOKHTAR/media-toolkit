/**
 * Finding the link in whatever the user actually gave us.
 *
 * The download field used to accept exactly one shape: a string beginning
 * `http://` or `https://` and nothing else. That is not what is on anyone's
 * clipboard. A share sheet copies "Look at this https://youtu.be/x", a chat
 * message wraps the link in Persian text and a few invisible bidi marks, and a
 * link someone reads out is `youtu.be/x` with no scheme at all. All three were
 * rejected as invalid.
 *
 * This is the frontend half of `validate_url` in `download.rs`, and the two
 * agree on purpose -- the backend has to be right on its own (a retry a week
 * later replays a stored request), and this one exists so the field can show
 * the tidied link and probe it before anything is submitted.
 */

/**
 * Bidi marks, zero-width joiners and the BOM: in the string, not on screen.
 *
 * Tested by code point rather than written into a character class, because the
 * literal characters are invisible in a source file too -- a class nobody can
 * see the contents of is one nobody can review, and one stray edit to it is
 * undetectable by eye.
 */
function isInvisible(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    // Zero-width space through right-to-left mark.
    (code >= 0x200b && code <= 0x200f) ||
    // The bidi embedding and override controls.
    (code >= 0x202a && code <= 0x202e) ||
    // The bidi isolates.
    (code >= 0x2066 && code <= 0x2069) ||
    // Byte order mark, which is what a copy out of a Windows editor leaves.
    code === 0xfeff
  );
}

const strip = (text: string) =>
  [...text].filter((char) => !isInvisible(char)).join("");

/**
 * Trailing punctuation that belongs to the sentence, not to the link.
 * `»` is the closing guillemet and `،` the Arabic comma -- both end a
 * sentence in the languages this app speaks.
 */
const TRAILING = /[.,;:!?"'>»،]+$/;

/**
 * The first link in `text`, tidied, or null if there is none.
 *
 * Used for the clipboard and for a paste, where the text is whatever was
 * copied. A scheme-less host is accepted only when it has a dot in it, because
 * "notes" and "salam" are on clipboards far more often than a hostname is.
 */
export function firstUrlIn(text: string): string | null {
  const cleaned = strip(text);

  const explicit = cleaned.match(/https?:\/\/\S+/i);
  if (explicit) return trimTail(explicit[0]);

  // No scheme. Only the first word is considered: a whole paragraph with a
  // dot in it is not a link, and one word that looks like a host is.
  const word = cleaned.trim().split(/\s+/)[0] ?? "";
  return isBareHost(word) ? `https://${trimTail(word)}` : null;
}

/**
 * What to send for what is in the field.
 *
 * Falls back to the trimmed text rather than null, so the backend is the one
 * that refuses a bad link -- with its own message, in one place, for both the
 * form and a retry.
 */
export function normalizeUrl(raw: string): string {
  return firstUrlIn(raw) ?? raw.trim();
}

/** Whether the field holds something worth spending a probe on. */
export function looksLikeUrl(raw: string): boolean {
  return firstUrlIn(raw) !== null;
}

/**
 * Drops the punctuation a link picked up from the prose around it.
 *
 * A closing bracket is only punctuation when nothing opened it --
 * `en.wikipedia.org/wiki/Bat_(animal)` ends in one on purpose, and cutting it
 * gives a 404.
 */
function trimTail(url: string): string {
  let out = url.replace(TRAILING, "");
  while (
    (out.endsWith(")") && count(out, "(") < count(out, ")")) ||
    (out.endsWith("]") && count(out, "[") < count(out, "]"))
  ) {
    out = out.slice(0, -1).replace(TRAILING, "");
  }
  return out;
}

const count = (text: string, char: string) => text.split(char).length - 1;

/**
 * Whether a scheme-less word is a hostname.
 *
 * A dot with something either side of it, and no other scheme in front --
 * `javascript:alert(1)` and `magnet:?xt=` are not links to download, and
 * `example.com:8080/x` is, so a colon followed by digits is a port rather than
 * a scheme.
 */
function isBareHost(word: string): boolean {
  const authority = word.split(/[/?#]/)[0];
  const colon = authority.indexOf(":");
  if (colon < 0) return /^[\w-]+(\.[\w-]+)+$/.test(authority);

  // Digits after the colon are a port, and what precedes them is still a host
  // to test. Anything else is a scheme, and not one this app downloads over.
  const port = authority.slice(colon + 1);
  if (!/^\d+$/.test(port)) return false;
  return /^[\w-]+(\.[\w-]+)+$/.test(authority.slice(0, colon));
}
