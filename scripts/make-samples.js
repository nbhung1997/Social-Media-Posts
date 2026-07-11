// Generates synthetic "photography" stand-ins under samples/ so the engine
// can be demoed and tested without real shoot assets. Each scene is a CSS/SVG
// composition (fabric weaves, warm light) screenshotted as a JPEG.
'use strict';

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const OUT = path.join(__dirname, '..', 'samples');

const WEAVE = (freq, alpha) => `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='w'><feTurbulence type='fractalNoise' baseFrequency='${freq}' numOctaves='3' stitchTiles='stitch'/><feColorMatrix type='matrix' values='0 0 0 0 0.5 0 0 0 0 0.45 0 0 0 0 0.38 0 0 0 ${alpha} 0'/></filter><rect width='100%25' height='100%25' filter='url(%23w)'/></svg>")`;

const SCENES = [
  {
    name: 'wool-espresso', width: 1600, height: 2000,
    css: `
      background:
        radial-gradient(130% 90% at 25% 12%, rgba(196, 148, 92, 0.28), transparent 55%),
        radial-gradient(120% 120% at 80% 110%, rgba(0,0,0,0.7), transparent 60%),
        linear-gradient(158deg, #3a2a1e 0%, #241710 48%, #140d08 100%);`,
    layers: [
      `position:absolute; inset:0; background-image:${WEAVE('0.55', '0.5')}; mix-blend-mode:overlay;`,
      `position:absolute; inset:0; background:repeating-linear-gradient(24deg, transparent 0 7px, rgba(0,0,0,0.22) 7px 8px); opacity:.7;`,
      `position:absolute; left:12%; top:58%; width:76%; height:1px; background:rgba(232,196,138,0.35); box-shadow:0 0 24px 4px rgba(232,196,138,0.18); transform:rotate(-14deg);`,
    ],
  },
  {
    name: 'linen-cream', width: 1600, height: 2000,
    css: `
      background:
        radial-gradient(120% 80% at 24% 8%, rgba(255,255,248,0.9), transparent 60%),
        linear-gradient(150deg, #f4ecd6 0%, #e9dcba 55%, #d9c797 100%);`,
    layers: [
      `position:absolute; inset:0; background-image:${WEAVE('0.7', '0.35')}; mix-blend-mode:multiply; opacity:.8;`,
      `position:absolute; inset:0; background:repeating-linear-gradient(90deg, transparent 0 5px, rgba(120,100,70,0.10) 5px 6px), repeating-linear-gradient(0deg, transparent 0 5px, rgba(120,100,70,0.08) 5px 6px);`,
      `position:absolute; left:-10%; top:26%; width:120%; height:34%; background:linear-gradient(to bottom, transparent, rgba(120,95,60,0.18) 45%, rgba(90,70,45,0.28) 50%, rgba(120,95,60,0.14) 56%, transparent); transform:rotate(-8deg); filter:blur(2px);`,
    ],
  },
  {
    name: 'chalkstripe-navy', width: 1600, height: 1600,
    css: `
      background:
        radial-gradient(120% 90% at 70% 0%, rgba(120,140,180,0.25), transparent 55%),
        linear-gradient(200deg, #232c3d 0%, #161c29 55%, #0d111b 100%);`,
    layers: [
      `position:absolute; inset:0; background-image:${WEAVE('0.5', '0.4')}; mix-blend-mode:overlay;`,
      `position:absolute; inset:-20%; background:repeating-linear-gradient(102deg, transparent 0 64px, rgba(226,224,214,0.5) 64px 65.5px); filter:blur(0.4px);`,
      `position:absolute; inset:0; background:radial-gradient(90% 70% at 30% 90%, rgba(0,0,0,0.55), transparent 60%);`,
    ],
  },
  {
    name: 'atelier-lamp', width: 2000, height: 1400,
    css: `
      background:
        radial-gradient(60% 90% at 30% 30%, rgba(230,180,110,0.55), transparent 60%),
        radial-gradient(120% 120% at 85% 110%, rgba(0,0,0,0.75), transparent 65%),
        linear-gradient(140deg, #4a3320 0%, #2c1c10 50%, #170e07 100%);`,
    layers: [
      `position:absolute; inset:0; background:repeating-linear-gradient(90deg, transparent 0 52px, rgba(0,0,0,0.28) 52px 55px); opacity:.8;`,
      `position:absolute; inset:0; background-image:${WEAVE('0.18', '0.3')}; mix-blend-mode:overlay;`,
      `position:absolute; left:56%; top:14%; width:34%; height:72%; background:linear-gradient(165deg, rgba(240,228,201,0.16), rgba(240,228,201,0.03)); border-left:2px solid rgba(240,228,201,0.25); transform:skewY(-4deg); filter:blur(1px);`,
    ],
  },
  {
    name: 'brass-button', width: 1600, height: 2000,
    css: `
      background:
        radial-gradient(100% 80% at 70% 20%, rgba(180,140,90,0.3), transparent 55%),
        linear-gradient(170deg, #2b1d12 0%, #1c1209 55%, #100a05 100%);`,
    layers: [
      `position:absolute; inset:0; background-image:${WEAVE('0.6', '0.45')}; mix-blend-mode:overlay;`,
      `position:absolute; left:50%; top:44%; width:420px; height:420px; transform:translate(-50%,-50%); border-radius:50%;
       background:radial-gradient(circle at 38% 32%, #e8c48a 0%, #b8976a 35%, #6d4d26 75%, #3d2a13 100%);
       box-shadow:0 30px 80px rgba(0,0,0,0.7), inset 0 -12px 40px rgba(0,0,0,0.5), inset 0 8px 24px rgba(255,235,200,0.35);`,
      `position:absolute; left:50%; top:44%; width:300px; height:300px; transform:translate(-50%,-50%); border-radius:50%; border:2px solid rgba(61,42,19,0.8); box-shadow:inset 0 0 30px rgba(0,0,0,0.4);`,
    ],
  },
];

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage();
  for (const scene of SCENES) {
    // CSS goes in a <style> block — the weave data-URIs contain quotes that
    // would break out of an inline style attribute.
    const layerCss = scene.layers.map((s, i) => `.layer-${i} { ${s} }`).join('\n');
    const layers = scene.layers.map((_, i) => `<div class="layer-${i}"></div>`).join('');
    const html = `<!doctype html><html><head><style>
      body { margin: 0; }
      .scene { position: relative; overflow: hidden; width: ${scene.width}px; height: ${scene.height}px; ${scene.css} }
      ${layerCss}
    </style></head><body><div class="scene">${layers}</div></body></html>`;
    await page.setViewportSize({ width: scene.width, height: scene.height });
    await page.setContent(html);
    await page.waitForTimeout(60);
    const file = path.join(OUT, `${scene.name}.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 84 });
    console.log(`✓ ${path.relative(process.cwd(), file)} (${scene.width}×${scene.height})`);
  }
  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
