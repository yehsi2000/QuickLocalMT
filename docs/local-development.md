# Local development

## Prerequisites

- Node.js 18+ (tested with Node 22)
- Python 3.10+ (plan targets 3.12; the code is 3.10-compatible)
- Ollama with a translation model, e.g. `hy-mt:1.5b`

## Gateway

```bash
cd gateway
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Environment variables (all prefixed `LST_`):

| Variable | Default | Purpose |
| :-- | :-- | :-- |
| `LST_OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `LST_OLLAMA_MODEL` | `hy-mt:1.5b` | Model name |
| `LST_OLLAMA_KEEP_ALIVE` | `5m` | Ollama keep-alive |
| `LST_MODEL_MODE` | `generate` | `generate` or `chat` API |
| `LST_REQUEST_TIMEOUT_SECONDS` | `60` | Ollama request timeout |
| `LST_CORS_ORIGINS` | _(empty)_ | Comma-separated allowed origins |
| `LST_MAX_INPUT_CHARS` | `8000` | Max request text length |
| `LST_MAX_OUTPUT_TOKENS` | `1024` | Absolute output token cap |
| `LST_LOG_LEVEL` | `INFO` | Logging level |
| `LST_DEBUG_LOG_TEXT` | `false` | Log full request text (debug only) |

### Docker

```bash
cd gateway
docker compose up --build
```

This starts both the gateway and an Ollama container. The gateway reaches Ollama at
`http://ollama:11434`. Pull the model inside the container:

```bash
docker compose exec ollama ollama pull hy-mt:1.5b
```

### Tests

```bash
cd gateway
python -m pytest -q
```

## Extension

```bash
cd extension
npm install
npm run build      # outputs to extension/dist
npm run typecheck  # tsc --noEmit
npm test           # vitest + jsdom
```

`npm run dev` builds continuously in watch mode.

### Load into Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode** (top-right).
3. **Load unpacked** → select `extension/dist`.
4. Pin the extension and open the popup.

### Direct provider mode (no gateway)

Open **Options → Translation provider** and select one of:

- **Ollama (direct)** — the extension calls `POST {base}/api/generate` with the
  configured model. Health is checked via `GET {base}/api/tags`.
- **llama.cpp server (direct)** — the extension calls
  `POST {base}/v1/chat/completions` (OpenAI-compatible). Health is checked via
  `GET {base}/health`. Model name is optional.

In direct mode the extension builds the translation prompt, computes the output
token budget, and validates the model response (repetition, echo, length, prompt
leakage) with one retry using adjusted sampling — the same guarantees the gateway
provides. The gateway is not needed.

Host permissions cover `127.0.0.1` and `localhost` on any port, plus the local
`192.168.*` / `10.*` ranges, so a provider on a LAN machine also works.

```bash
# example: run llama.cpp server for a translation model
./llama-server -m models/qwen2.5-3b-instruct-q4_k_m.gguf \
  --host 127.0.0.1 --port 8080
```

### Local HTTPS vs HTTP

The gateway runs on `http://127.0.0.1:8000`, which is allowed by the extension's
host permissions. If you change the gateway port, update it in
**Options → Gateway base URL** (and add the origin to `LST_CORS_ORIGINS` only if
you fetch from a non-extension context).

### CORS for development

Extension service-worker fetches do not need CORS (host permissions cover them).
If you test the API from a browser page or add a content-script fetch later, start
the gateway with an explicit origin:

```bash
LST_CORS_ORIGINS="chrome-extension://<your-extension-id>,http://localhost:5173" \
  python -m uvicorn app.main:app --port 8000
```

Never use `*` in production instructions.

## End-to-end smoke test without a real model

1. Run the gateway: `python -m uvicorn app.main:app --port 8000`.
2. Verify health: `curl http://127.0.0.1:8000/health`.
3. POST a request (fails with `MODEL_UNAVAILABLE` until Ollama is running, which is
   expected and proves the error path):

```bash
curl -X POST http://127.0.0.1:8000/translate \
  -H 'Content-Type: application/json' \
  -d '{"text":"안녕하세요","source_lang":"ko","target_lang":"en"}'
```

## Manual browser test checklist

1. Static article with headings, links, lists, tables, and captions.
2. SPA page where content changes after in-app navigation.
3. Long web-novel/chapter page (chunking).
4. Page with code blocks and preformatted text (must be skipped).
5. Mixed Korean/English/Japanese text.
6. Saved selector rule re-use after refresh.
7. Gateway disconnected (popup must show an actionable error, no DOM mutation).
8. Cancel during 20+ queued blocks.
9. Mocked repetitive gateway output (must not be inserted).
