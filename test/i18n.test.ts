import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { describe } from '../src/core/describe.ts';
import { languages } from '../src/core/language.ts';
import type { FlapMove, TuckMove } from '../src/core/types.ts';
import { messages, pageTranslations, preferredLanguage } from '../src/web/i18n.ts';

test('English is the fallback when the browser offers no supported language', () => {
  assert.equal(preferredLanguage(null, ['it-IT']), 'en');
  assert.equal(preferredLanguage(null, ['be-BY']), 'en');
  assert.equal(preferredLanguage(null, []), 'en');
  assert.equal(preferredLanguage(null, ['it-IT', 'ru-RU']), 'ru');
  assert.equal(preferredLanguage('ru', ['en-GB']), 'ru');
});

test('each language covers all page and dynamic translation keys', () => {
  const markup = readFileSync(new URL('../src/web/body.html', import.meta.url), 'utf8');
  const pageKeys = new Set(Array.from(
    markup.matchAll(/\bdata-i18n(?:-aria-label|-title)?="([^"]+)"/g),
    match => match[1]!,
  ));
  assert.ok(pageKeys.size > 0);

  for (const language of languages) {
    assert.deepEqual(Object.keys(messages[language]).sort(), Object.keys(messages.ru).sort(), language);
    if (language === 'ru') continue;
    const dictionary = pageTranslations[language];
    assert.ok(dictionary, language);
    assert.deepEqual(new Set(Object.keys(dictionary)), pageKeys, language);
    for (const [key, text] of Object.entries(dictionary)) assert.ok(text.trim(), `${language}: ${key}`);
  }
});

const flap: FlapMove = {
  kind: 'flap', t: 'd', c: 0, side: 1, dir: 'over', flap: new Set([0]), partial: true,
  box: { x0: 0, y0: 0, x1: 7, y1: 7, w: 8, h: 8 },
};

test('English partial diagonal fold separates the direction from the layers to move', () => {
  assert.equal(describe(flap, 'en'),
    'Fold the upper-right section diagonally over the stack, moving only its top layers.');
});

test('Russian tuck instructions inflect the layers after under and above', () => {
  const tuck: TuckMove = { ...flap, kind: 'tuck', partial: true, depth: 2 };
  assert.match(describe(tuck, 'ru'), /под 2 верхних слоя$/);
  assert.match(describe({ ...tuck, dir: 'under' }, 'ru'), /над 2 нижними слоями$/);
  assert.match(describe({ ...tuck, depth: 1, dir: 'under' }, 'ru'), /над нижним слоем$/);
});
