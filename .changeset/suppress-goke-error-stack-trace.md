---
'goke': patch
---

Suppress stack trace output for user-facing CLI errors (`GokeError`).

Validation and usage errors like unknown options, missing values, and schema coercion failures now print only the error message without a noisy stack trace. Unexpected errors (non-`GokeError`) still include the full stack trace for debugging.

Before:

```
error: Invalid value for --port: expected number, got "abc"

    at coerceToNumber (file:///…/coerce.js:123:11)
    at coerceBySchema (file:///…/coerce.js:456:12)
    …
```

After:

```
error: Invalid value for --port: expected number, got "abc"
```

Fixes #2
