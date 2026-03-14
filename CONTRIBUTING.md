# Contributing to Cleancentive

Thank you for your interest in contributing to Cleancentive! 🌍

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/cleancentive.git
   cd cleancentive
   ```
3. **Follow the setup instructions** in [DEVELOPMENT.md](DEVELOPMENT.md)

## Development Workflow

### Making Changes

1. **Create a branch** for your feature or fix:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes** following our coding standards:
   - Use TypeScript for all new code
   - Follow the existing code style
   - Write tests for new features
   - Update documentation as needed

3. **Test your changes**:
   ```bash
   bun run test
   bun run lint
   ```

4. **Commit your changes** using conventional commits:
   ```bash
   git commit -m "feat: add new feature"
   git commit -m "fix: resolve issue with..."
   git commit -m "docs: update documentation"
   ```

5. **Push and create a Pull Request**:
   ```bash
   git push origin feature/my-feature
   ```

## Commit Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code style changes (formatting, etc.)
- `refactor:` - Code refactoring
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks

## Code Style

- **TypeScript**: Use strict type checking
- **Formatting**: Run `bun run lint` before committing
- **Naming**: Use descriptive variable and function names
- **Comments**: Document complex logic and public APIs

## Clean Code Principles

### Naming

- Names reveal intent. A reader should understand what a variable holds or what a function does without reading the implementation.
- Booleans read as questions: `isActive`, `hasPermission`, `canSubmit`.
- Functions that return data are named for what they return: `getActiveUsers()`, `calculateDistance()`.
- Functions that perform actions are named for the action: `sendNotification()`, `deleteExpiredSessions()`.
- Avoid generic names like `data`, `info`, `result`, `temp`, `handler`. Be specific.

### Functions

- Each function does one thing. If you need "and" to describe what it does, split it.
- Keep functions short. If a function exceeds ~30 lines, look for extraction opportunities.
- Limit parameters to 3. Beyond that, group into an options object.
- Avoid flag parameters (booleans that change behavior). Write two functions instead.
- Return early to avoid deep nesting. Guard clauses at the top, happy path at the bottom.

### Code Organization

- Group related code together. A reader should not have to jump between distant parts of a file to understand a flow.
- No dead code. Remove unused imports, commented-out code, and unreachable branches.
- No magic numbers or strings. Use named constants.
- Prefer explicit over clever. Code is read far more than it is written.

## YAGNI (You Aren't Gonna Need It)

- Implement what is needed now, not what might be needed later.
- Do not create abstractions for a single implementation. Wait until you have two or three concrete cases.
- Do not add configuration options for things that have only one value.
- Do not build generic frameworks or utility libraries. Solve the specific problem.
- If a feature is not needed for the current task, it is out of scope.

## Refactoring Guidelines

### When to Refactor

- **Boy Scout Rule**: Leave code cleaner than you found it -- but only in files you are already modifying.
- Refactor when a change is difficult to make because of existing structure.
- Refactor when you see duplication that makes a bug fix or feature harder.
- Do not refactor for aesthetics alone. There must be a practical benefit.

### Safe Refactoring

- Refactor in separate commits from behavior changes. A commit either changes behavior or restructures code, never both.
- Ensure tests pass before and after. If there are no tests for the code you are restructuring, add them first.
- Prefer small, incremental refactorings over large rewrites.
- Common safe refactorings: extract function, rename for clarity, remove duplication, simplify conditionals, move code closer to where it is used.

## Documentation as Living Artifacts

- Architecture documentation (C4 diagrams, data models, system overviews) lives in `docs/architecture/`.
- These documents are both **input** (they inform design decisions and onboarding) and **output** (they must be updated when implementation changes the architecture).
- **Definition of Done**: any change that alters architecture, infrastructure, or data model must update the corresponding documentation in `docs/architecture/`.

## Testing

- Write unit tests for utility functions
- Write integration tests for API endpoints
- Ensure all tests pass before submitting a PR

```bash
# Run all tests
bun run test

# Run tests in watch mode
cd backend && bun run test:watch
```

## Project Structure

```
cleancentive/
├── backend/          # NestJS API
├── frontend/         # React PWA
├── worker/           # Image analysis worker
├── docs/             # Long-living documentation (C4 architecture views, domain glossary)
└── infrastructure/   # Docker configs
```

## Questions?

- Open an issue for bugs or feature requests
- Join discussions in GitHub Discussions

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
