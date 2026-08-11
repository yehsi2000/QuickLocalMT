# Local Selector Translator — Implementation Plan

## 1. Goal

Build a Chrome Extension (Manifest V3) that translates only user-selected parts
of a web page using a locally hosted LLM translation API.

Primary use case:
- Browser page translation similar to Google Translate/Sider.
- The user selects a container element once.
- The extension stores a site/page rule using a CSS selector.
- Only human-readable text nodes inside that selected element are translated.
- The original DOM structure, links, images, styles, and events remain intact.
- The extension calls a local translation API running on the user's desktop/server.
- The LLM must never receive complete raw HTML.

Initial target:
- Korean <-> English translation.
- Local model: HY-MT1.5B or another dedicated translation model.
- Backend: Ollama initially, but hide it behind a custom FastAPI gateway.
- Browser: Google Chrome, Manifest V3 only.

Non-goals for v1:
- Full-page automatic translation for every website.
- OCR for text embedded in images.
- Translation of PDF viewer canvases.
- Cloud API support.
- Syncing settings across devices.
- Supporting Firefox/Safari.

---

## 2. Design Principles

1. Do not send HTML to the model.
   - Extract text nodes only.
   - Never use `innerHTML` to write translated results.
   - Restore/replace using `Text.nodeValue` only.

2. Keep prompts extremely small and deterministic.
   - The browser sends `{ sourceLang, targetLang, text }`.
   - The backend generates the model-specific prompt/template.
   - The model must return translation text only.
   - Do not ask the model to explain, summarize, preserve HTML, or discuss text.

3. Build for unreliable small LLMs.
   - Enforce output token limit.
   - Detect repetition before applying output.
   - Retry once with adjusted settings.
   - Split failing text into smaller chunks.
   - Preserve original text at all times.

4. Make site-specific setup explicit.
   - The user must select a target region or enter a CSS selector.
   - Do not attempt fragile universal article detection in v1.

5. Keep all secrets and model logic server-side.
   - The extension must not expose an Ollama API key or model-specific prompt.
   - The extension talks only to a local `/translate` gateway endpoint.

---

## 3. Architecture

```text
┌────────────────────────────────────────────────────┐
│ Chrome Extension                                    │
│                                                    │
│ popup / side panel                                 │
│  - Select area                                     │
│  - Save selector                                   │
│  - Choose language/model preset                    │
│  - Translate / restore / cancel                    │
│                                                    │
│ content script                                     │
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
│ Local Translation Gateway: FastAPI                  │
│                                                    │
│ POST /translate                                    │
│  - Validate request                                │
│  - Build translation-model prompt/template         │
│  - Call Ollama or llama.cpp endpoint               │
│  - Apply model options                             │
│  - Validate output and detect repetition           │
│  - Return normalized translation                   │
└───────────────────┬────────────────────────────────┘
                    ▼
┌────────────────────────────────────────────────────┐
│ Local Model Runtime                                │
│ Ollama initially; llama.cpp server can be added    │
│ HY-MT1.5B or dedicated translation model           │
└────────────────────────────────────────────────────┘
```

The extension must use Manifest V3 service workers, not deprecated background
pages. Register message listeners synchronously at the top level because service
workers can stop and restart at any time.

---

## 4. Repository Layout

```text
local-selector-translator/
├─ extension/
│  ├─ manifest.json
│  ├─ src/
│  │  ├─ background/
│  │  │  ├─ service-worker.ts
│  │  │  ├─ api-client.ts
│  │  │  ├─ translation-queue.ts
│  │  │  └─ settings.ts
│  │  ├─ content/
│  │  │  ├─ content-script.ts
│  │  │  ├─ element-picker.ts
│  │  │  ├─ selector-generator.ts
│  │  │  ├─ text-node-collector.ts
│  │  │  ├─ dom-translator.ts
│  │  │  └─ page-state.ts
│  │  ├─ popup/
│  │  │  ├─ popup.html
│  │  │  ├─ popup.ts
│  │  │  └─ popup.css
│  │  ├─ options/
│  │  │  ├─ options.html
│  │  │  └─ options.ts
│  │  └─ shared/
│  │     ├─ types.ts
│  │     ├─ messages.ts
│  │     ├─ validation.ts
│  │     └─ text-utils.ts
│  ├─ package.json
│  ├─ tsconfig.json
│  └─ vite.config.ts
│
├─ gateway/
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ schemas.py
│  │  ├─ settings.py
│  │  ├─ translation_service.py
│  │  ├─ model_client.py
│  │  ├─ prompt_builder.py
│  │  ├─ output_validator.py
│  │  └─ repetition_detector.py
│  ├─ tests/
│  ├─ requirements.txt
│  ├─ Dockerfile
│  └─ docker-compose.yml
│
├─ docs/
│  ├─ architecture.md
│  ├─ local-development.md
│  ├─ selector-rules.md
│  └─ troubleshooting.md
│
├─ README.md
└─ plan.md
```

Use TypeScript in the extension and Python 3.12+ with FastAPI in the gateway.

---

## 5. Extension Requirements

### 5.1 Manifest V3

Use the minimum required permissions:

```json
{
  "manifest_version": 3,
  "name": "Local Selector Translator",
  "version": "0.1.0",
  "description": "Translate selected web-page regions using a local LLM.",
  "permissions": [
    "activeTab",
    "scripting",
    "storage"
  ],
  "host_permissions": [
    "http://127.0.0.1:8000/*",
    "http://localhost:8000/*",
    "http://192.168.0.0/16/*",
    "http://10.0.0.0/8/*"
  ],
  "action": {
    "default_title": "Local Translator",
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "service-worker.js",
    "type": "module"
  }
}
```

Notes:

- Prefer `activeTab` and explicit user action over `<all_urls>` host permission.
- Use `chrome.scripting.executeScript()` to inject the content script on demand.
- Add a side panel only after the MVP works.
- Do not request broad permissions unless necessary.


### 5.2 Persistent Settings

Store these values in `chrome.storage.local`:

```ts
type ExtensionSettings = {
  gatewayBaseUrl: string;        // Default: http://127.0.0.1:8000
  defaultSourceLang: string;    // Default: auto
  defaultTargetLang: string;    // Default: en
  concurrency: number;          // Default: 2
  textChunkMaxChars: number;    // Default: 1200
  autoUseSavedRule: boolean;    // Default: false
  domainRules: DomainRule[];
};

type DomainRule = {
  id: string;
  hostname: string;
  pathPattern?: string;
  selector: string;
  excludedSelectors: string[];
  sourceLang?: string;
  targetLang?: string;
  createdAt: string;
  updatedAt: string;
};
```

The user must be able to:

- Change gateway URL.
- Set default source/target language.
- Set concurrency from 1 to 4.
- View, edit, disable, and delete saved selector rules.
- Test a CSS selector against the currently active page.

---

## 6. User Flow

### 6.1 First Use

1. User opens a page.
2. User clicks extension toolbar button.
3. Popup shows:
    - `Select translation area`
    - `Use saved rule`
    - Source language
    - Target language
    - Gateway connection status
4. User clicks `Select translation area`.
5. Content script enters picker mode.
6. Hovered DOM element gets a visible outline.
7. User clicks an article/content container.
8. Extension generates and previews a CSS selector.
9. User confirms:
    - `Translate once`
    - Optional: `Save for this site`
10. The extension extracts text nodes and translates them.
11. Popup displays progress: `12 / 38 blocks translated`.
12. User can click `Restore original` or `Cancel`.

### 6.2 Saved Rule Use

1. User opens a matching page.
2. User clicks extension.
3. The saved CSS selector is shown.
4. User clicks `Translate selected area`.
5. The extension applies it only to the selected container.

Do not auto-translate on page load in v1.

---

## 7. Text Extraction Rules

### 7.1 Allowed Nodes

Collect only `Text` nodes via `TreeWalker`.

Skip nodes whose parent or ancestor is one of:

```text
SCRIPT
STYLE
NOSCRIPT
TEMPLATE
SVG
CANVAS
CODE
PRE
KBD
SAMP
TEXTAREA
INPUT
SELECT
OPTION
BUTTON
```

Also skip:

- Empty or whitespace-only text.
- Text inside `[contenteditable="true"]`.
- Text inside elements with `aria-hidden="true"`.
- Text inside extension-owned overlay/UI.
- Elements matching configured `excludedSelectors`.
- Nodes already marked as translated.
- Nodes under hidden containers, when practical.


### 7.2 DOM Safety

Never:

- Send `outerHTML` or `innerHTML` to the server.
- Assign translated output to `innerHTML`.
- Replace an element when only a text node needs translation.
- Translate attributes in v1, including `title`, `alt`, `placeholder`, or `aria-label`.

Only mutate:

```ts
textNode.nodeValue = translatedText;
```

Store the original content before mutation:

```ts
type TranslationRecord = {
  node: Text;
  originalText: string;
  translatedText: string;
  status: "pending" | "translated" | "failed" | "skipped";
};
```

Use a `WeakMap<Text, TranslationRecord>` for in-memory page state.

### 7.3 Block Grouping

Do not request one API call per tiny text node.

Group text nodes by nearest semantic block ancestor:

```text
p, li, blockquote, figcaption, h1, h2, h3, h4, h5, h6, td, th
```

Rules:

- Keep inline nodes in the same semantic block where possible.
- Preserve node-to-fragment mapping so the translated result can be restored.
- For v1, it is acceptable to translate a whole block into the first text node
only if it does not break inline formatting; otherwise translate each text node
independently.
- Prefer correctness over aggressive grouping.

For long blocks:

- Split at paragraph/sentence boundaries.
- Maximum 1,200 characters per request by default.
- Never split surrogate pairs or Unicode grapheme clusters.
- Keep a configurable overlap only if required for context; default is no overlap.

---

## 8. CSS Selector Generation

Implement a robust but readable selector generator.

Priority:

1. Stable unique `id`, excluding obviously generated IDs.
2. Stable semantic classes.
3. Element hierarchy with `:nth-of-type()` only as fallback.
4. Validate by running `document.querySelectorAll(selector)`.

Selector acceptance:

- Prefer selectors resolving to exactly one element.
- If multiple elements match, show a warning and require confirmation.
- Do not save selectors containing known unstable patterns:
    - random long hashes
    - framework-generated attributes
    - overly deep `nth-child()` chains
- Allow manual selector editing before saving.

Examples:

- Good: `article .chapter-content`
- Acceptable fallback: `main > article:nth-of-type(1) .content`
- Avoid: `div.css-1a2b3c > div:nth-child(4) > span:nth-child(2)`

---

## 9. Message Contracts

Define strict discriminated-union message types.

```ts
type ExtensionMessage =
  | {
      type: "START_ELEMENT_PICKER";
    }
  | {
      type: "ELEMENT_SELECTED";
      selector: string;
      previewText: string;
      hostname: string;
    }
  | {
      type: "START_TRANSLATION";
      requestId: string;
      selector: string;
      sourceLang: string;
      targetLang: string;
    }
  | {
      type: "TRANSLATION_PROGRESS";
      requestId: string;
      completed: number;
      total: number;
      failed: number;
    }
  | {
      type: "TRANSLATION_COMPLETE";
      requestId: string;
      completed: number;
      failed: number;
    }
  | {
      type: "RESTORE_ORIGINAL";
    }
  | {
      type: "CANCEL_TRANSLATION";
      requestId: string;
    };
```

Use:

- `chrome.runtime.sendMessage()` for one-shot messages.
- A long-lived port only if real-time progress updates prove unreliable with
one-shot messaging.
- `AbortController` for in-flight fetch cancellation.

---

## 10. Translation Queue

Implement queueing in the service worker.

Default configuration:

- Max concurrent requests: 2.
- Maximum retries per block: 1.
- Per request timeout: 45 seconds.
- Retry delay: exponential backoff, starting at 500ms.
- Stop all remaining work when user cancels.

Queue behavior:

1. Content script extracts blocks.
2. Content script sends blocks to service worker.
3. Service worker schedules requests with concurrency limit.
4. Service worker calls gateway `/translate`.
5. Service worker returns translated text or structured error.
6. Content script applies translated text only when the response belongs to the
active request and the text node still exists.

Request ID requirements:

- Generate a UUID for each translation session.
- Ignore stale results after navigation, cancellation, restore, or new run.

---

## 11. FastAPI Gateway

### 11.1 Endpoints

```text
GET  /health
POST /translate
POST /translate/batch       # Optional after single-item endpoint is stable
GET  /models                # Return configured model presets only
```


### 11.2 `/health`

Response:

```json
{
  "status": "ok",
  "runtime": "ollama",
  "model": "configured-model-name"
}
```


### 11.3 `/translate`

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

Failure response:

```json
{
  "error": {
    "code": "REPETITIVE_OUTPUT",
    "message": "Model output contained repeated text."
  }
}
```


### 11.4 CORS

Allow only explicitly configured local development origins:

- `chrome-extension://<development-extension-id>`
- Optionally localhost during gateway testing.

Do not configure unrestricted CORS in production instructions.

### 11.5 Model Client

Create an abstraction:

```py
class ModelClient(Protocol):
    async def translate(
        self,
        prompt: str,
        options: ModelOptions
    ) -> str: ...
```

Implement:

- `OllamaClient` first.
- `LlamaCppClient` later.

The browser must not know which runtime is used.

---

## 12. Prompt and Generation Policy

Prompt construction belongs only in the gateway.

Default intent:

```text
Translate from {source_lang} to {target_lang}.

Rules:
- Return only the translation.
- Do not explain the translation.
- Do not repeat the source text.
- Do not add headings, quotes, notes, or commentary.
- Preserve line breaks when they carry meaning.

Text:
{input_text}
```

Important:

- Replace this generic prompt with the translation model's official recommended
prompt/chat template if the selected model requires one.
- Do not include raw HTML.
- Do not add large system prompts.
- Do not use chain-of-thought prompts.
- Do not include few-shot examples in v1.

Initial generation values:

```json
{
  "temperature": 0.1,
  "top_p": 0.9,
  "top_k": 40,
  "repeat_penalty": 1.08,
  "repeat_last_n": 96,
  "num_ctx": 2048
}
```

Output length policy:

- Calculate a conservative maximum output budget from input length.
- Start at approximately 1.6 times source token count.
- Apply absolute cap of 1,024 output tokens for v1.
- For short text, use a small cap such as 128 tokens.

Do not blindly set a huge `num_predict`; excessive output budget allows the model
to continue generating after translation has completed, often producing repeated
sentences.

---

## 13. Repetition and Quality Validation

Implement server-side output validation before returning text.

Reject or retry when:

1. Output is empty after trimming.
2. Output is nearly identical to source text when source and target language differ.
3. The same normalized sentence appears consecutively two or more times.
4. Any normalized 8-gram appears three or more times.
5. Output exceeds 3 times the source character count without an explicit reason.
6. Output includes known prompt leakage:
    - `Translate`
    - `Translation:`
    - `<text>`
    - `assistant`
    - model chat boundary markers

Normalization for repetition check:

- Unicode normalize with NFKC.
- Collapse repeated whitespace.
- Lowercase for languages where it is appropriate.
- Remove surrounding punctuation only for comparison, not display.

Retry policy:

1. First request: default settings.
2. On repeat failure:
    - reduce max output token cap
    - use `temperature: 0.15`
    - use `repeat_penalty: 1.12`
3. If retry fails:
    - return structured error
    - let browser optionally split the source block into smaller units
4. Never silently apply a known repetitive result.

Implement unit tests for:

- repeated complete sentence
- repeated phrase
- legitimate short repeated text
- source equals target due to names/code
- Korean and English punctuation edge cases

---

## 14. UI Requirements

### 14.1 Popup MVP

Show:

- Current gateway status: connected / unavailable
- Source language select: auto, ko, en, ja
- Target language select: ko, en, ja
- Button: `Select area`
- Button: `Translate saved area`
- Button: `Restore original`
- Button: `Cancel`
- Progress text
- Link: `Settings`

Disable translate actions when:

- gateway health check fails
- no target area exists
- translation is already running


### 14.2 Element Picker

When active:

- Use a non-invasive overlay/highlight.
- On hover, draw a border around the candidate element.
- Display tag name, classes, and a short selector preview.
- Escape cancels picker mode.
- Click selects the highlighted element.
- Ignore the extension's own overlay nodes.
- Do not block page interaction except while picker mode is active.


### 14.3 Translation Display

For v1:

- Replace displayed text in place.
- Add a lightweight translated marker class to nearest safe parent block.
- Provide global restore button.

Optional v2:

- Toggle original/translated per block.
- Show original on hover.
- Add a side panel job history.

---

## 15. Error Handling

Handle these cases explicitly:


| Case | Expected behavior |
| :-- | :-- |
| Gateway unavailable | Show actionable connection error; do not mutate DOM |
| Model timeout | Mark block failed; allow retry |
| User cancels | Abort queued and active requests; do not apply late responses |
| Page navigation | Discard session state |
| Selector matches no element | Show selector error |
| Selector matches multiple elements | Ask user to confirm or refine selector |
| Dynamic page replaces DOM | Skip detached nodes safely; report partial completion |
| Repetitive output | Retry once, then leave source unchanged |
| Invalid model response | Leave source unchanged and show error |
| Source too long | Split into smaller sentence-aware chunks |

Never let one failed text block stop the whole page job.

---

## 16. Testing Plan

### 16.1 Extension Unit Tests

Test:

- selector generation
- selector validation
- skipped tag filtering
- text-node collection
- chunk splitting
- original-text restoration
- stale request rejection
- message schemas
- queue concurrency and cancellation

Use a DOM test environment such as jsdom where practical.

### 16.2 Gateway Unit Tests

Test:

- request validation
- prompt generation
- Ollama client mock
- output cleanup
- repetition detection
- retry policy
- token/output limit calculation


### 16.3 Manual Browser Tests

Test against:

1. Static article page with headings, links, lists, tables, and captions.
2. SPA page where content changes after navigation.
3. Long web novel/chapter page.
4. Page with code blocks and preformatted text.
5. Page with Korean, English, Japanese mixed text.
6. Page with a saved selector rule.
7. Gateway disconnected state.
8. Cancellation during 20+ queued blocks.
9. Repeated-output test using mocked gateway response.

Success criteria:

- No raw HTML is sent to the gateway.
- No page markup breaks after translation.
- Links and inline formatting remain functional.
- Restore returns every changed text node to original value.
- A single failed block does not halt remaining blocks.
- Repetitive model output never gets silently inserted.

---

## 17. Development Milestones

### Milestone 1 — Gateway Skeleton

Deliver:

- FastAPI project.
- `/health` endpoint.
- `/translate` endpoint.
- Ollama client integration.
- Fixed test input and output.
- Docker Compose instructions.
- Basic tests.

Acceptance:

- `curl` to `/translate` returns translation-only text.
- Gateway rejects invalid requests.
- Gateway does not expose model internals to the browser.


### Milestone 2 — Extension Injection and Picker

Deliver:

- MV3 extension setup with TypeScript build.
- Popup.
- `activeTab` script injection.
- Element picker overlay.
- CSS selector preview and copy.
- Basic selector save/load.

Acceptance:

- User can select one element on a page.
- The selector finds the same element after page refresh when stable.


### Milestone 3 — Safe Text Replacement

Deliver:

- TreeWalker text-node collector.
- Exclusion rules.
- Original-text WeakMap storage.
- Translate/restore buttons.
- Mock translation service initially.

Acceptance:

- Text changes without breaking links, emphasis, lists, or page layout.
- Restore works exactly.


### Milestone 4 — Real Translation Queue

Deliver:

- Service worker API client.
- Configurable local gateway URL.
- Queue with concurrency=2.
- Progress updates.
- Timeout/cancel behavior.

Acceptance:

- 20 text blocks translate with no more than 2 concurrent API calls.
- Cancel prevents late updates from applying.


### Milestone 5 — Reliability Layer

Deliver:

- Repetition detector.
- Output-length guard.
- One retry policy.
- Sentence-aware fallback split.
- Per-block error reporting.

Acceptance:

- Mock repeated response is rejected.
- Valid translation still passes.
- Failed blocks retain original text.


### Milestone 6 — Documentation and Packaging

Deliver:

- README with setup.
- Load-unpacked Chrome instructions.
- Gateway Docker setup.
- Troubleshooting guide for CORS, Ollama, model speed, and selectors.
- Example domain rules.
- Build scripts.

Acceptance:

- A new developer can run the gateway and load the extension locally from docs.

---

## 18. Implementation Constraints

- Use no cloud service by default.
- Do not use external analytics or telemetry.
- Do not transmit browser page text anywhere except configured local gateway.
- Do not use `eval`, remote code loading, or inline scripts.
- Follow Chrome MV3 Content Security Policy constraints.
- Keep extension dependencies minimal.
- Use structured logging in the gateway, but never log full document text by default.
- Redact text from error logs unless debug mode is explicitly enabled.
- Keep model selection configurable on gateway side.
- Write clear error messages in Korean and English where easy.

---

## 19. Nice-to-Have After MVP

- Chrome Side Panel with detailed progress and selector management.
- Translation memory cache keyed by SHA-256 of source text + language pair + model.
- IndexedDB cache for persistent page translation results.
- Glossary support with per-domain terminology.
- MutationObserver mode for newly loaded content.
- Subtitle-style dual-language display rather than replacement.
- Optional HTML attribute translation.
- Batch endpoint to reduce HTTP overhead.
- Translation quality router: use fast 1.5B model first, fallback to larger model only
when output validation fails.
- Per-site custom pre/post-processing rules.
- Export/import selector rules and glossary as JSON.

