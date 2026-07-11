// Smoke test — exercises the content generator, voice linter, and render
// pipeline end-to-end against the committed sample photos.
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { generateContent } = require('../engine/content');
const { lintCopy } = require('../engine/voice');
const { createPost } = require('../engine/compose');

const SAMPLES = path.join(__dirname, '..', 'samples');

async function main() {
  // Voice linter catches the forbidden registers.
  assert.ok(lintCopy('Get yours today!').length >= 2, 'linter should flag exclamation + banned phrase');
  assert.ok(lintCopy('Cut by hand. By nomination.').length === 0, 'on-voice copy should pass');

  // Content generator is deterministic per name and survives its own linter.
  const a = generateContent({ name: 'smoke-a', photoCount: 1 });
  const b = generateContent({ name: 'smoke-a', photoCount: 1 });
  assert.deepStrictEqual(a.caption, b.caption, 'same name → same caption');
  assert.ok(a.caption.includes('#privatepattern'), 'caption carries brand hashtags');
  const hard = (a.lint || []).filter((v) => v.severity !== 'warn');
  assert.deepStrictEqual(hard, [], `voice bank must lint clean: ${JSON.stringify(hard)}`);

  const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-smoke-'));

  // Single dark photo → evening plate.
  const plate = await createPost({
    photos: [path.join(SAMPLES, 'wool-espresso.jpg')],
    content: generateContent({ name: 'smoke-plate', photoCount: 1 }),
    name: 'smoke-plate',
    formats: ['square'],
    outRoot,
  });
  assert.strictEqual(plate.manifest.template, 'plate', 'dark photo auto-picks plate');
  assert.ok(fs.existsSync(path.join(plate.outDir, 'square', '01-plate.png')));
  assert.ok(fs.existsSync(path.join(plate.outDir, 'caption.txt')));
  assert.ok(fs.existsSync(path.join(plate.outDir, 'post.json')));

  // Single bright photo → morning ledger.
  const ledger = await createPost({
    photos: [path.join(SAMPLES, 'linen-cream.jpg')],
    content: generateContent({ name: 'smoke-ledger', photoCount: 1 }),
    name: 'smoke-ledger',
    formats: ['square'],
    outRoot,
  });
  assert.strictEqual(ledger.manifest.template, 'ledger', 'bright photo auto-picks ledger');
  assert.strictEqual(ledger.manifest.theme, 'morning');

  // Photo group → carousel: cover + pages + close.
  const carousel = await createPost({
    photos: [
      path.join(SAMPLES, 'wool-espresso.jpg'),
      path.join(SAMPLES, 'chalkstripe-navy.jpg'),
      path.join(SAMPLES, 'brass-button.jpg'),
    ],
    content: generateContent({ name: 'smoke-carousel', photoCount: 3 }),
    name: 'smoke-carousel',
    formats: ['square'],
    outRoot,
  });
  assert.strictEqual(carousel.manifest.template, 'carousel');
  assert.strictEqual(carousel.manifest.images.length, 5, 'cover + 3 pages + close');

  // Awkward real-world filenames ('#', spaces, parens) must survive the
  // file:// URL round-trip into Chromium.
  const weirdDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-weird-'));
  const weirdPhoto = path.join(weirdDir, 'look #4 (final).jpg');
  fs.copyFileSync(path.join(SAMPLES, 'wool-espresso.jpg'), weirdPhoto);
  const weird = await createPost({
    photos: [weirdPhoto],
    content: generateContent({ name: 'smoke-weird', photoCount: 1 }),
    name: 'smoke-weird',
    formats: ['square'],
    outRoot,
  });
  assert.ok(fs.existsSync(path.join(weird.outDir, 'square', '01-plate.png')), 'weird filename renders');
  fs.rmSync(weirdDir, { recursive: true, force: true });

  // Quote card needs no photo.
  const quote = await createPost({
    photos: [],
    content: generateContent({ name: 'smoke-quote', pillar: 'intention' }),
    name: 'smoke-quote',
    template: 'quote',
    formats: ['story'],
    outRoot,
  });
  assert.strictEqual(quote.manifest.template, 'quote');

  fs.rmSync(outRoot, { recursive: true, force: true });
  console.log('✓ smoke test passed — linter, content, plate, ledger, carousel, quote');
}

main().catch((err) => { console.error('✗', err.message); process.exit(1); });
