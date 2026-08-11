# Site-Scoped Glossary — Implementation Plan

> Replaces the original v1 implementation plan, which is preserved at
> `plan-v1.md`. This plan is self-contained: another agent (e.g. a
> mobile-linked session) should be able to execute it end-to-end without
> asking the user questions.

## 1. Background & Context

- Project: Chrome MV3 extension + local translation runtime. The extension
  saves per-site CSS-selector rules, extracts text nodes inside the selected
  area, and translates them via a local model.
- Model: **HY-MT1.5-1.8B** (Tencent Hunyuan translation model; Ollama tag
  `hy-mt:1.5b`). Runs on a PC with **8 GB VRAM**; translation speed is a
  hard requirement (real-time page translation), so we keep the small model.
- **Primary translation direction: Japanese -> Korean (ja -> ko).**
  English <-> Korean still supported by the existing lang codes
  (`auto | ko | en | ja`), no language-code changes needed.
- Goal: per-site **glossary / terminology** translation (e.g. a game or
  novel site where `冒険者` must always become `모험가`).

### Key decision (already made, do not reverse)

Use the model's **native terminology-intervention feature** (prompt-based
glossary) plus a deterministic post-replacement safety net.

**No fine-tuning / LoRA at this stage.** Rationale:

- HY-MT1.5-1.8B was *trained* with terminology-in-prompt ("terminology
  intervention" is a documented, first-class feature of the model, shared
  by both the 1.8B and 7B variants). Throwing a glossary at it is exactly
  what it is built for.
- For a handful of sites with a few dozen terms each, prompt + post-edit
  fully covers the need; LoRA would be over-engineering and risks degrading
  the model's translation quality (catastrophic forgetting with small data).
- We still lay the groundwork for a future LoRA by **logging
  source/translation pairs** (see §9). LoRA only becomes relevant once
  >= ~1000 logged pairs per site exist *and* prompt+post-replace has been
  proven insufficient (e.g. site-specific style/format, not just terms).

References: https://github.com/Tencent-Hunyuan/HY-MT ,
https://huggingface.co/tencent/HY-MT1.5-1.8B (official terminology prompt
template quoted in §7).

## 2. Non-Goals (v1)

- Fine-tuning / LoRA (deferred, see §12).
- Global (non-site) glossary; per-site rules only.
- Direction-aware glossary pairs (separate ja->ko vs ko->ja mappings in the
  same rule). One mapping per rule; entries are written for the user's
  usual direction. Noted as a limitation in the options UI copy.
- Cloud sync of glossaries.
- Glossary term auto-suggestion / mining from logs.

## 3. Architecture Overview

### 3.1 Two translation paths — CRITICAL

There are **two independent code paths** that build prompts and validate
output. BOTH must be updated identically or the feature will silently not
work in one configuration:

| Path | When used | Prompt built by | Post-replace by | Pair logging by |
|---|---|---|---|---|
| A. Gateway | `provider: "gateway"` | `gateway/app/prompt_builder.py` | `gateway/app/glossary.py` | gateway JSONL file |
| B. Direct | `provider: "ollama"` \| `"llamacpp"` | `extension/src/shared/prompt.ts` | `extension/src/shared/glossary.ts` | extension storage buffer |

The user's main setup is **Path B (direct llama.cpp)**, so Path B must be
fully functional on its own — do not ship Path A-only.

### 3.2 Data flow

```text
chrome.storage.local
  DomainRule { hostname, selector, ..., glossary: [{source, target}] }
        │  (edited in options page)
        ▼
service-worker: TRANSLATE_BLOCKS handler
  rules = findRulesForUrl(settings.domainRules, tab.url)
  mergedGlossary = mergeGlossaries(rules)   // dedupe by source, cap 50
        │
        ▼
queue translate closure ──► GatewayTranslateRequest { text, langs, glossary }
        │
        ▼
prompt builder (gateway OR extension)        prompt = renderGlossaryBlock(...) + instruction + text
        │  (stable order → KV-cache reuse)
        ▼
model (Ollama / llama.cpp) ──► raw output ──► clean + validate ──►
        applyGlossaryReplacement(output, glossary)   // safety net
        ▼
translated text ──► DOM
        │
        ▼
pair logging (gateway JSONL AND/OR extension storage buffer)
```

## 4. Design Decisions

- **D1. Glossary lives on `DomainRule`** (site-scoped, matching how the
  user thinks about sites). Entry: `GlossaryEntry { source: string, target:
  string }`. Max **50 entries per rule** — enforced in extension sanitize,
  gateway schema validation, and prompt rendering (truncation guard).
- **D2. Glossary block is always the prompt prefix, in stable sorted
  order** (sort by `source`, byte order). Every request for the same site
  then has an identical prefix → llama.cpp prompt/KV cache and Ollama cache
  (keep_alive already `5m`) reuse the prefix for free. This is what keeps
  speed acceptable on the 8 GB box.
- **D3. Prompt template** = HY-MT official terminology format, English
  adaptation (verbatim in §7). Run the A/B check in §10.6 and record the
  winner in `docs/architecture.md`.
- **D4. Safety-net post-replacement**: after the raw output passes
  validation, replace any *source* term still present in the output with
  its *target* term (longest-first, case-insensitive for ASCII, no word
  boundaries for Japanese — Japanese text has no spaces). Deterministic
  and cheap; LLMs alone cannot guarantee terminology consistency.
- **D5. num_ctx 2048 → 4096** in both paths (gateway
  `DEFAULT_OPTIONS`/`RETRY_OPTIONS`, extension
  `DEFAULT_GENERATION_OPTIONS`/`RETRY_GENERATION_OPTIONS`) so the glossary
  prefix + up-to-1200-char text fit comfortably. 1.8B Q4 KV cache at 4096
  ctx is well within 8 GB.
- **D6. Pair logging in both paths** (§9): gateway appends JSONL; extension
  buffers history in `chrome.storage.local` (capped, exportable) so Path B
  usage is captured too. This is the future LoRA dataset.

## 5. API Contract Changes

### 5.1 `DomainRule` (extension storage)

```ts
type GlossaryEntry = { source: string; target: string };

type DomainRule = {
  // ...existing fields unchanged...
  glossary?: GlossaryEntry[];   // new, optional; absent/undefined == []
};
```

### 5.2 Translate request (both TS and Pydantic)

```json
{
  "text": "...",
  "source_lang": "ja",
  "target_lang": "ko",
  "preset": "translation-default",
  "glossary": [
    { "source": "冒険者", "target": "모험가" },
    { "source": "魔法使い", "target": "마법사" }
  ]
}
```

- `glossary` optional; max 50 entries; each `source`/`target` trimmed,
  1..200 chars, non-blank; reject (422) otherwise. Response schema
  **unchanged**.

## 6. Implementation Steps (file-by-file)

### Phase 1 — Gateway (Path A)

1. **`gateway/app/schemas.py`**
   - Add `class GlossaryEntry(BaseModel)` with `source`/`target`:
     `str = Field(..., min_length=1, max_length=200)` + strip validator.
   - Add `glossary: list[GlossaryEntry] = []` to `TranslateRequest` with a
     validator capping at 50 entries (raise `ValueError` → 422).
2. **`gateway/app/glossary.py`** (new module, pure functions, no I/O)
   - `sort_glossary(glossary) -> list[GlossaryEntry]` — stable sort by
     `source` (byte/UTF-8 order via Python `sorted` on the string).
   - `render_glossary_block(glossary, max_chars=4000) -> str` — renders the
     §7 block; adds entries in sorted order while rendered length <
     `max_chars`; drops tail entries (never truncates a mid-way entry).
   - `apply_glossary_replacement(output: str, glossary) -> str` — algorithm
     in §8.
3. **`gateway/app/prompt_builder.py`**
   - `build_translation_prompt(text, source_lang, target_lang, glossary=None)`
   - Empty/None glossary → output identical to today's prompt (backward
     compat, existing tests must still pass).
   - With glossary → `render_glossary_block(...) + "\n" + instruction block`.
     Instruction tail = English adaptation in §7 (same as current
     `PROMPT_TEMPLATE` tail, keep the "Rules:" list).
4. **`gateway/app/translation_service.py`**
   - `translate(..., glossary: list | None = None)`; pass to prompt builder.
   - After `validate_translation` succeeds: `cleaned =
     apply_glossary_replacement(cleaned, glossary)` before returning.
   - Log the pair (§9) on success; never raise on log failure (log + continue).
5. **`gateway/app/settings.py`**
   - `translation_log_enabled: bool = True`
   - `translation_log_path: str = "data/translation_log.jsonl"`
6. **`gateway/app/main.py`** — pass `payload.glossary` into
   `current_service.translate(...)`.
7. **`gateway/.gitignore`** — add `data/`.

### Phase 2 — Extension shared (Path B primitives)

1. **`extension/src/shared/types.ts`**
   - Add `GlossaryEntry`; `DomainRule.glossary?: GlossaryEntry[]`;
     `GatewayTranslateRequest.glossary?: GlossaryEntry[]`.
2. **`extension/src/shared/validation.ts`**
   - `isGlossaryEntry(value): value is GlossaryEntry`
   - `normalizeGlossary(value): GlossaryEntry[]` — filter invalid, trim,
     dedupe by `source` (first wins), cap 50.
3. **`extension/src/shared/prompt.ts`**
   - `buildTranslationPrompt(text, sourceLang, targetLang, glossary: GlossaryEntry[] = [])`
   - Same template + ordering + truncation guard as the gateway version.
   - Bump `num_ctx` 2048 → 4096 in `DEFAULT_GENERATION_OPTIONS` /
     `RETRY_GENERATION_OPTIONS`.
4. **`extension/src/shared/glossary.ts`** (new)
   - Mirror of `gateway/app/glossary.py`: `sortGlossary`,
     `renderGlossaryBlock`, `applyGlossaryReplacement`. Keep the two
     implementations byte-compatible (shared test vectors in §10).

### Phase 3 — Extension wiring (Path B)

1. **`extension/src/background/settings.ts`**
   - `sanitizeRule`: add `glossary: normalizeGlossary(value.glossary)`.
     Old stored rules without the field sanitize to `[]` — no migration.
   - `DEFAULT_SETTINGS` unchanged (rules start with no glossary).
2. **`extension/src/background/history.ts`** (new)
   - Storage key `translationHistory`, array capped at **2000** entries
     (drop oldest). Entry shape in §9.
   - `addHistoryEntry(entry)`, `getHistory()`, `clearHistory()`,
     `exportHistoryJsonl(): string`.
3. **`extension/src/background/service-worker.ts`**
   - In the `TRANSLATE_BLOCKS` handler (has `sender.tab`): compute
     `rules = findRulesForUrl(settings.domainRules, sender.tab.url ?? '')`,
     `mergedGlossary = normalizeGlossary(rules.flatMap(r => r.glossary ?? []))`
     (dedupe by source, first rule wins, cap 50).
   - `queueForTab(tabId, settings, glossary, hostname)`: extend the queue's
     `translate` closure to include `glossary` in the request, and after a
     successful result fire-and-forget
     `addHistoryEntry({ ts, hostname, source_lang, target_lang, source_text, translation })`
     (never block translation on history writes; `.catch(() => {})`).
4. **`extension/src/background/api-client.ts`**
   - `translateWithValidation`: build prompt with `request.glossary`;
     after validation passes, `cleaned = applyGlossaryReplacement(cleaned,
     request.glossary)` (this covers direct Ollama and llama.cpp).
   - `translateChunk`: gateway branch unchanged — the gateway performs its
     own replacement; do NOT double-replace (harmless but wasteful).

### Phase 4 — Options UI

1. **`extension/src/options/options.ts`** (+ `.html`, `.css` as needed)
   - Per-rule **glossary editor**: a `<textarea>` where each line is
     `term -> term` (also accept `term → term`; `#`-prefixed lines are
     comments). Parse + validate with `normalizeGlossary`; show live
     "N terms" count and per-line errors; save via
     `updateDomainRule(id, { glossary })`.
   - UI copy notes the mapping is for the rule's translation direction.
   - **History section**: "Export history (JSONL)" button (Blob download)
     and "Clear history" button wired to `history.ts`.

### Phase 5 — Tests & Docs

Gateway (pytest, `cd gateway && python -m pytest`):

- `tests/test_prompt_builder.py` — extend: glossary block rendered with
  stable order; empty glossary == old prompt exactly; truncation guard.
- `tests/test_glossary.py` (new) — §8 vectors: longest-first, ASCII
  word-boundary, Japanese substring, case-insensitivity, no-op empty.
- `tests/test_schemas.py` — glossary: >50 entries → 422, blank source →
  422, valid ok, absent ok.
- `tests/test_translation_service.py` — glossary flows into prompt and
  post-replacement applied (mock client); success pair written to JSONL
  (`tmp_path` + settings override).

Extension (vitest, `cd extension && npm test`):

- `tests/prompt.test.ts` — extend: glossary block, stable order, empty
  unchanged.
- `tests/glossary.test.ts` (new) — same vectors as gateway
  `test_glossary.py` (share fixtures where practical).
- `tests/api-client.test.ts` — extend: request carries glossary; direct
  path applies replacement; gateway path does not double-replace.

Docs:

- `README.md` — glossary usage, new env vars, history export.
- `docs/architecture.md` — terminology-intervention design, A/B result.

## 7. Prompt Templates (verbatim)

Official HY-MT1.5 terminology template (Chinese, for reference):

```text
参考下面的翻译：
{source_term} 翻译成 {target_term}

将以下文本翻译为{target_language}，注意只需要输出翻译后的结果，不要额外解释：
{source_text}
```

**English adaptation (v1 default, used in BOTH prompt builders):**

```text
Refer to the following translations:
{source} -> {target}

Translate the following text into {target_lang}. Only output the translated
result, without any additional explanation:

{source_text}
```

- The glossary block is rendered first (stable order, §D2), then the
  instruction tail. The tail must stay identical to today's prompt when
  glossary is empty (backward compat).
- Do not add chat-format wrapping beyond what the current code does
  (raw prompt for Ollama generate / user message for llama.cpp chat).
- ja->ko example: `冒険者 -> 모험가`, `魔法使い -> 마법사`,
  `異世界 -> 이세계`.

## 8. Post-Replacement Algorithm

Purpose: safety net — the model occasionally leaves a source term
untranslated or renders it inconsistently; replace deterministically.

```text
1. If glossary empty -> return output unchanged.
2. Sort entries by len(source) DESCENDING (longest first).
3. For each entry:
     pattern source:
       - if source is pure ASCII (A-Za-z0-9_): regex with word
         boundaries: \b(escaped)\b, re.IGNORECASE
       - else (contains Japanese/Korean/CJK): re.escape(source), no
         word boundaries (Japanese has no spaces), re.IGNORECASE
         (no-op for kana/kanji, harmless)
     output = pattern.sub(target, output)
4. Return output.
```

Key tests (add to both gateway and extension test suites):

- Longest-first: `魔法使い` must win over a hypothetical shorter overlap.
- ASCII boundary: "Sword" must not replace inside "Swordfish".
- Japanese substring: `冒険者` inside `冒険者の剣` → `모험가의 검`.
- Case: "sword" -> "검" matches "Sword" in output.
- Idempotence: applying twice equals applying once (source terms are gone
  after the first pass; target terms never re-matched because we match
  source, not target).

## 9. Logging Schema (future LoRA dataset)

Gateway JSONL (one object per line, append-only):

```json
{"ts":"2026-08-10T18:00:00.000Z","source_lang":"ja","target_lang":"ko","source_text":"...","translation":"...","model":"hy-mt:1.5b","attempts":1,"warnings":[],"glossary_count":5}
```

- Appended on every successful gateway translation; failures skipped.
- Rotation-lite: when the file exceeds 200 MB, rename to
  `<path>.1.jsonl` and start fresh. Log failures are swallowed
  (never break translation).
- Env toggles: `LST_TRANSLATION_LOG_ENABLED=false` to disable,
  `LST_TRANSLATION_LOG_PATH=...` to relocate.

Extension storage buffer (covers direct ollama/llamacpp providers):

```ts
{ ts: string; hostname: string; source_lang: string; target_lang: string;
  source_text: string; translation: string }
```

- Capped at 2000 entries, oldest dropped; export/clear via options UI
  (Phase 4). Note in README: history is stored locally in the browser.

## 10. Verification Checklist

1. `cd gateway && python3 -m venv .venv` (if missing) then
   `pip install -r requirements.txt -r requirements-dev.txt`, then
   `python -m pytest` — all green (old + new tests).
2. `cd extension && npm install` (if missing), then
   `npm run typecheck && npm test && npm run build` — all green.
3. Gateway smoke test (llama.cpp or Ollama serving `hy-mt:1.5b`):
   ```bash
   curl -s localhost:8000/translate -H 'Content-Type: application/json' -d '{
     "source_lang":"ja","target_lang":"ko",
     "text":"冒険者と魔法使いが異世界で旅をした。",
     "glossary":[{"source":"冒険者","target":"모험가"},{"source":"魔法使い","target":"마법사"},{"source":"異世界","target":"이세계"}]
   }'
   ```
   Expect 모험가/마법사/이세계 in the result.
4. Extension E2E with **provider = llamacpp (Path B)**: load unpacked,
   save a rule for a Japanese site, add glossary entries in options,
   translate a selected area, verify terms, then export history JSONL
   from options — file must contain the pairs.
5. Extension E2E with provider = gateway (Path A): same steps, verify
   terms + `data/translation_log.jsonl` entries.
6. A/B (record result in docs/architecture.md): same 10 ja->ko sentences
   with (a) official Chinese template, (b) English adaptation, glossary of
   10 mixed terms; pick the better; if (a) wins, switch §7 default and
   update tests accordingly.
7. KV-cache sanity (optional): two identical glossary requests back to
   back; the second should be noticably faster (Ollama) / reuse slots
   (llama.cpp).

## 11. Backward Compatibility

- Stored settings without `glossary` sanitize to `[]`; prompt output with
  empty glossary is byte-identical to current behavior (existing prompt
  tests must pass unmodified).
- `glossary` is optional in the API; old extension versions hitting a new
  gateway (and vice versa) keep working.
- `num_ctx` 2048 → 4096 is a runtime option bump; fine on 8 GB VRAM with
  the 1.8B model.

## 12. Future Work (explicitly deferred)

- **LoRA / fine-tune** only when: >= ~1000 logged pairs per site exist AND
  prompt+post-replace has been shown insufficient (style/format beyond
  terms). 8 GB VRAM is sufficient for LoRA training on a 1.8B model
  (QLoRA). Do not attempt earlier.
- Direction-aware glossary entries (`ja->ko` vs `ko->ja` per rule).
- Global glossary + per-site overrides.
- Term suggestion mining from logged pairs (frequency/consistency stats).
- History size management beyond the 2000-entry cap (e.g. IndexedDB).

## 13. Environment Notes for the Executing Agent

- Repo root: `/home/ahn/dev/QuickLocalMT` (branch `main`).
- A worktree `add-glossary` exists at `~/orca/workspaces/QuickLocalMT/add-glossary`
  (currently at the same commit as main). Work on it if you use orca
  worktrees; otherwise working on `main` is fine — do not create a second
  conflicting branch without need.
- Extension scripts: `npm test` (vitest), `npm run typecheck`, `npm run build`.
- Gateway: FastAPI app `gateway/app/main.py`, tests with pytest.
- User's primary direction is ja -> ko; default examples and smoke tests
  should use ja/ko.
