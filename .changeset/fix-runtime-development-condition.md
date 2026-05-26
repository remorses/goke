---
'goke': patch
---

Remove `"development"` condition from `#runtime` conditional import map.

Node 22 `--experimental-strip-types` (used by vitest and other tools that activate the `development` condition) cannot strip types from `.ts` files inside `node_modules`. The `"development"` entry pointed to `./src/runtime-node.ts`, causing this error for consumers:

```
Error: Stripping types is currently unsupported for files under node_modules,
for "file:///.../node_modules/goke/src/runtime-node.ts"
```

The `"node"` condition already points to the compiled `./dist/runtime-node.js`, which covers the same runtime correctly.
