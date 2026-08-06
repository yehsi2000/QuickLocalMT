# Local Selector Translator

A Chrome extension (Manifest V3) that translates **only user-selected parts** of a web
page using a **locally hosted** LLM translation API.

- Select a container element on any page once; the extension stores a CSS-selector
  rule for that site.
- Only human-readable text nodes inside the selected element are translated.
- The original DOM structure, links, images, styles, and event handlers stay intact.
- The LLM never receives raw HTML — only plain text snippets.
- All model logic stays server-side in a local FastAPI gateway.

Initial target: Korean ↔ English (plus Japanese), using a local translation model
(such as HY-MT1.5B) served by Ollama.

## Repository layout

```text
local-selector-translator/
├─ extension/   Chrome MV3 extension (TypeScript + Vite)
├─ gateway/     FastAPI translation gateway (Python 3.12+)
├─ docs/        Architecture, development, selector-rule, and troubleshooting guides
├─ plan.md      The implementation plan this project follows
└─ README.md
```

## Quick start

### 1. Start the local model

```bash
ollama pull hy-mt:1.5b
ollama serve
```

### 2. Start the gateway

```bash
cd gateway
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Or with Docker:

```bash
cd gateway
docker compose up --build
```

Verify it is running:

```bash
curl http://127.0.0.1:8000/health
# {"status":"ok","runtime":"ollama","model":"hy-mt:1.5b"}
```

### 3. Build and load the extension

```bash
cd extension
npm install
npm run build
```

Then in Chrome:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `extension/dist` folder.

### 4. Use it

1. Open a page (for example a Korean news article).
2. Click the extension toolbar button.
3. Click **Select area**, then hover the page and click the article container.
4. Confirm the generated CSS selector, optionally **Save & translate** for the site.
5. Text blocks inside that container are translated in place; use **Restore original**
   any time to switch back.

## How it stays safe

- Text is extracted with a `TreeWalker` and sent as plain text — never `innerHTML`,
  never serialized HTML.
- Translated output is written back only through `Text.nodeValue`.
- Original text is stored per node and restored exactly.
- The service worker queues requests (default concurrency 2) and ignores stale
  results after navigation, cancellation, or restore.
- The gateway validates every model response (repetition, prompt leakage, echo of
  the source) and retries once with adjusted sampling before returning an error.
- See `docs/architecture.md` for details.

## Development

- `extension/`: `npm run build` (outputs to `extension/dist`), `npm run typecheck`,
  `npm test` (Vitest + jsdom).
- `gateway/`: `python -m pytest` from the `gateway` directory.

More in [docs/local-development.md](docs/local-development.md).

## Non-goals (v1)

- Full-page automatic translation for every website.
- OCR for text embedded in images, or PDF viewer canvases.
- Cloud API support.
- Cross-device settings sync.
- Firefox/Safari support.
