import { describe, expect, test } from 'bun:test';

import { decodeEntities, htmlToMarkdown, capText } from './html-markdown';

describe('decodeEntities', () => {
  test('decodes the encodings a source attribute arrives in', () => {
    expect(decodeEntities('Thyon &#038; Veysonnaz')).toBe('Thyon & Veysonnaz');
    expect(decodeEntities('{&quot;lat&quot;:1}')).toBe('{"lat":1}');
    expect(decodeEntities('l&rsquo;&eacute;glise')).toBe('l’église');
  });

  test('leaves an unknown entity untouched rather than mangling it', () => {
    expect(decodeEntities('a &frobnicate; b')).toBe('a &frobnicate; b');
  });
});

describe('htmlToMarkdown', () => {
  test('keeps a link, which is the whole point', () => {
    // Real case: the Kandersteg meeting point links to Google Maps, and
    // flattening it left the anchor text stranded next to its own label.
    expect(
      htmlToMarkdown('<p>Treffpunkt: <a href="https://maps.app.goo.gl/oVvS">Gondelbahn Kandersteg</a></p>'),
    ).toBe('Treffpunkt: [Gondelbahn Kandersteg](https://maps.app.goo.gl/oVvS)');
  });

  test('a bare link with no text becomes an autolink', () => {
    expect(htmlToMarkdown('<p><a href="https://example.org/form"></a></p>')).toBe('<https://example.org/form>');
  });

  test('refuses a javascript: link, keeping only its text', () => {
    expect(htmlToMarkdown('<p><a href="javascript:alert(1)">click me</a></p>')).toBe('click me');
  });

  test('emphasis survives', () => {
    expect(htmlToMarkdown('<p><strong>Treffpunkt:</strong> Kirchplatz</p>')).toBe('**Treffpunkt:** Kirchplatz');
    expect(htmlToMarkdown('<p><em>bitte</em> anmelden</p>')).toBe('*bitte* anmelden');
  });

  test('headings become Markdown headings', () => {
    expect(htmlToMarkdown('<h5>Programm</h5><p>08h00</p>')).toBe('### Programm\n\n08h00');
  });

  test('paragraphs and lists keep their shape', () => {
    expect(htmlToMarkdown('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
    expect(htmlToMarkdown('<ul><li>Gloves</li><li>Picnic</li></ul>')).toBe('- Gloves\n- Picnic');
    // Sources write one item per source line; that must not read as a gap between bullets.
    expect(htmlToMarkdown('<ul type="disc">\n<li>09.00 Uhr</li>\n<li>09.15 Uhr</li>\n</ul>')).toBe('- 09.00 Uhr\n- 09.15 Uhr');
    // But a list still stands apart from the paragraph before it.
    expect(htmlToMarkdown('<p>Programm:</p>\n<ul>\n<li>Eins</li>\n</ul>')).toBe('Programm:\n\n- Eins');
    expect(htmlToMarkdown('<p>08h00 :<br>Welcome</p>')).toBe('08h00 :\nWelcome');
  });

  test('prose that looks like Markdown is escaped, so it reads as written', () => {
    expect(htmlToMarkdown('<p>Kosten: 5*4 Franken [ca.]</p>')).toBe('Kosten: 5\\*4 Franken \\[ca.\\]');
  });

  test('escaping does not damage the syntax it just produced', () => {
    const markdown = htmlToMarkdown('<p>Siehe <a href="https://example.org/a_b">A_B</a> und <strong>5*4</strong></p>');
    expect(markdown).toBe('Siehe [A\\_B](https://example.org/a_b) und **5\\*4**');
  });

  test('scripts and styles never reach the description', () => {
    expect(htmlToMarkdown('<p>Keep</p><script>alert(1)</script><style>.x{}</style>')).toBe('Keep');
  });
});

describe('capText', () => {
  test('short text passes through untouched', () => {
    expect(capText('short', 100)).toBe('short');
  });

  test('drops whole trailing paragraphs to fit', () => {
    const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
    expect(capText(text, 90)).toBe(['a'.repeat(40), 'b'.repeat(40)].join('\n\n'));
  });

  test('falls back to a hard cut when one paragraph is already too long', () => {
    expect(capText('x'.repeat(200), 50).length).toBe(50);
  });
});
