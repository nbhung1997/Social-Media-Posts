// Shared utilities for the Private Pattern post engine.
'use strict';

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const BRAND_DIR = path.join(ROOT, 'brand');
const TEMPLATE_DIR = path.join(__dirname, 'templates');

function loadJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function loadBrand() {
  return loadJSON(path.join(BRAND_DIR, 'brand.config.json'));
}

function loadVoice() {
  return loadJSON(path.join(BRAND_DIR, 'voice.json'));
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function slugify(str) {
  return String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'post';
}

// Deterministic RNG so the same post name renders the same copy on re-runs,
// while different posts rotate through the copy bank.
function seededRng(seedStr) {
  let h = 2166136261;
  for (let i = 0; i < seedStr.length; i++) {
    h ^= seedStr.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let a = h >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

// Minimal template renderer: {{key}} escaped, {{{key}}} raw,
// {{#key}}...{{/key}} block kept only when data[key] is truthy.
function renderTemplate(tpl, data) {
  let out = tpl.replace(/\{\{#([\w.]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, body) =>
    data[key] ? body : ''
  );
  out = out.replace(/\{\{\{([\w.]+)\}\}\}/g, (_, key) => (data[key] ?? ''));
  out = out.replace(/\{\{([\w.]+)\}\}/g, (_, key) => escapeHtml(data[key] ?? ''));
  return out;
}

function fileUrl(p) {
  // pathToFileURL percent-encodes '#', '?', '%', quotes — hand-rolled
  // concatenation breaks on real-world filenames like "look #4.jpg".
  return pathToFileURL(path.resolve(p)).href;
}

const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

function isImageFile(p) {
  return IMAGE_EXTS.has(path.extname(p).toLowerCase());
}

// Expand files/directories into a flat, sorted list of image paths.
function collectPhotos(inputs) {
  const photos = [];
  for (const input of inputs) {
    const abs = path.resolve(input);
    if (!fs.existsSync(abs)) throw new Error(`No such file or directory: ${input}`);
    const stat = fs.statSync(abs);
    if (stat.isDirectory()) {
      const entries = fs.readdirSync(abs).filter(isImageFile).sort();
      for (const e of entries) photos.push(path.join(abs, e));
    } else if (isImageFile(abs)) {
      photos.push(abs);
    } else {
      throw new Error(`Not an image file: ${input}`);
    }
  }
  return photos;
}

module.exports = {
  ROOT,
  BRAND_DIR,
  TEMPLATE_DIR,
  loadJSON,
  loadBrand,
  loadVoice,
  escapeHtml,
  slugify,
  seededRng,
  pick,
  renderTemplate,
  fileUrl,
  isImageFile,
  collectPhotos,
};
