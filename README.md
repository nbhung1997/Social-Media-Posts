# Private Pattern — Post Engine

Drop pictures in. Get finished, on-brand social posts out — branded images in
every format, plus a structured caption package written in the house voice.

Built on the **Atelier Ledger / Mahogany Smoking Lounge** design system:
walnut and brass, engraved Copperplate, gilt double-fillet frames, the Drape
Club selvage ribbon. The full brand kit (logo, fonts, tokens, voice rules)
lives in [`brand/`](brand/BRAND.md).

## What it does

- **One photo** → a single editorial post. Dark photos compose on the evening
  walnut *plate*; bright photos compose on the morning parchment *ledger*
  (the clock-driven theming of the marketing site, driven here by the photo).
- **A group of photos** → a carousel: branded cover, one plate per photo
  (`№ 2 / 6` ledger marks), and a "By Nomination" closing card.
- **No photo** → a text-only *quote* card.
- Every post also gets **structured content**: a caption in brand voice
  (hook → body → sign-off → hashtags), alt text per image, and a `post.json`
  manifest — checked by a **voice linter** that enforces the brand's "never"
  rules (no emoji, no exclamation points, no marketing-speak).

## Setup

```bash
npm install
npx playwright install chromium   # rendering engine (skip if already installed)
```

## Use it

### The studio (drag & drop)

```bash
npm run studio    # → http://localhost:4747
```

Drop pictures in, pick a pillar if you care, press **Compose the Post**.
Images, caption, and files land in `output/<post-name>/`.

### The CLI

```bash
# One photo, all default formats (square, portrait, story)
node engine/cli.js create shoot/jacket-01.jpg

# A folder of photos → carousel, craft pillar, square + story only
node engine/cli.js create shoot/ --pillar craft --format square,story

# Text-only quote card
node engine/cli.js create --template quote --pillar heritage --format square

# Override any copy slot
node engine/cli.js create shoot/fitting.jpg --headline "The First Fitting" --accent "tỉ mỉ"

# Let Claude look at the photos and draft the caption (optional)
export ANTHROPIC_API_KEY=sk-ant-…   # or `ant auth login`
node engine/cli.js create shoot/ --ai --brief "spring linen capsule, quiet confidence"
```

`node engine/cli.js --help` lists everything. Discovery commands:
`templates`, `formats`, `pillars`.

### Output

```
output/<post-name>/
├── square/01-plate.png       ← post images, one folder per format
├── portrait/…
├── story/…
├── caption.txt               ← paste-ready caption
└── post.json                 ← structured manifest: copy slots, hashtags,
                                 alt text, photo analysis, image inventory
```

## How content is written

Copy comes from the **voice bank** ([`brand/voice.json`](brand/voice.json)) —
five pillars from the brand values: **Craft, Ease, Brotherhood, Intention,
Heritage**. The generator is deterministic per post name (same name → same
copy; new name → the bank rotates), and every line passes the voice linter.

With `--ai`, Claude reads the actual photos and drafts the package in brand
voice instead (model `claude-opus-4-8`; falls back to the voice bank if no
credentials or on any failure). Edit `voice.json` freely — it is the single
place the brand speaks from.

## Templates

| Template | Look | Picked automatically when |
| --- | --- | --- |
| `plate` | Walnut evening, gilt double-fillet frame, wordmark | single dark photo |
| `ledger` | Parchment morning, deco corner brackets, `№` ledger mark | single bright photo |
| `full-bleed` | Photo full canvas, vignette, selvage | `--template full-bleed` |
| `carousel` | Cover → plates → "By Nomination" close | 2+ photos |
| `quote` | Text-only editorial card | no photos |

Formats: `square` 1080×1080 · `portrait` 1080×1350 · `story` 1080×1920 ·
`landscape` 1350×1080.

## Repo map

```
brand/      brand kit — BRAND.md (rules), voice.json (copy bank), tokens.css,
            logo SVGs, self-hosted fonts, brand.config.json (formats, selvage)
engine/     cli.js · compose.js (Playwright renderer) · content.js (captions)
            voice.js (linter) · claude.js (AI captions) · templates/*.html
studio/     local drag-and-drop UI (no dependencies)
samples/    synthetic stand-in photography for demos/tests
scripts/    make-samples.js · smoke-test.js  (npm run samples / npm test)
```

## Tests

```bash
npm test    # linter rules, deterministic content, all templates render
```
