// Render pipeline — turns photos + a content package into finished post
// images via HTML templates rendered in Chromium (Playwright).
'use strict';

const fs = require('fs');
const path = require('path');
const {
  ROOT, BRAND_DIR, TEMPLATE_DIR,
  loadBrand, renderTemplate, fileUrl, seededRng,
} = require('./lib');

const SINGLE_TEMPLATES = ['plate', 'full-bleed', 'ledger', 'quote'];
const TEMPLATES = [...SINGLE_TEMPLATES, 'carousel'];

async function launchBrowser() {
  const { chromium } = require('playwright');
  try {
    // file:// pages need to read file:// photos (canvas probe) — same-origin
    // rules treat every file as cross-origin without this flag.
    return await chromium.launch({ args: ['--allow-file-access-from-files'] });
  } catch (err) {
    if (/executable doesn't exist|browserType.launch/i.test(String(err.message))) {
      throw new Error(`Chromium is not installed for Playwright. Run: npx playwright install chromium\n(${String(err.message).split('\n')[0]})`);
    }
    throw err;
  }
}

// Measure each photo inside the browser: dimensions + perceptual luminance
// (downsampled). Luminance drives the auto theme/template choice.
async function probePhotos(page, photos) {
  // file:// images can't be decoded from about:blank — probe from a file:// page.
  await page.goto(fileUrl(path.join(TEMPLATE_DIR, 'probe.html')));
  const results = [];
  for (const photo of photos) {
    const info = await page.evaluate(async (url) => {
      const img = new Image();
      img.src = url;
      await img.decode();
      const size = 32;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, size, size);
      const { data } = ctx.getImageData(0, 0, size, size);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      }
      return {
        width: img.naturalWidth,
        height: img.naturalHeight,
        luminance: sum / (data.length / 4) / 255,
      };
    }, fileUrl(photo));
    results.push({ file: photo, ...info });
  }
  return results;
}

function decideTemplate({ template, photos, probes, brand }) {
  if (template && template !== 'auto') {
    if (!TEMPLATES.includes(template)) {
      throw new Error(`Unknown template "${template}". Use one of: ${TEMPLATES.join(', ')}, auto.`);
    }
    return template;
  }
  if (photos.length === 0) return 'quote';
  if (photos.length > 1) return 'carousel';
  const threshold = brand.autoTheme?.luminanceThreshold ?? 0.55;
  return probes[0].luminance > threshold ? 'ledger' : 'plate';
}

const THEMES = ['evening', 'morning'];

function decideTheme({ theme, template }) {
  if (template === 'ledger') return 'morning';
  if (theme && theme !== 'auto') {
    if (!THEMES.includes(theme)) {
      throw new Error(`Unknown theme "${theme}". Use one of: ${THEMES.join(', ')}, auto.`);
    }
    return theme;
  }
  return 'evening';
}

// Expand a post into its slides. Single templates yield one slide; carousel
// yields cover + one page per photo + closing card.
function buildSlides({ template, photos, content }) {
  if (template !== 'carousel') {
    if (template === 'quote' && photos.length > 0) {
      throw new Error('The quote template is text-only — drop the photos or pick another template.');
    }
    if (template !== 'quote' && photos.length === 0) {
      throw new Error(`Template "${template}" needs a photo. Pass one, or use --template quote for a text-only post.`);
    }
    if (template !== 'quote' && photos.length > 1) {
      throw new Error(`Template "${template}" composes a single photo; you passed ${photos.length}. Pass one photo, or use --template carousel for the set.`);
    }
    return [{ kind: template, template, photo: photos[0] || null, index: 1, count: 1 }];
  }
  if (photos.length < 2) {
    throw new Error('A carousel needs at least 2 photos.');
  }
  const count = photos.length + 2; // cover + photos + close
  const slides = [{ kind: 'cover', template: 'carousel-cover', photo: photos[0], index: 1, count }];
  photos.forEach((photo, i) => {
    slides.push({ kind: `page-${i + 1}`, template: 'carousel-page', photo, index: i + 2, count });
  });
  slides.push({ kind: 'close', template: 'carousel-close', index: count, count });
  return slides;
}

function selvageText(brand) {
  const unit = brand.selvage;
  return Array(4).fill(unit).join(' · ') + ' ·';
}

function templateData({ slide, format, theme, content, brand, name }) {
  const rng = seededRng(`ledger:${name}`);
  const ledgerNo = String(1 + Math.floor(rng() * 899)).padStart(3, '0');
  return {
    theme,
    formatClass: `format-${format}`,
    tokensUrl: fileUrl(path.join(BRAND_DIR, 'tokens.css')),
    baseCssUrl: fileUrl(path.join(TEMPLATE_DIR, 'base.css')),
    logoUrl: fileUrl(path.join(BRAND_DIR, brand.logo.mask)),
    monogramUrl: fileUrl(path.join(BRAND_DIR, brand.logo.monogram)),
    photoUrl: slide.photo ? fileUrl(slide.photo) : '',
    selvage: selvageText(brand),
    eyebrow: slide.template === 'carousel-close' ? 'By Nomination' : content.eyebrow,
    headline: slide.template === 'carousel-close' ? content.closeHeadline : content.headline,
    accent: content.accent,
    body: slide.template === 'carousel-close' ? content.closeBody
      : slide.template === 'quote' ? content.hook
      : '',
    index: slide.index,
    count: slide.count,
    ledgerNo,
  };
}

async function renderSlide(page, htmlPath, outPath, { width, height }, type) {
  await page.setViewportSize({ width, height });
  await page.goto(fileUrl(htmlPath));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() =>
    Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0)
  );
  await page.waitForTimeout(150); // let masks/filters settle
  await page.screenshot({ path: outPath, type, ...(type === 'jpeg' ? { quality: 92 } : {}) });
}

/**
 * Compose a post: render every slide in every requested format and write the
 * structured content alongside.
 *
 * @param {object} opts
 * @param {string[]} opts.photos      absolute photo paths (may be empty for quote)
 * @param {object}   opts.content     content package from content.js / claude.js
 * @param {string}   opts.name        post slug
 * @param {string}   [opts.template]  auto|plate|full-bleed|ledger|quote|carousel
 * @param {string}   [opts.theme]     auto|evening|morning
 * @param {string[]} [opts.formats]   e.g. ['square','story']
 * @param {string}   [opts.outRoot]   output root dir (default: ./output)
 * @param {boolean}  [opts.jpeg]      write JPEG instead of PNG
 * @param {function} [opts.log]
 */
async function createPost(opts) {
  const brand = loadBrand();
  const log = opts.log || (() => {});
  const formats = opts.formats?.length ? opts.formats : ['square', 'portrait', 'story'];
  for (const f of formats) {
    if (!brand.formats[f]) throw new Error(`Unknown format "${f}". Available: ${Object.keys(brand.formats).join(', ')}.`);
  }

  const outRoot = opts.outRoot || path.join(ROOT, 'output');
  const outDir = path.join(outRoot, opts.name);
  // Fresh slate — a re-run with fewer slides or different formats must not
  // leave stale images from the previous composition.
  fs.rmSync(outDir, { recursive: true, force: true });
  const buildDir = path.join(outDir, '.build');
  fs.mkdirSync(buildDir, { recursive: true });

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    const probes = await probePhotos(page, opts.photos);
    const template = decideTemplate({ template: opts.template, photos: opts.photos, probes, brand });
    const theme = decideTheme({ theme: opts.theme, template });
    const slides = buildSlides({ template, photos: opts.photos, content: opts.content });
    log(`template: ${template} · theme: ${theme} · slides: ${slides.length} · formats: ${formats.join(', ')}`);

    const imageType = opts.jpeg ? 'jpeg' : 'png';
    const images = [];
    for (const format of formats) {
      const { width, height } = brand.formats[format];
      const formatDir = path.join(outDir, format);
      fs.mkdirSync(formatDir, { recursive: true });
      for (const slide of slides) {
        const data = templateData({ slide, format, theme, content: opts.content, brand, name: opts.name });
        const tpl = fs.readFileSync(path.join(TEMPLATE_DIR, `${slide.template}.html`), 'utf8');
        const htmlPath = path.join(buildDir, `${format}-${slide.index}.html`);
        fs.writeFileSync(htmlPath, renderTemplate(tpl, data));
        const file = path.join(formatDir, `${String(slide.index).padStart(2, '0')}-${slide.kind}.${imageType === 'jpeg' ? 'jpg' : 'png'}`);
        await renderSlide(page, htmlPath, file, { width, height }, imageType);
        images.push({ format, slide: slide.kind, width, height, file: path.relative(outDir, file) });
        log(`  rendered ${format}/${path.basename(file)}`);
      }
    }

    fs.writeFileSync(path.join(outDir, 'caption.txt'), opts.content.caption + '\n');
    const manifest = {
      name: opts.name,
      created: new Date().toISOString(),
      template,
      theme,
      formats,
      photos: probes.map((p) => ({ ...p, file: path.relative(ROOT, p.file) })),
      content: opts.content,
      images,
    };
    fs.writeFileSync(path.join(outDir, 'post.json'), JSON.stringify(manifest, null, 2) + '\n');
    fs.rmSync(buildDir, { recursive: true, force: true });
    return { outDir, manifest };
  } finally {
    await browser.close();
  }
}

module.exports = { createPost, TEMPLATES, SINGLE_TEMPLATES };
