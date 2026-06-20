# Changelog

All notable changes to Chainlink will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Claude 4.6 Opus Optimization Epic (#99)

Comprehensive overhaul to make chainlink work seamlessly with Claude 4.6 Opus,
reducing tool-call overhead, improving machine-parseable output, and adding
context-compression resilience.

#### CLI Enhancements
- `chainlink quick` compound command — create + label + work in one call (#100)
- `--json` output flag on show command for structured machine-readable output (#101)
- `--quiet` / `-q` mode for minimal, pipe-friendly output (#108)
- `--work` and `--label` flags on `create` and `subissue` commands (#104)
- `close-all` batch command with label and priority filtering (#107)

#### Session & Context Management
- Stale session auto-detection and cleanup (auto-ends sessions idle >4 hours) (#102)
- Context compression breadcrumbs via `session action` — records last action, auto-comments on active issue, and restores context on resume (#111)
- PreToolUse hook nudges agent when no active working issue is set (#105)

#### Templates & Rules
- Three new AI-specific issue templates: `audit`, `continuation`, `investigation` (#110)
- Condensed behavioral guard mode — lighter rule injection after first prompt (#103)
- Reorganized rules into tiered priority system (critical/standard/optional) (#109)

#### Hooks
- Debounced linting mode in post-edit hook to reduce noise (#106)

#### Code Quality
- Fix all clippy warnings (introduced `CreateOpts` struct, removed dead imports, idiomatic Rust patterns) (#112)
- Database schema v7→v8 migration (adds `last_action` column to sessions, auto-applied on first use)

### Added
- Add path filters to CI workflow to skip Rust tests on pi-chainlink-only PRs (#29)
- Add MAPPING.md with upstream source map and maintainer checklist (#28)
- Add context-provider.py to chainlink for agent-agnostic context injection (#8)
- Add context-provider.py to chainlink CLI resources and deploy with init (#26)
- Update hook scripts for multi-agent lock awareness (#172)
- Improve hook error messages to prevent Claude workarounds (#129)
- Reorganize CLI into hierarchical subcommands with backward-compat aliases (#160)
- Borrow nice-to-have improvements from crosslink fork (#165)
- Expand test suite with smoke, adversarial, and property-based tests (#168)
- Add clap env feature for environment variable CLI flag fallbacks (#164)
- Improve transaction rollback error logging (#163)
- Improve migration error handling with proper logging (#155)
- Add rules.local override support for hook rule loading (#154)
- Extract shared hook config module from duplicate hook code (#153)
- Add signal handlers for graceful daemon shutdown (#152)
- Add structured logging with tracing crate (#151)
- Add input validation constants and functions for DB boundary (#147)
- Update READMEs with hook configuration documentation (#119)
- Split tracking instructions into per-mode markdown files (#118)
- Make issue tracking strictness configurable (#117)
- Make blocked git commands user-configurable in work-check hook (#116)
- Update all dependencies to latest versions (#114)
- Add comprehensive edge case testing (proptest, CLI fuzzing, Unicode E2E) (#50)
- Improve session management with auto-start and stronger rules (#48)
- Add sanitizing MCP server for safe web fetching (#47)
- Add macOS binary support to VSCode extension with cross-compilation (#32)
- Auto-create CHANGELOG.md if it doesn't exist when closing issues
- Automatic CHANGELOG.md updates when closing issues (based on labels)
- `--no-changelog` flag to skip changelog entry for internal work
- `chainlink export` now outputs to stdout by default, use `-o` for file output

### Fixed
- Extension should suppress its own chainlink bash calls from prompt-guard counting (#11)
- Fix prompt-guard counter not resetting on native chainlink tool usage (#27)
- Fix activeIssue camelCase bug in work-check that permanently blocks all tools (#19)
- Agent struggles with strict mode catch-22: can't run chainlink commands to create issue when hook blocks everything (#5)
- sessionWork test is flaky — chainlink quick() fails when session is ended mid-test-run (#4)
- Fix allowed_bash_prefixes to include cd so chainlink commands work from any directory (#3)
- Fix git command normalization bypass in work-check hook (#145)
- Fix PRAGMA user_version column name bug causing repeated v7 migration (#144)
- Fix hooks to always find parent .chainlink directory regardless of cwd (#123)
- Fix CI test failure on latest commit (#122)
- Fix vscode engine version to match @types/vscode (#115)
- Fix SQL injection vulnerability in milestone listing (#97)
- Fix cargo-mutants artifact left in production code (#97)
- Fix byte/char length mismatch for Unicode text truncation (#97)
- Fix tree view not filtering subissues by status (#97)
- Fix markdown export silently dropping archived issues (#97)
- Fix daemon log file corruption from duplicate file handles (#97)

### Changed
- Add experimental disclaimer and motivation note to README (#14)
- Resolve issue #26 where the prompt_guard.py depends on local variables, replace with dynamic approach the detects enabled languages from the available language markdown files in chainlink (#1)
- Block git mutation commands via hook (#113)
- Fix wrong assertion directions and tautological property tests (#96)
- Fix overly loose CLI integration test assertions (#95)
- Fix display function tests to verify actual output or DB state (#94)
- Add unit tests for session.rs command (#64)
- Add security-focused tests (#82)
- Add unit tests for show.rs command (#58)
- Add unit tests for delete.rs command (#57)
- Add unit tests for update.rs command (#56)
- Add unit tests for label.rs command (#61)
- Add unit tests for status.rs command (#60)
- Add unit tests for search.rs command (#59)
- Add unit tests for models.rs (#75)
- Add unit tests for comment.rs command (#62)
- Add unit tests for create.rs command (#55)
- Add Unicode E2E integration tests (#53)
- Add CLI-layer fuzz target for list/show output (#52)
- Add proptest for string handling functions (#51)
- Issue titles are now expected to be changelog-ready (verb + description)

## [1.4] - 2026-01-08

### Added
- Project infographic for README

### Fixed
- Audit and fix tautological tests and logical flaws in test suite (#92)
- Fix UTF-8 panic in list truncation (#49)
- Fix macOS cross-compilation linker configuration (#34)
- Import/export roundtrip issues with parent relationships

## [1.3] - 2026-01-07

### Added
- Elixir and Phoenix language rules (community contribution from @Viscosity4373)
- Build system automatically rebuilds Rust binaries when packaging extension
- Improved global.md defaults for AI agents

### Fixed
- Extension binary update detection (now always overwrites)
- Packager issues

## [1.2] - 2026-01-05

### Added
- VSCode extension for seamless integration
- Agent-agnostic context provider (works with any AI assistant)
- Fuzzing targets for security testing (fuzz_create_issue, fuzz_import, fuzz_search, fuzz_dependency_graph, fuzz_state_machine)
- Property-based testing with proptest
- Cross-platform CI (Windows, macOS, Linux)
- Database corruption recovery
- Daemon auto-start on session start
- ~88% code coverage

### Security
- Add web.md prompt injection defense rule for external content (#33)
- Bump qs dependency to fix vulnerability

### Fixed
- Path handling issues on Windows
- Various edge cases found through fuzzing
- Test reliability improvements

## [1.1] - 2025-12-28

### Added
- Issue templates (bug, feature, refactor, research)
- Hook-based test reminder system
- Export/Import functionality (JSON format)
- Milestones for grouping issues
- Issue archiving for completed work
- Best practices rules for 15 programming languages:
  - Rust, Python, JavaScript, TypeScript, Go, Java, C#, C++
  - Ruby, PHP, Swift, Kotlin, Scala, Haskell
- Composable rules system for better maintainability

### Fixed
- Language detection now checks subdirectories

## [1.0] - 2025-12-27

### Added
- Initial release
- Core issue management (create, show, update, close, reopen, delete)
- Issue hierarchy with subissues
- Labels and comments
- Dependencies (block/unblock)
- Issue relations (relate/unrelate)
- Session management with handoff notes
- Timer for time tracking
- Tree view for issue hierarchy
- Search functionality
- Priority levels (low, medium, high, critical)
- SQLite storage (`.chainlink/issues.db`)
- Claude Code hooks integration
- Smart navigation suggestions
- `chainlink next` command for work suggestions

## Project Goals

Chainlink is designed to be:
- **Simple**: No complex setup, just `chainlink init`
- **Lean**: Single binary, SQLite storage, no external dependencies
- **AI-First**: Built for AI-assisted development workflows
- **Context-Preserving**: Session handoff notes survive context resets
