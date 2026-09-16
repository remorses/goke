---
'goke': patch
---

Treat a following negative number as an option value, not a new flag.

`--offset -1` used to parse `-1` as an unknown option. Value-taking flags now consume tokens like `-1` and `-2.5`. Boolean flags still leave those tokens alone, so `--verbose -1` stays an unknown option.

```ts
cli.option('--offset [days]', z.number())
await cli.parse(['node', 'bin', '--offset', '-1'])
// options.offset === -1
```
