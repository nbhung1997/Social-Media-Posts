// Private Pattern studio — local drop-in UI for the post engine.
// Zero dependencies: photos arrive as base64 JSON, composing runs in-process.
//
//   npm run studio   →   http://localhost:4747
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT, BRAND_DIR, slugify } = require('../engine/lib');
const { generateContent, assembleCaption } = require('../engine/content');
const { lintContent } = require('../engine/voice');
const { createPost } = require('../engine/compose');

const PORT = Number(process.env.PP_PORT || 4747);
const HOST = process.env.PP_HOST || '127.0.0.1';
const OUTPUT_DIR = path.join(ROOT, 'output');
const UPLOAD_DIR = path.join(OUTPUT_DIR, '_uploads');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff2': 'font/woff2',
};

const EXT_FOR = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
}

// Serve a file from inside `rootDir` only — rejects path traversal.
function serveFile(res, rootDir, relPath) {
  const abs = path.normalize(path.join(rootDir, relPath));
  if (!abs.startsWith(rootDir + path.sep) && abs !== rootDir) {
    return send(res, 403, { error: 'forbidden' });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    return send(res, 404, { error: 'not found' });
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(abs).pipe(res);
}

function readBody(req, limit = 64 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        // Don't destroy the socket — the 413 response still has to reach the client.
        req.removeAllListeners('data');
        req.resume();
        reject(Object.assign(new Error('Upload too large — keep the drop under 64 MB.'), { status: 413 }));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on('error', (err) => { if (!done) { done = true; reject(err); } });
  });
}

let composing = false;

async function handleCompose(req, res) {
  if (composing) return send(res, 429, { error: 'Already composing — one at a time, tỉ mỉ.' });
  composing = true;
  try {
    const body = JSON.parse((await readBody(req)).toString('utf8'));
    const opts = body.options || {};
    const name = slugify(opts.name || `drop-${Date.now().toString(36)}`);

    // Persist uploaded photos.
    const photoDir = path.join(UPLOAD_DIR, name);
    fs.rmSync(photoDir, { recursive: true, force: true });
    fs.mkdirSync(photoDir, { recursive: true });
    const photos = [];
    for (const [i, photo] of (body.photos || []).entries()) {
      const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(photo.dataUrl || '');
      if (!m) continue;
      const ext = EXT_FOR[m[1]];
      if (!ext) {
        return send(res, 400, { error: `"${photo.name || 'photo'}" is ${m[1]} — use JPEG, PNG, or WebP.` });
      }
      const file = path.join(photoDir, `${String(i + 1).padStart(2, '0')}${ext}`);
      fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
      photos.push(file);
    }
    if (photos.length === 0 && opts.template !== 'quote') {
      return send(res, 400, { error: 'Drop at least one photo (or choose the quote template).' });
    }

    const overrides = {};
    for (const k of ['headline', 'eyebrow', 'accent', 'body', 'caption']) {
      if (opts[k]) overrides[k] = opts[k];
    }

    let content;
    let aiNote = null;
    if (opts.ai) {
      try {
        const { aiContent } = require('../engine/claude');
        content = await aiContent({ photos, pillar: opts.pillar, brief: opts.brief });
        Object.assign(content, overrides);
        if (!overrides.caption) content.caption = assembleCaption(content);
        content.lint = lintContent(content);
      } catch (err) {
        aiNote = `AI captioning unavailable (${String(err.message).split('\n')[0]}) — used the voice bank.`;
      }
    }
    if (!content) {
      content = generateContent({ name, pillar: opts.pillar || 'auto', photoCount: photos.length, overrides });
    }

    const { outDir, manifest } = await createPost({
      photos,
      content,
      name,
      template: opts.template || 'auto',
      theme: opts.theme || 'auto',
      formats: Array.isArray(opts.formats) && opts.formats.length ? opts.formats : ['square', 'portrait', 'story'],
    });

    send(res, 200, {
      ok: true,
      name,
      aiNote,
      caption: content.caption,
      lint: content.lint || [],
      template: manifest.template,
      theme: manifest.theme,
      source: content.source,
      pillar: content.pillar,
      images: manifest.images.map((img) => ({ ...img, url: `/output/${encodeURIComponent(name)}/${img.file.split(path.sep).map(encodeURIComponent).join('/')}` })),
      outDir: path.relative(ROOT, outDir),
    });
  } catch (err) {
    send(res, err.status || 500, { error: String(err.message || err) });
  } finally {
    composing = false;
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = decodeURIComponent(url.pathname);

  if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
    return serveFile(res, __dirname, 'index.html');
  }
  if (req.method === 'GET' && p.startsWith('/brand/')) {
    return serveFile(res, BRAND_DIR, p.slice('/brand/'.length));
  }
  if (req.method === 'GET' && p.startsWith('/output/')) {
    return serveFile(res, OUTPUT_DIR, p.slice('/output/'.length));
  }
  if (req.method === 'POST' && p === '/api/compose') {
    return void handleCompose(req, res);
  }
  send(res, 404, { error: 'not found' });
});

// Loopback only — the studio is a single-user local tool. Set PP_HOST to
// expose it deliberately.
server.listen(PORT, HOST, () => {
  console.log(`Private Pattern studio — http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log('Drop pictures in. The engine handles the rest.');
});
