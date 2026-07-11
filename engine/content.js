// Structured content generator — builds the caption package for a post.
// Deterministic (seeded by post name) so re-runs are stable; different posts
// rotate through the copy bank in brand/voice.json.
'use strict';

const { loadVoice, loadBrand, seededRng, pick } = require('./lib');
const { lintContent } = require('./voice');

const PILLARS = ['craft', 'ease', 'brotherhood', 'intention', 'heritage'];

// Round-robin pillar choice seeded by the post name, so consecutive posts
// tend to rotate pillars instead of repeating one.
function choosePillar(rng) {
  return PILLARS[Math.floor(rng() * PILLARS.length) % PILLARS.length];
}

// hook → body → sign-off → hashtags, blank-line separated.
function assembleCaption({ hook, body, signoff, hashtags }) {
  return [hook, '', body, '', signoff, '', (hashtags || []).join(' ')]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function buildHashtags(brand, pillarBank, rng) {
  const always = brand.hashtags?.always || [];
  const pool = (pillarBank.hashtags || []).slice();
  const chosen = [];
  while (pool.length && chosen.length < 3) {
    const i = Math.floor(rng() * pool.length) % pool.length;
    chosen.push(pool.splice(i, 1)[0]);
  }
  const max = brand.hashtags?.max || 8;
  return [...always, ...chosen].slice(0, max);
}

/**
 * Generate the structured content package for a post.
 *
 * @param {object} opts
 * @param {string} opts.name       post name/slug — seeds the rotation
 * @param {string} [opts.pillar]   craft|ease|brotherhood|intention|heritage|general (default: rotate)
 * @param {number} [opts.photoCount]
 * @param {object} [opts.overrides] user-provided copy: eyebrow, headline, accent, hook, body, signoff, caption, hashtags, alt
 * @returns {object} content package (see post.json schema in README)
 */
function generateContent(opts = {}) {
  const voice = loadVoice();
  const brand = loadBrand();
  const rng = seededRng(String(opts.name || 'post'));
  const overrides = opts.overrides || {};

  let pillar = opts.pillar && opts.pillar !== 'auto' ? opts.pillar : choosePillar(rng);
  if (pillar !== 'general' && !PILLARS.includes(pillar)) {
    throw new Error(`Unknown pillar "${pillar}". Use one of: ${PILLARS.join(', ')}, general.`);
  }
  const bank = pillar === 'general' ? voice.general : voice.pillars[pillar];

  const eyebrow = overrides.eyebrow ?? pick(rng, bank.eyebrows);
  const headline = overrides.headline ?? pick(rng, bank.headlines);
  let accent = overrides.accent ?? pick(rng, bank.accents);
  if (!overrides.accent && accent.toLowerCase() === eyebrow.toLowerCase() && bank.accents?.length > 1) {
    accent = bank.accents[(bank.accents.indexOf(accent) + 1) % bank.accents.length];
  }
  const hook = overrides.hook ?? pick(rng, bank.hooks);
  const body = overrides.body ?? pick(rng, bank.bodies);
  const signoff = overrides.signoff ?? pick(rng, bank.signoffs);
  const hashtags = overrides.hashtags ?? buildHashtags(brand, bank, rng);

  const caption = overrides.caption ?? assembleCaption({ hook, body, signoff, hashtags });

  // Text-only posts still publish one card image — alt text describes it.
  const photoCount = opts.photoCount ?? 1;
  const altTexts = [];
  if (photoCount === 0) {
    altTexts.push(overrides.alt?.[0] ?? `Text card in the Private Pattern house style. It reads: ${headline}.`);
  }
  for (let i = 0; i < photoCount; i++) {
    altTexts.push(overrides.alt?.[i] ?? voice.altTextFallback);
  }

  const content = {
    pillar,
    eyebrow,
    headline,
    accent,
    hook,
    body,
    signoff,
    caption,
    hashtags,
    altTexts,
    closeHeadline: pick(rng, voice.carousel.closeHeadlines),
    closeBody: pick(rng, voice.carousel.closeBodies),
    source: 'voice-bank',
  };

  content.lint = lintContent(content);
  return content;
}

module.exports = { generateContent, assembleCaption, PILLARS };
