// Brand voice linter — enforces the "never" rules from brand/BRAND.md.
// The voice is a tailor speaking in confidence: low, declarative, slightly arch.
'use strict';

const BANNED_PHRASES = [
  'revolutionary',
  'seamless',
  'game-changer',
  'game changer',
  'unlock',
  'elevate your wardrobe',
  'luxury for less',
  'limited time',
  "don't miss",
  'dont miss',
  'get yours',
  'shop now',
  'buy now',
  'order today',
  'act fast',
  'exclusive offer',
  'discount',
  '% off',
  'sale ends',
  'link in bio now',
  'you deserve',
  'treat yourself',
  'must-have',
  'obsessed',
  'we are so excited',
  "we're so excited",
];

const EMOJI_RE = /\p{Extended_Pictographic}/u;

function lintCopy(text, { context = 'copy' } = {}) {
  const violations = [];
  if (text == null || text === '') return violations;
  const str = String(text);
  // Normalize typographic apostrophes so "don’t miss" matches "don't miss".
  const lower = str.toLowerCase().replace(/[‘’]/g, "'");

  if (str.includes('!')) {
    violations.push({ rule: 'no-exclamation', context, detail: 'Exclamation points are never used. Full stops carry the weight.' });
  }
  if (EMOJI_RE.test(str)) {
    violations.push({ rule: 'no-emoji', context, detail: 'No emoji. Ornaments are ✻ · № — set in type, not appended to copy.' });
  }
  for (const phrase of BANNED_PHRASES) {
    if (lower.includes(phrase)) {
      violations.push({ rule: 'banned-phrase', context, detail: `Contains "${phrase}" — marketing-speak the brand never uses.` });
    }
  }
  if (/\bbespoke\b/i.test(str) && !/title/i.test(context)) {
    violations.push({ rule: 'earned-word', context, detail: '"Bespoke" is earned, not filler. Prefer "made to measure" or "cut to a single pattern".', severity: 'warn' });
  }
  return violations;
}

// Lint every string field of a generated content object.
function lintContent(content) {
  const violations = [];
  const fields = ['eyebrow', 'headline', 'hook', 'body', 'signoff', 'caption', 'accent', 'coverKicker', 'closeHeadline', 'closeBody'];
  for (const f of fields) {
    if (content[f]) violations.push(...lintCopy(content[f], { context: f }));
  }
  for (const [i, alt] of (content.altTexts || []).entries()) {
    violations.push(...lintCopy(alt, { context: `altText[${i}]` }));
  }
  for (const tag of content.hashtags || []) {
    // Lowercase letters (any script — #tỉmỉ is on-brand) and digits only.
    if (!/^#[\p{Ll}\p{N}]+$/u.test(tag)) {
      violations.push({ rule: 'hashtag-format', context: 'hashtags', detail: `"${tag}" — hashtags are lowercase, no punctuation.` });
    }
  }
  return violations;
}

module.exports = { lintCopy, lintContent, BANNED_PHRASES };
