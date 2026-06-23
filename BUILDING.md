# Building Spinix from source

This repository is the complete source of the Spinix VS Code / Claude Code
extension — the **client only**. The Spinix backend is separate and private.
It's open (MIT) so you can read it and verify the privacy claims in the README
for yourself — for example, that the busy-watcher reads file-change *timestamps*
and never opens file contents (`src/busy-watch.ts`).

```bash
npm install
npm run build      # esbuild → dist/extension.js
npm test           # vitest
npm run package    # vsce → spinix-<version>.vsix
```

Press <kbd>F5</kbd> in VS Code to launch an Extension Development Host.

---

This repo is a mirror, generated from the Spinix monorepo by
`scripts/sync-extension.sh`. The few `@spinix/shared` constants the client uses
are inlined in `src/shared.ts`. Issues and PRs are welcome here.
