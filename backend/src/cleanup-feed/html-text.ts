/**
 * Just enough HTML handling to turn a source's rich-text block into the plain
 * text a cleanup description holds. Not a parser — the adapters slice the
 * markup they know, and this renders what they hand over.
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  eacute: 'é',
  egrave: 'è',
  agrave: 'à',
  uuml: 'ü',
  ouml: 'ö',
  auml: 'ä',
  szlig: 'ß',
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => NAMED_ENTITIES[name.toLowerCase()] ?? match);
}

/**
 * Renders a fragment as text: paragraphs separated by blank lines, list items
 * as "- " bullets, everything else stripped.
 */
export function htmlToText(html: string): string {
  const text = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/(p|div|ul|ol|h[1-6]|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  return decodeEntities(text)
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Caps a description without cutting mid-sentence: drops whole paragraphs from
 * the end until it fits.
 */
export function capText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) {
    return text;
  }
  const paragraphs = text.split('\n\n');
  while (paragraphs.length > 1) {
    paragraphs.pop();
    const candidate = paragraphs.join('\n\n');
    if (Buffer.byteLength(candidate, 'utf8') <= maxBytes) {
      return candidate;
    }
  }
  return Buffer.from(text, 'utf8').subarray(0, maxBytes).toString('utf8').trim();
}
