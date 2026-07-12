// Syncs post-worthy imagery + copy from the Private Pattern Airtable base
// into drops/airtable/, using the connection map in brand/airtable.json.
//
//   AIRTABLE_API_KEY=pat… node scripts/pull-airtable.js [fabrics|products|collections|collectionSegments|collectionItems|all] [--limit N]
//
// Writes drops/airtable/<table>/<slug>.<ext> plus drops/airtable/manifest.json
// (record copy + local image paths) for composing posts, e.g.:
//   node engine/cli.js create drops/airtable/fabrics/ns23001.jpg --pillar craft
'use strict';

const fs = require('fs');
const path = require('path');
const { ROOT, loadJSON, slugify } = require('../engine/lib');

const MAP = loadJSON(path.join(ROOT, 'brand', 'airtable.json'));
const OUT = path.join(ROOT, 'drops', 'airtable');
const API = 'https://api.airtable.com/v0';

const IMAGE_EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' };

function apiKey() {
  const key = process.env.AIRTABLE_API_KEY;
  if (!key) {
    console.error('✗ Set AIRTABLE_API_KEY (a pat… token with data.records:read on the Private Pattern base).');
    process.exit(1);
  }
  return key;
}

async function listRecords(table, limit) {
  const records = [];
  let offset;
  do {
    const url = new URL(`${API}/${MAP.baseId}/${table.id}`);
    url.searchParams.set('pageSize', String(Math.min(limit - records.length, 100)));
    for (const f of [table.image, ...table.copy]) url.searchParams.append('fields[]', f);
    if (offset) url.searchParams.set('offset', offset);
    const res = await fetch(url, { headers: { authorization: `Bearer ${apiKey()}` } });
    if (!res.ok) throw new Error(`Airtable ${res.status} on ${table.name}: ${(await res.text()).slice(0, 200)}`);
    const data = await res.json();
    records.push(...data.records);
    offset = data.offset;
  } while (offset && records.length < limit);
  return records.slice(0, limit);
}

async function downloadImage(url, destBase) {
  if (!/^https?:\/\//.test(url)) return { skipped: `not an absolute URL (${url})` };
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) return { skipped: `HTTP ${res.status}` };
  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  const ext = IMAGE_EXT[type] || (type.startsWith('image/') ? '.img' : null);
  if (!ext) return { skipped: `not an image (${type || 'unknown type'})` };
  const file = `${destBase}${ext}`;
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return { file };
}

async function pullTable(key, table, limit) {
  const dir = path.join(OUT, key);
  fs.mkdirSync(dir, { recursive: true });
  const records = await listRecords(table, limit);
  const entries = [];
  for (const rec of records) {
    const fields = rec.fields || {};
    const name = fields[table.copy[0]] || rec.id;
    const entry = { table: key, recordId: rec.id, fields };
    const imageUrl = fields[table.image];
    if (typeof imageUrl === 'string' && imageUrl.trim()) {
      const result = await downloadImage(imageUrl.trim(), path.join(dir, slugify(String(name))));
      if (result.file) {
        entry.image = path.relative(ROOT, result.file);
        console.log(`  ✓ ${key}/${path.basename(result.file)}`);
      } else {
        entry.imageSkipped = result.skipped;
        console.log(`  · ${name}: image skipped — ${result.skipped}`);
      }
    }
    entries.push(entry);
  }
  return entries;
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) || 50 : 50;
  const targets = args.filter((a, i) => !a.startsWith('--') && i !== limitIdx + 1);
  const keys = targets.length && !targets.includes('all')
    ? targets
    : ['fabrics', 'products', 'collections', 'collectionSegments', 'collectionItems'];

  fs.mkdirSync(OUT, { recursive: true });
  const manifestPath = path.join(OUT, 'manifest.json');
  const manifest = fs.existsSync(manifestPath) ? loadJSON(manifestPath) : { entries: [] };

  for (const key of keys) {
    const table = MAP.tables[key];
    if (!table) {
      console.error(`✗ Unknown table "${key}". Available: ${Object.keys(MAP.tables).join(', ')}`);
      process.exit(1);
    }
    console.log(`· pulling ${table.name} (limit ${limit})…`);
    const entries = await pullTable(key, table, limit);
    manifest.entries = manifest.entries.filter((e) => e.table !== key).concat(entries);
  }

  manifest.updated = new Date().toISOString();
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✓ manifest: ${path.relative(ROOT, manifestPath)} (${manifest.entries.length} entries)`);
}

main().catch((err) => { console.error('✗', err.message); process.exit(1); });
