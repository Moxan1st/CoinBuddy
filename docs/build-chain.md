# Build Chain

`pnpm run build` now runs through a small wrapper in `package.json` instead of calling `plasmo build` directly.

Why:
- `plasmo build` performs a version check that calls `package-json("plasmo", { version: "latest" })`
- That check reaches the npm registry before the extension bundle is built
- In weak-network or offline environments, the build would block even though the project dependencies are already installed locally

What the wrapper does:
- Writes a temporary Node loader into `/tmp`
- Replaces only the `package-json` import used by the Plasmo CLI version check
- Launches the bundled Plasmo CLI from the local `node_modules`

Impact:
- `pnpm run build` no longer depends on the npm registry for the CLI version check
- The actual extension build still uses the local installed toolchain

Residual risk:
- If a future Plasmo release changes the internal update-check import path, the wrapper will need to be adjusted
- The wrapper relies on Node's loader hook behavior, so a major Node runtime change should be revalidated
