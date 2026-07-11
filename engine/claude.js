// Optional AI captioning — looks at the actual photos and drafts the content
// package in brand voice via the Claude API. Used when --ai is passed (or
// PP_AI=1) and credentials are available; the engine falls back to the
// deterministic voice-bank generator otherwise.
'use strict';

const fs = require('fs');
const path = require('path');
const { BRAND_DIR, loadVoice, loadBrand } = require('./lib');
const { lintContent } = require('./voice');
const { PILLARS, assembleCaption } = require('./content');

const DEFAULT_MODEL = process.env.PP_AI_MODEL || 'claude-opus-4-8';

const MEDIA_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const CONTENT_SCHEMA = {
  type: 'object',
  properties: {
    pillar: { type: 'string', enum: [...PILLARS, 'general'] },
    eyebrow: { type: 'string', description: 'Micro-label above the headline. Title Case, 2-5 words, e.g. "Fabric Milled in Italy".' },
    headline: { type: 'string', description: 'Post headline. Title Case, short and declarative, e.g. "The Cloth Comes First".' },
    accent: { type: 'string', description: 'One short flourish word/phrase set in script, e.g. "tỉ mỉ", "by hand".' },
    hook: { type: 'string', description: 'First caption line. One low, declarative sentence.' },
    body: { type: 'string', description: 'Caption body, 1-3 quiet editorial sentences grounded in what the photos actually show.' },
    signoff: { type: 'string', description: 'Closing line, e.g. "By nomination."' },
    hashtags: { type: 'array', items: { type: 'string' }, description: 'Max 8, lowercase, each starting with #.' },
    altTexts: { type: 'array', items: { type: 'string' }, description: 'One factual alt text per photo, in order.' },
  },
  required: ['pillar', 'eyebrow', 'headline', 'accent', 'hook', 'body', 'signoff', 'hashtags', 'altTexts'],
  additionalProperties: false,
};

function photoBlock(photoPath) {
  const ext = path.extname(photoPath).toLowerCase();
  const mediaType = MEDIA_TYPES[ext];
  if (!mediaType) return null;
  return {
    type: 'image',
    source: { type: 'base64', media_type: mediaType, data: fs.readFileSync(photoPath).toString('base64') },
  };
}

function buildSystemPrompt() {
  const brandMd = fs.readFileSync(path.join(BRAND_DIR, 'BRAND.md'), 'utf8');
  const voice = loadVoice();
  return [
    'You write social media captions for Private Pattern. You are the brand\'s tailor speaking in confidence: low, declarative, slightly arch. Editorial, never marketing-speak.',
    '',
    'Brand rules (follow exactly, especially the "Never" list):',
    brandMd,
    '',
    'Reference copy bank — match this register; do not copy lines verbatim:',
    JSON.stringify(voice.pillars, null, 2),
  ].join('\n');
}

/**
 * Generate the content package from the photos via Claude.
 * @returns {Promise<object>} same shape as content.js generateContent()
 */
async function aiContent({ photos = [], pillar, brief } = {}) {
  let Anthropic;
  try {
    Anthropic = require('@anthropic-ai/sdk');
  } catch {
    throw new Error('AI captioning needs the Anthropic SDK: npm install @anthropic-ai/sdk');
  }
  const client = new Anthropic();

  // The API accepts JPEG/PNG/WebP/GIF; unsupported formats (e.g. AVIF) are
  // skipped here and their alt texts back-filled after the call.
  const imageBlocks = photos.slice(0, 8).map(photoBlock).filter(Boolean);
  const userText = [
    `Write the content package for one social media post. ${imageBlocks.length} of its photo(s) are shown above in posting order.`,
    pillar && pillar !== 'auto' ? `Use the "${pillar}" content pillar.` : 'Choose the content pillar that best fits the photos.',
    brief ? `Direction from the brand: ${brief}` : '',
    'Ground the copy in what the photos actually show — fabric, cut, light, setting — without inventing specifics (no invented prices, dates, fabric names, or people).',
    `Alt texts are factual descriptions of the photos shown, one per photo, in order — exactly ${imageBlocks.length}.`,
  ].filter(Boolean).join('\n');

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 16000,
    thinking: { type: 'adaptive' },
    output_config: { format: { type: 'json_schema', schema: CONTENT_SCHEMA } },
    system: buildSystemPrompt(),
    messages: [{ role: 'user', content: [...imageBlocks, { type: 'text', text: userText }] }],
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined this request; falling back to the voice bank.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Claude response was truncated; falling back to the voice bank.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('No text content in Claude response.');
  let draft;
  try {
    draft = JSON.parse(textBlock.text);
  } catch {
    throw new Error('Claude returned malformed JSON; falling back to the voice bank.');
  }

  const voice = loadVoice();
  const brand = loadBrand();

  // The brand's always-on hashtags lead; the draft fills in, capped at max.
  const always = brand.hashtags?.always || [];
  const hashtags = [...always, ...(draft.hashtags || []).filter((t) => !always.includes(t))]
    .slice(0, brand.hashtags?.max || 8);

  // One alt text per photo — back-fill for photos Claude never saw.
  const altTexts = (draft.altTexts || []).slice(0, photos.length);
  while (altTexts.length < photos.length) altTexts.push(voice.altTextFallback);

  const content = {
    ...draft,
    hashtags,
    altTexts,
    caption: assembleCaption({ hook: draft.hook, body: draft.body, signoff: draft.signoff, hashtags }),
    closeHeadline: voice.carousel.closeHeadlines[0],
    closeBody: voice.carousel.closeBodies[0],
    source: `claude:${DEFAULT_MODEL}`,
  };
  content.lint = lintContent(content);
  return content;
}

module.exports = { aiContent };
