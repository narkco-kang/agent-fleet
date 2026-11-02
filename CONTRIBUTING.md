# Contributing to AgentFleet

First off — thank you for wanting to help. AgentFleet is a young open-source project, and every issue, PR, and real-device test report moves it forward.

> 中文贡献者请看 [docs/20-适配器开发指南.md](docs/20-适配器开发指南.md)。

## Quick links

- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Adapter dev guide](docs/20-适配器开发指南.md) — how to turn a platform "scaffold" into a working direct adapter
- [Architecture](docs/02-架构设计.md) · [Docs index](docs/)

## The single most useful contribution right now

AgentFleet orchestrates **13+ agent platforms**, but only **Grok** has a fully stable *direct local CLI adapter* today. The other ~12 platforms are detected and dispatch-ready, but their headless invocation still needs per-platform testing and implementation.

If you use **Claude Code, Codex, Cursor, Aider, Gemini CLI, Qwen Code, Kimi CLI, Cody, OpenCode, Windsurf, MarsCode, or DSH** on your machine, you are the ideal person to wire one up. See [the adapter guide](docs/20-适配器开发指南.md) — it's a ~30-minute task once you know the CLI flags.

## Getting started

**Prerequisites**: Node.js v24 (better-sqlite3 is built against a specific Node ABI — make sure `node -v` prints `v24`).

```bash
npm install

# coordinator :4173
npm run dev:backend

# dashboard :5173 (auto demo mode with zero devices)
npm run dev:frontend

# per-device daemon
npm run dev:agent

# full build + tests
npm run build
npm run test --workspace backend     # backend tests
npm run test --workspace memory       # memory ledger tests
```

## Ways to contribute

1. **Test on real devices** — run the agent daemon on a second machine and report what works / breaks. Open an issue with the `deployment-feedback` label.
2. **Implement an adapter** — pick a platform from the catalog and wire up its direct CLI execution (see below).
3. **Fix a good first issue** — look for [`good first issue`](https://github.com/narkco-kang/agent-fleet/contribute) and leave a comment to claim it.
4. **Improve docs** — typos, unclear sections, missing examples. Docs live in [`docs/`](docs/).
5. **Report bugs** — open an issue with: your OS, Node version, what you ran, and the logs.

## Claiming a `good first issue`

1. Find an issue labeled `good first issue`.
2. Comment "I'd like to work on this" so nobody else grabs it.
3. Implement, run the relevant tests, and open a PR referencing the issue (`Closes #N`).

## Adapter contribution flow (30 minutes)

The unified `Adapter` interface is in [`device-agent/src/adapters/adapter.ts`](device-agent/src/adapters/adapter.ts). A working reference implementation is [`grokAdapter.ts`](device-agent/src/adapters/grokAdapter.ts). The full step-by-step guide is in [`docs/20-适配器开发指南.md`](docs/20-适配器开发指南.md).

In short:

1. Create `device-agent/src/adapters/<platform>Adapter.ts` implementing `Adapter` (copy `grokAdapter.ts` as a template).
2. Wire it into `device-agent/src/adapters/index.ts` (replace the platform's `CatalogAdapter` entry).
3. Run `detect()` against your locally installed CLI, then verify `run()` produces streamed `TaskEvent`s.
4. Add a small test mirroring the existing adapter tests, then `npm run build` + `npm run test --workspace device-agent`.

## Code style & tests

- TypeScript, strict mode. Run the workspace typecheck / build before pushing:
  ```bash
  npm run build
  ```
- Add tests for any new behavior. Existing suites: `backend`, `memory`, `device-agent`.
- Keep commit messages short and descriptive (conventional style is welcome but not mandatory).

## Pull request checklist

- [ ] `npm run build` passes
- [ ] Relevant workspace tests pass
- [ ] PR description explains *what* and *why*
- [ ] Reference any issue it closes (`Closes #N`)

## Honesty about scope

Please do **not** market or document features as "stable" unless they've actually been verified. The README's capability matrix ([`docs/17-Agent平台安装卸载与调用矩阵.md`](docs/17-Agent平台安装卸载与调用矩阵.md)) deliberately distinguishes *install / discover / gateway execution* from *direct CLI execution* — keep that honesty when you add new platforms.

## Questions?

Open an issue, or start a discussion on [GitHub Discussions](https://github.com/narkco-kang/agent-fleet/discussions). The maintainer responds within 24h to issues and PRs.
