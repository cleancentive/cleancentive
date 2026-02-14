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

## Using OpenSpec

We use [OpenSpec](https://github.com/Fission-AI/OpenSpec) for feature specification and development workflow:

1. **Create a new feature**:
   ```bash
   /opsx:new feature-name
   ```

2. **Develop with OpenSpec artifacts**:
   - Review `proposal.md` for context
   - Follow requirements in `specs/`
   - Implement according to `design.md`
   - Complete tasks in `tasks.md`

3. **Archive when complete**:
   ```bash
   /opsx:archive
   ```

## Project Structure

```
cleancentive/
├── backend/          # NestJS API
├── frontend/         # React PWA
├── worker/           # Image analysis worker
├── infrastructure/   # Docker configs
├── docs/            # Documentation
└── openspec/        # Feature specifications
```

## Questions?

- Check the [planning backlog](planning%20backlog.md) for roadmap and decisions
- Open an issue for bugs or feature requests
- Join discussions in GitHub Discussions

## License

By contributing, you agree that your contributions will be licensed under the AGPL-3.0 License.
