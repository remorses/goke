---
'goke': minor
---

Tighten root help spacing and add `.section()` for namespaced command groups.

Help used two blank lines between every section and every command. It now uses one blank line between sections, keeps commands packed, and only adds extra space after nested flags or when a named section starts.

Use `.section()` before namespaced commands that share a parent word:

```ts
cli.section('Get')
cli.command('get pods', 'List pods')
cli.command('get services', 'List services')

cli.section('Describe')
cli.command('describe pod <name>', 'Describe a pod')
```

Root help prints a heading for each group. Commands registered before any `.section()` stay ungrouped at the top. `.command(...).section('Name')` overrides the current CLI section for that command.
