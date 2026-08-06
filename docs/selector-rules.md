# Selector rules

Saved rules map a hostname (and optional path pattern) to a CSS selector. When you
click **Translate saved area**, the extension finds the rule matching the current
URL and translates the element it selects.

## Rule anatomy

```json
{
  "id": "uuid",
  "hostname": "news.example.com",
  "pathPattern": "/article/*",
  "selector": "article .chapter-content",
  "excludedSelectors": [".ad", ".related-news"],
  "sourceLang": "ko",
  "targetLang": "en",
  "enabled": true,
  "createdAt": "2026-08-06T00:00:00Z",
  "updatedAt": "2026-08-06T00:00:00Z"
}
```

- `pathPattern` is optional. When present, `*` matches any suffix
  (`/article/*` matches `/article/123`).
- `sourceLang`/`targetLang` are optional; missing values fall back to the defaults
  in Settings.
- `excludedSelectors` are extra CSS selectors whose subtrees are skipped during
  text extraction (useful for ads, comments, or related-content blocks).

## How selectors are generated

The picker generates a selector in this priority order:

1. A stable unique `id` — `#article-content`.
2. Stable semantic classes — `article .chapter-content`.
3. Element hierarchy with `:nth-of-type()` fallback — `main > article:nth-of-type(1) .content`.

Generated-looking ids and classes are ignored:

- random long hashes (`a1b2c3d4e5f6g7h8`)
- framework-generated tokens (`css-1a2b3c`, `sc-*`, `Mui*`, `emotion-*`)

## Unstable patterns

The extension warns before saving selectors containing:

- `:nth-child(...)` chains
- framework-generated attributes (`data-testid`, `data-cy`, …)
- embedded hashes of 10+ hex characters
- overly deep positional chains

A selector with such patterns may work today but break after the next deploy.

## Good vs. avoid

| Good | Avoid |
| :-- | :-- |
| `article .chapter-content` | `div.css-1a2b3c > div:nth-child(4) > span:nth-child(2)` |
| `main > article:nth-of-type(1) .content` | `#root > div > div > div > p` |
| `#novel-body` | `[data-testid="story-<hash>"]` |

## Tips

- Prefer ids first, then semantic classes, then position. Positional fallbacks are
  acceptable for static sites but fragile for SPAs.
- If a page reorders content, re-run the picker and re-save the rule.
- Use `excludedSelectors` instead of shrinking the main selector when you only want
  to skip a few subtrees.
- Test a saved rule against the active page from **Options → Saved selector rules →
  Test**, or simply refresh the page and use **Translate saved area**.
- Rules are stored in `chrome.storage.local` and are not synced across devices in v1.
