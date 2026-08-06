# Architecture

This document describes the runtime architecture of the Local Selector Translator.

## Component diagram

```text
┌────────────────────────────────────────────────────┐
│ Chrome Extension (MV3)                             │
│                                                    │
│ popup / options                                    │
│  - Select area                                     │
│  - Save selector                                   │
│  - Choose language/model preset                    │
│  - Translate / restore / cancel                    │
│                                                    │
│ content script (injected on demand)                │
│  - Element picking overlay                         │
│  - CSS selector generation                         │
│  - DOM text-node extraction                        │
│  - Safe text replacement                           │
│  - Per-page translation state                      │
│                                                    │
│ service worker                                     │
│  - Settings via chrome.storage                     │
│  - Request queue and concurrency limit             │
│  - Fetch local API                                 │
│  - Retry/error policy                              │
└───────────────────┬────────────────────────────────┘
                    │ HTTP JSON
                    ▼
┌────────────────────────────────────────────────────┐
│ Local Translation Gateway: FastAPI                 │
│                                                    │
│ POST /translate                                    │
│  - Validate request                                │
│  - Build model-specific prompt                     │
│  - Call Ollama endpoint                            │
│  - Apply model options                             │
│  - Validate output and detect repetition           │
│  - Return normalized translation                   │
└───────────────────┬────────────────────────────────┘
                    ▼
┌────────────────────────────────────────────────────┐
│ Local Model Runtime                                │
│ Ollama (llama.cpp server can be added later)       │
│ HY-MT1.5B or a dedicated translation model         │
└────────────────────────────────────────────────────┘
```

## Extension

### Permissions (minimum)

- `activeTab` — access to the currently active tab after a user gesture (toolbar click).
- `scripting` — `chrome.scripting.executeScript()` injects the content script on demand.
- `storage` — persistent settings and saved selector rules.
- Host permissions are limited to the local gateway address ranges
  (`127.0.0.1`, `localhost:8000`, `192.168.*`, `10.*`). No `<all_urls>`.

### Message flow

All messaging uses `chrome.runtime.sendMessage` / `chrome.tabs.sendMessage` with the
discriminated union defined in `extension/src/shared/messages.ts`.

| Step | Actor | Message |
| :-- | :-- | :-- |
| Start picking | popup → background | `START_PICKER` |
| Pick element | background → content | `START_ELEMENT_PICKER` |
| Element chosen | content → background | `ELEMENT_SELECTED` |
| Save rule | content → background | `SAVE_RULE` |
| Start session | content/popup → background | `TRANSLATE_SELECTOR` |
| Run session | background → content | `START_TRANSLATION` |
| Send blocks | content → background | `TRANSLATE_BLOCKS` |
| Per-block result | background → content | `TRANSLATION_RESULT` |
| Progress | content → background → popup | `TRANSLATION_PROGRESS` |
| Done | content → background → popup | `TRANSLATION_COMPLETE` |
| Restore | popup → background → content | `RESTORE` / `RESTORE_ORIGINAL` |
| Cancel | popup → background → content | `CANCEL` / `CANCEL_TRANSLATION` |

### Translation session lifecycle

1. The content script extracts text blocks (see below) and sends them to the
   service worker via `TRANSLATE_BLOCKS`.
2. The service worker runs a `TranslationQueue` (default concurrency 2,
   45 s timeout, one retry with 500 ms exponential backoff).
3. Each block is POSTed to the gateway `/translate` endpoint.
4. Results are delivered back to the content script as `TRANSLATION_RESULT` and are
   applied **only if** the `requestId` still matches the active session and the text
   node still exists in the DOM.
5. A `requestId` (UUID) is created per session. Navigation, cancellation, restore,
   or a new run invalidates the previous session so late responses are ignored.

### Text extraction rules

Collected with a `TreeWalker` over `Text` nodes only. Skipped:

- `SCRIPT`, `STYLE`, `NOSCRIPT`, `TEMPLATE`, `SVG`, `CANVAS`, `CODE`, `PRE`, `KBD`,
  `SAMP`, `TEXTAREA`, `INPUT`, `SELECT`, `OPTION`, `BUTTON`
- whitespace-only text, `[contenteditable="true"]`, `[aria-hidden="true"]`
- extension-owned overlay/UI nodes, elements matching `excludedSelectors`
- nodes already marked as translated, hidden containers (when practical)

Text nodes are grouped by their nearest semantic block ancestor
(`p`, `li`, `blockquote`, `figcaption`, `h1`–`h6`, `td`, `th`). Blocks with nested
inline formatting (e.g. `<p>Hello <strong>world</strong>!</p>`) are translated per
text node to preserve formatting; a block whose text nodes are all direct children
can be translated as one unit. Long blocks are split at sentence boundaries with a
default 1200-character request budget, never splitting surrogate pairs or grapheme
clusters.

### DOM safety

- Only `textNode.nodeValue = translatedText` is ever written.
- Originals are kept in a `WeakMap<Text, TranslationRecord>` (`page-state.ts`).
- `Restore original` writes every recorded original value back.
- The extension never sends `outerHTML`/`innerHTML` to the gateway and never assigns
  translated output to `innerHTML`.

### Selector generation

`selector-generator.ts` prefers:

1. A stable unique `id` (generated-looking ids such as `a1b2c3d4e5f6g7h8` are ignored).
2. Stable semantic classes (framework-generated classes like `css-1a2b3c` are filtered).
3. Element hierarchy with `:nth-of-type()` as a fallback.

Generated selectors are validated with `document.querySelectorAll`; selectors
resolving to more than one element trigger a warning in the confirm UI. Selectors
containing unstable patterns (`:nth-child`, long hashes, framework attribute
selectors) are flagged before saving.

## Gateway

### Endpoints

| Endpoint | Purpose |
| :-- | :-- |
| `GET /health` | Lightweight liveness check (`{status, runtime, model}`) |
| `POST /translate` | Translate one plain-text chunk |
| `GET /models` | Return configured model presets (for future UI) |

### `/translate` contract

Request:

```json
{
  "text": "번역할 순수 텍스트",
  "source_lang": "ko",
  "target_lang": "en",
  "preset": "translation-default"
}
```

Response:

```json
{
  "translation": "Text translation only.",
  "detected_source_lang": "ko",
  "model": "configured-model-name",
  "attempts": 1,
  "warnings": []
}
```

Failure:

```json
{
  "error": {
    "code": "REPETITIVE_OUTPUT",
    "message": "Model output contained repeated text."
  }
}
```

### Module map

| Module | Responsibility |
| :-- | :-- |
| `schemas.py` | Request/response validation (pydantic) |
| `settings.py` | Environment configuration (`LST_*` prefix) |
| `prompt_builder.py` | Deterministic translation prompt |
| `model_client.py` | `ModelClient` protocol + `OllamaClient` |
| `translation_service.py` | Orchestration, retry policy, token budget |
| `output_validator.py` | Validation gate + output cleanup |
| `repetition_detector.py` | Repetition/echo/leakage heuristics |
| `main.py` | FastAPI app, CORS, error mapping |

### Generation policy

- Default sampling: `temperature 0.1`, `top_p 0.9`, `top_k 40`,
  `repeat_penalty 1.08`, `repeat_last_n 96`, `num_ctx 2048`.
- Output budget is derived from the input (`~1.6 × source tokens`), floored at
  128 tokens and capped at 1024, so the model does not ramble after finishing.
- On validation failure the gateway retries once with `temperature 0.15`,
  `repeat_penalty 1.12`, and a reduced output cap. It never applies a known
  repetitive result.

### Validation rules

Rejected output (retry once, then structured error):

1. empty after trimming
2. nearly identical to the source when source/target languages differ
   (names, numbers, and code identifiers are exempt)
3. a normalized sentence repeated consecutively 2+ times
4. a normalized 8-gram appearing 3+ times
5. output more than 3× the source length
6. prompt leakage (`Translate …`, `Translation:`, `<text>`, chat markers)

### Security notes

- The extension sends browser text only to the configured provider: the local
  gateway, or the directly configured Ollama / llama.cpp endpoint.
- Direct provider mode performs prompt building and output validation in the
  extension (`src/shared/prompt.ts`, `src/shared/output-guard.ts`). The gateway
  mode keeps all of that server-side and remains the recommended setup.
- No cloud services, no analytics, no telemetry.
- No `eval`, remote code, or inline scripts (MV3 CSP).
- Gateway logs never include full document text unless `LST_DEBUG_LOG_TEXT=true`.
- CORS is only enabled for explicitly configured origins
  (e.g. `chrome-extension://<id>` during development).

## Direct providers (no gateway)

`ExtensionSettings.provider` selects the translation backend:

| Provider | Endpoint used | Health check |
| :-- | :-- | :-- |
| `gateway` | `POST {gatewayBaseUrl}/translate` | `GET {gatewayBaseUrl}/health` |
| `ollama` | `POST {ollamaBaseUrl}/api/generate` | `GET {ollamaBaseUrl}/api/tags` |
| `llamacpp` | `POST {llamacppBaseUrl}/v1/chat/completions` | `GET {llamacppBaseUrl}/health` |

For direct providers the service worker (`api-client.ts`) builds the translation
prompt, computes a conservative `num_predict` budget, and validates each response
with `output-guard.ts`, retrying once with adjusted sampling before reporting a
block error. The manifest host permissions cover `127.0.0.1`/`localhost` on any
port and the local `192.168.*` / `10.*` ranges.
