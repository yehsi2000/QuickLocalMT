# Troubleshooting

## Gateway

### Popup shows "Gateway offline"

- Confirm the gateway is running: `curl http://127.0.0.1:8000/health`.
- Confirm Ollama is running: `curl http://127.0.0.1:11434/api/tags`.
- Check the gateway port matches the **Gateway base URL** in the extension Options.
- Check the extension was reloaded after installing (service workers and host
  permissions apply on reload).

### `/translate` returns `MODEL_UNAVAILABLE`

- Ollama is not reachable at `LST_OLLAMA_BASE_URL` (default `http://127.0.0.1:11434`).
- The model name in `LST_OLLAMA_MODEL` is wrong or not pulled yet:
  `ollama list` to check, `ollama pull hy-mt:1.5b` to fetch.
- When running inside Docker, the gateway must use `http://ollama:11434`, not
  `127.0.0.1` (the compose file sets this automatically).

### Translation fails with `REPEATED_SENTENCE` / `REPEATED_NGRAM`

- The model is producing repetitive output. The gateway already retried once with
  adjusted sampling (`temperature 0.15`, `repeat_penalty 1.12`).
- Try a dedicated translation model; general-purpose chat models repeat more.
- Check that `LST_MAX_OUTPUT_TOKENS` is not set too high for your model.
- If the source text contains legitimately repeated content, split it manually into
  smaller blocks.

### `ECHOED_SOURCE` errors

- The model returned the source text unchanged. Common with small models that are
  not fine-tuned for translation.
- Names, numbers, and code identifiers are exempt from this check and will pass.

### Slow translations

- The default concurrency is 2. Raise it to 3–4 in Options if your GPU/server can
  handle it.
- Small text nodes create more requests. Long paragraphs are grouped; if your page
  has many tiny inline spans, expect more requests.
- Check whether Ollama is running on CPU (much slower than GPU).

### CORS errors

- Service-worker fetches do not need CORS (host permissions cover the gateway).
- If you see CORS errors from a non-extension origin, restart the gateway with an
  explicit origin list:
  `LST_CORS_ORIGINS="chrome-extension://<id>" python -m uvicorn app.main:app --port 8000`.
- Do not enable `*` in production.

## Extension

### "Cannot access the page" when testing a selector

- Active-tab access requires a user gesture. Open the popup once and click
  **Select area**, then retry the test from Options.
- `chrome://` pages, the Chrome Web Store, and PDF viewers cannot be scripted.

### Saved selector matches nothing

- The page structure changed; regenerate the selector with **Select area**.
- Check the rule's `pathPattern` matches the current URL.
- The rule may target a different hostname (subdomain differences matter).

### Selector matches multiple elements

- The popup/confirm UI warns when a selector matches more than one element.
- Edit the selector manually (add `:nth-of-type(...)` or a parent class) before
  translating.

### Nothing translates / "No translatable text found"

- The selected container may contain only non-text content (images, videos).
- Code, preformatted text, buttons, inputs, `aria-hidden`, and
  `contenteditable` subtrees are intentionally skipped.
- Excluded selectors on the saved rule may be hiding the content.

### Text was translated but a block is missing

- A single failed block never blocks the rest of the page; failed blocks keep their
  original text and the progress UI reports them.
- SPA navigation can replace the DOM; re-run the translation for the new view.

### Restore does not bring everything back

- Restore only affects text changed by this extension within the current page
  session. Reload the page to start a fresh session if needed.
- If a script on the page modified the same text nodes, restore may conflict;
  reload the page.

### Extension was reloaded mid-session

- Reloading the extension kills the service worker state. Re-open the popup and
  re-run translation; `Restore original` still works because the content script
  keeps per-page state until navigation.

## Model quality

### The model ignores the translation instruction

- Prefer a model fine-tuned for translation (e.g. HY-MT1.5B). Chat models often
  answer instead of translating.
- The gateway prompt is minimal and deterministic; the model's own recommended
  template can replace it in `prompt_builder.py` if your model needs one.

### Output contains the source text plus translation

- The validation layer rejects echo+translation combos only when they are identical
  to the source. Heavily mixed output should be rare; retry usually fixes it.
- Consider a larger model if small models keep failing validation.
