/**
 * Turns a source's rich-text block into the Markdown a cleanup description
 * holds. Not a general HTML converter — the adapters slice out the markup they
 * know, and this renders what they hand over, keeping the parts a reader would
 * miss if they were flattened: links above all, then emphasis and structure.
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

/** Characters that would otherwise be read as Markdown once the tags are gone. */
function escapeMarkdown(text: string): string {
  return text.replace(/([\\`*_[\]])/g, '\\$1');
}

function inlineText(html: string): string {
  return escapeMarkdown(decodeEntities(html.replace(/<[^>]+>/g, '')))
    .replace(/[ \t\u00a0]+/g, ' ')
    .trim();
}

/**
 * Renders a fragment as Markdown. Only http(s) and mailto links survive — a
 * source could otherwise smuggle a javascript: URL into a description, and a
 * renderer should never be the only thing standing between that and a reader.
 */
export function htmlToMarkdown(html: string): string {
  // Inline constructs become Markdown up front and are parked as placeholders,
  // so escaping the surrounding prose cannot chew through the syntax they just
  // produced.
  const parked: string[] = [];
  const park = (markdown: string): string => {
    if (!markdown) return '';
    parked.push(markdown);
    return `\u0000${parked.length - 1}\u0000`;
  };

  const withPlaceholders = html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const url = decodeEntities(href).trim();
      const text = inlineText(label);
      if (!/^(https?:|mailto:)/i.test(url)) {
        return park(text);
      }
      return park(text ? `[${text}](${url})` : `<${url}>`);
    })
    .replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => {
      const text = inlineText(inner);
      return park(text ? `**${text}**` : '');
    })
    .replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, inner: string) => {
      const text = inlineText(inner);
      return park(text ? `*${text}*` : '');
    })
    .replace(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi, (_, inner: string) => {
      const text = inlineText(inner);
      return text ? `\n\n${park(`### ${text}`)}\n\n` : '';
    })
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<\/(p|div|ul|ol|tr)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '');

  const escaped = escapeMarkdown(decodeEntities(withPlaceholders));

  const collapsed = escaped
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => parked[Number(index)])
    .replace(/\r/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  return tightenLists(collapsed).trim();
}

/**
 * Sources put their list items on separate source lines, which would otherwise
 * read as a blank line between every bullet. A list is one block.
 */
function tightenLists(markdown: string): string {
  const lines = markdown.split('\n');
  const kept: string[] = [];

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === '') {
      const previous = kept[kept.length - 1];
      const next = lines.slice(index + 1).find((candidate) => candidate !== '');
      if (previous?.startsWith('- ') && next?.startsWith('- ')) {
        continue;
      }
    }
    kept.push(line);
  }

  return kept.join('\n');
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
