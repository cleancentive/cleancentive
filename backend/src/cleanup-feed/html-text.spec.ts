import { describe, expect, test } from 'bun:test';

import { decodeEntities, htmlToText, capText } from './html-text';

describe('decodeEntities', () => {
  test('decodes the encodings a source attribute arrives in', () => {
    expect(decodeEntities('Thyon &#038; Veysonnaz')).toBe('Thyon & Veysonnaz');
    expect(decodeEntities('{&quot;lat&quot;:1}')).toBe('{"lat":1}');
    expect(decodeEntities('l&rsquo;&eacute;glise')).toBe('l’église');
    expect(decodeEntities('caf&#x e9;'.replace(' ', ''))).toBe('café');
  });

  test('leaves an unknown entity untouched rather than mangling it', () => {
    expect(decodeEntities('a &frobnicate; b')).toBe('a &frobnicate; b');
  });
});

describe('htmlToText', () => {
  test('paragraphs become blank-line separated text', () => {
    expect(htmlToText('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
  });

  test('list items become bullets', () => {
    expect(htmlToText('<ul><li>Gloves</li><li>Picnic</li></ul>')).toBe('- Gloves\n- Picnic');
  });

  test('line breaks inside a paragraph are kept', () => {
    expect(htmlToText('<p>08h00 :<br>Welcome</p>')).toBe('08h00 :\nWelcome');
  });

  test('inline markup is stripped but its text kept', () => {
    expect(htmlToText('<p><strong>Treffpunkt:</strong> Kirchplatz</p>')).toBe('Treffpunkt: Kirchplatz');
  });

  test('scripts and styles never reach the description', () => {
    expect(htmlToText('<p>Keep</p><script>alert(1)</script><style>.x{}</style>')).toBe('Keep');
  });
});

describe('capText', () => {
  test('short text passes through untouched', () => {
    expect(capText('short', 100)).toBe('short');
  });

  test('drops whole trailing paragraphs to fit', () => {
    const text = ['a'.repeat(40), 'b'.repeat(40), 'c'.repeat(40)].join('\n\n');
    const capped = capText(text, 90);
    expect(capped).toBe(['a'.repeat(40), 'b'.repeat(40)].join('\n\n'));
  });

  test('falls back to a hard cut when one paragraph is already too long', () => {
    const capped = capText('x'.repeat(200), 50);
    expect(capped.length).toBe(50);
  });
});
