#!/usr/bin/env node
// Private Pattern post engine — CLI.
//
//   node engine/cli.js create photos/fitting.jpg
//   node engine/cli.js create shoot/ --format square,story --pillar craft
//   node engine/cli.js create --template quote --headline "Tỉ Mỉ"
//   node engine/cli.js templates | formats | pillars
'use strict';

const path = require('path');
const { parseArgs } = require('node:util');
const { loadBrand, slugify, collectPhotos } = require('./lib');
const { generateContent, assembleCaption, PILLARS } = require('./content');
const { lintContent, lintCopy } = require('./voice');
const { createPost, TEMPLATES } = require('./compose');

const HELP = `
Private Pattern — social post engine

Usage:
  pp-post create <photos...> [options]     Compose a post from photos (file(s) or a folder)
  pp-post templates                        List templates
  pp-post formats                          List output formats
  pp-post pillars                          List content pillars

Options:
  --template <t>    auto | ${TEMPLATES.join(' | ')}          (default: auto)
  --format <f,f>    square,portrait,story,landscape | all     (default: square,portrait,story)
  --theme <t>       auto | evening | morning                  (default: auto)
  --logo-pos <p>    mark template: auto | tl | tr | bl | br | tc | bc  (default: auto)
  --logo-size <s>   mark template: small | large               (default: small; large = engraved, edge vignette)
  --label <s>       mark template: micro-label under the logo, e.g. "Live from the Studio"
  --pillar <p>      auto | ${PILLARS.join(' | ')} | general   (default: auto — rotates)
  --name <slug>     Post name; also seeds the copy rotation   (default: from first photo)
  --headline <s>    Override the headline
  --eyebrow <s>     Override the eyebrow micro-label
  --accent <s>      Override the script accent (e.g. "tỉ mỉ")
  --body <s>        Override the caption body
  --caption <s>     Override the full caption verbatim
  --hashtags <s>    Comma-separated hashtag override
  --ai              Draft the caption with Claude from the photos (needs ANTHROPIC_API_KEY
                    or an \`ant auth login\` profile; falls back to the voice bank on failure)
  --brief <s>       Direction for --ai, e.g. "spring linen drop, quiet confidence"
  --jpeg            Write JPEG (q92) instead of PNG
  --out <dir>       Output root (default: ./output)
  -h, --help        Show this help
`;

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      template: { type: 'string', default: 'auto' },
      format: { type: 'string', default: 'square,portrait,story' },
      theme: { type: 'string', default: 'auto' },
      'logo-pos': { type: 'string', default: 'auto' },
      'logo-size': { type: 'string', default: 'auto' },
      label: { type: 'string' },
      pillar: { type: 'string', default: 'auto' },
      name: { type: 'string' },
      headline: { type: 'string' },
      eyebrow: { type: 'string' },
      accent: { type: 'string' },
      body: { type: 'string' },
      caption: { type: 'string' },
      hashtags: { type: 'string' },
      brief: { type: 'string' },
      ai: { type: 'boolean', default: false },
      jpeg: { type: 'boolean', default: false },
      out: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(HELP);
    return;
  }

  const brand = loadBrand();
  if (command === 'templates') {
    console.log(['auto (photo-driven)', ...TEMPLATES].join('\n'));
    return;
  }
  if (command === 'formats') {
    for (const [key, f] of Object.entries(brand.formats)) console.log(`${key.padEnd(10)} ${f.width}×${f.height}  ${f.label}`);
    return;
  }
  if (command === 'pillars') {
    console.log([...PILLARS, 'general'].join('\n'));
    return;
  }
  if (command !== 'create') fail(`Unknown command "${command}". Try: create, templates, formats, pillars.`);

  let photos = [];
  try {
    photos = collectPhotos(rest);
  } catch (err) {
    fail(err.message);
  }
  if (photos.length === 0 && values.template !== 'quote') {
    fail('No photos given. Pass image files or a folder, or use --template quote for a text-only post.');
  }

  const name = slugify(values.name || (photos[0] ? path.basename(photos[0], path.extname(photos[0])) : values.headline || 'quote'));
  const formats = values.format === 'all' ? Object.keys(brand.formats) : values.format.split(',').map((s) => s.trim()).filter(Boolean);

  const overrides = {
    headline: values.headline,
    eyebrow: values.eyebrow,
    accent: values.accent,
    body: values.body,
    caption: values.caption,
    hashtags: values.hashtags ? values.hashtags.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
  };
  for (const k of Object.keys(overrides)) if (overrides[k] === undefined) delete overrides[k];

  let content;
  if (values.ai) {
    try {
      const { aiContent } = require('./claude');
      console.log('· drafting caption with Claude…');
      content = await aiContent({ photos, pillar: values.pillar, brief: values.brief });
      Object.assign(content, overrides);
      // Overridden slots must flow back into the assembled caption.
      if (!overrides.caption) content.caption = assembleCaption(content);
      content.lint = lintContent(content);
    } catch (err) {
      console.warn(`· AI captioning unavailable (${err.message.split('\n')[0]}) — using the voice bank.`);
    }
  }
  if (!content) {
    content = generateContent({ name, pillar: values.pillar, photoCount: photos.length, overrides });
  }

  for (const v of [...(content.lint || []), ...(values.label ? lintCopy(values.label, { context: 'label' }) : [])]) {
    const tag = v.severity === 'warn' ? 'voice note' : 'voice lint';
    console.warn(`· ${tag} [${v.context}] ${v.detail}`);
  }

  console.log(`· composing "${name}" (pillar: ${content.pillar}, copy: ${content.source})`);
  const { outDir, manifest } = await createPost({
    photos,
    content,
    name,
    template: values.template,
    theme: values.theme,
    logoPos: values['logo-pos'],
    logoSize: values['logo-size'],
    label: values.label,
    formats,
    outRoot: values.out ? path.resolve(values.out) : undefined,
    jpeg: values.jpeg,
    log: (m) => console.log(`  ${m}`),
  });

  console.log(`\n✓ ${manifest.images.length} image(s) → ${path.relative(process.cwd(), outDir) || '.'}`);
  console.log(`✓ caption.txt + post.json written`);
  console.log(`\n— caption —\n${content.caption}\n`);
}

main().catch((err) => fail(err.stack || err.message));
