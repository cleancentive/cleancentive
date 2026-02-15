# Agent Instructions

You are working on Cleancentive, an environmental cleanup and litter tracking application.

**Read [CONTRIBUTING.md](CONTRIBUTING.md) first.** All code quality principles and project conventions there apply to you.

## Before You Code

- Read the relevant OpenSpec artifacts in `openspec/changes/` before implementing a feature. Follow the specs, design, and task breakdown.
- Check `openspec/config.yaml` for data model conventions (UUIDs, timestamps, audit fields).
- Check `docs/architecture/` for architecture documentation (C4 diagrams, data models).
- Check existing code in the relevant workspace for patterns before creating new ones.

## Code Generation Standards

- Do not generate placeholder or stub implementations. Every function must do something real or not exist yet.
- Do not add TODO comments unless explicitly asked. Either implement it or leave it out.
- Do not wrap simple operations in unnecessary abstractions.
- Do not create barrel files (index.ts re-exports) unless one already exists in that directory.
- Do not add dependencies without being asked. Use what is already in package.json.
- Prefer inline types over creating type files for types used in only one place.

## File and Module Conventions

- Backend follows NestJS module structure: `src/<domain>/<domain>.{module,controller,service,entity}.ts`
- Frontend follows feature-based structure under `src/`
- Worker scripts go in `worker/src/`
- Test files live adjacent to source: `*.spec.ts` for unit tests, `test/` directory for e2e tests

## When Modifying Existing Code

- Match the style of the surrounding code, even if you would write it differently.
- Do not reformat or restructure files beyond the scope of the requested change.
- Do not rename existing variables, functions, or files unless that is the task.
- When fixing a bug, add a test that reproduces it before fixing it.

## Commits and PRs

- Follow the conventional commit format specified in CONTRIBUTING.md.
- One logical change per commit. Do not bundle unrelated changes.
- Keep PRs focused. If you discover something unrelated that needs fixing, note it separately.
