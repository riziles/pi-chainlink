#!/usr/bin/env python3
"""
Chainlink Context Provider - Agent-Agnostic AI Context Injection

Reads chainlink project state (.chainlink/rules/, session, issues) and
generates context for any AI coding assistant. Output formats: xml, md, json.

Usage:
    python context-provider.py                  # Full context (default: xml)
    python context-provider.py --format md      # Markdown format
    python context-provider.py --format json    # JSON format
    python context-provider.py --prepend "..."   # Prepend context to prompt

Integration examples:
    # Aider
    python context-provider.py > /tmp/context.md && aider --message-file /tmp/context.md

    # Generic shell wrapper
    CONTEXT=$(python context-provider.py) && echo "$CONTEXT\n\nUser: $1" | llm

    # Cursor
    python context-provider.py --format md --rules >> .cursorrules
"""

import argparse
import io
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

# Fix Windows encoding issues
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')


def find_chainlink_dir() -> Optional[Path]:
    """Find .chainlink directory by walking up from cwd."""
    current = Path.cwd()
    while current != current.parent:
        chainlink_dir = current / ".chainlink"
        if chainlink_dir.is_dir():
            return chainlink_dir
        current = current.parent
    return None


def run_chainlink(args: list[str]) -> tuple[str, bool]:
    """Run a chainlink command and return output."""
    try:
        result = subprocess.run(
            ["chainlink"] + args,
            capture_output=True,
            text=True,
            timeout=15,
        )
        return result.stdout.strip(), result.returncode == 0
    except (subprocess.TimeoutExpired, FileNotFoundError):
        return "", False


def detect_languages() -> list[str]:
    """Detect programming languages in the project."""
    languages = []
    cwd = Path.cwd()

    indicators = {
        "rust": ["Cargo.toml"],
        "python": ["pyproject.toml", "setup.py", "requirements.txt"],
        "typescript": ["tsconfig.json"],
        "javascript": ["package.json"],
        "go": ["go.mod"],
        "java": ["pom.xml", "build.gradle"],
        "c": ["Makefile"],
        "cpp": ["CMakeLists.txt"],
        "csharp": ["*.csproj", "*.sln"],
        "ruby": ["Gemfile"],
        "php": ["composer.json"],
        "swift": ["Package.swift"],
        "kotlin": ["build.gradle.kts"],
        "scala": ["build.sbt"],
        "zig": ["build.zig"],
        "elixir": ["mix.exs"],
    }

    for lang, patterns in indicators.items():
        for pattern in patterns:
            if pattern.startswith("*"):
                if list(cwd.glob(pattern)):
                    languages.append(lang)
                    break
            elif (cwd / pattern).exists():
                languages.append(lang)
                break

    # TypeScript overrides JavaScript if both indicators match
    if "typescript" in languages and "javascript" in languages:
        languages.remove("javascript")

    # C detection needs file extension check (Makefile is weak)
    if "c" in languages:
        if not list(cwd.rglob("*.c")):
            languages.remove("c")

    return languages


def get_project_structure(max_depth: int = 3, max_entries: int = 50) -> str:
    """Get project directory structure."""
    cwd = Path.cwd()
    entries = []
    count = 0

    def walk(path: Path, depth: int, prefix: str = ""):
        nonlocal count
        if depth > max_depth or count >= max_entries:
            return

        try:
            items = sorted(path.iterdir(), key=lambda x: (x.is_file(), x.name))
        except PermissionError:
            return

        skip = {
            ".git", "node_modules", "__pycache__", ".venv", "venv",
            "target", "dist", "build", ".next", ".cache", "coverage",
        }
        items = [i for i in items if i.name not in skip]

        for i, item in enumerate(items):
            if count >= max_entries:
                entries.append(f"{prefix}... (truncated at {max_entries} entries)")
                return

            is_last = i == len(items) - 1
            connector = "└── " if is_last else "├── "
            entries.append(f"{prefix}{connector}{item.name}{'/' if item.is_dir() else ''}")
            count += 1

            if item.is_dir():
                extension = "    " if is_last else "│   "
                walk(item, depth + 1, prefix + extension)

    walk(cwd, 0)
    return "\n".join(entries)


def _lang_to_rule_filename(lang: str) -> Optional[str]:
    """Map a detected language to a rule file name."""
    mapping = {
        "python": "python.md",
        "typescript": "typescript.md",
        "javascript": "javascript.md",
        "rust": "rust.md",
        "go": "go.md",
        "java": "java.md",
        "kotlin": "kotlin.md",
        "swift": "swift.md",
        "c": "c.md",
        "cpp": "cpp.md",
        "csharp": "csharp.md",
        "ruby": "ruby.md",
        "php": "php.md",
        "scala": "scala.md",
        "elixir": "elixir.md",
        "zig": "zig.md",
        "odin": "odin.md",
    }
    return mapping.get(lang)


def get_coding_rules(chainlink_dir: Path) -> str:
    """Read coding rules from .chainlink/rules/ directory.

    Falls back to hardcoded rules if the rules directory doesn't exist
    (e.g., project was initialized with an older chainlink version).
    """
    rules_dir = chainlink_dir / "rules"
    sections = []

    if rules_dir.is_dir():
        # Global rules (always included)
        global_path = rules_dir / "global.md"
        if global_path.is_file():
            sections.append(_read_section("General Requirements", global_path))

        # Language-specific rules
        languages = detect_languages()
        for lang in languages:
            filename = _lang_to_rule_filename(lang)
            if filename:
                lang_path = rules_dir / filename
                if lang_path.is_file():
                    sections.append(_read_section(f"{lang.title()} Best Practices", lang_path))

        # Quality and rigor rules
        for rule_name, section_title in [
            ("quality.md", "Quality Standards"),
            ("rigor.md", "Rigor Requirements"),
        ]:
            rule_path = rules_dir / rule_name
            if rule_path.is_file():
                sections.append(_read_section(section_title, rule_path))

        # Tracking mode rules
        tracking_mode = _read_tracking_mode(chainlink_dir)
        tracking_path = rules_dir / f"tracking-{tracking_mode}.md"
        if tracking_path.is_file():
            sections.append(_read_section("Workflow Tracking", tracking_path))
    else:
        # Rules directory missing — use hardcoded fallback
        sections.append(_fallback_rules())

    return "\n\n".join(sections)


def _read_section(title: str, path: Path) -> str:
    """Read a rule file and prepend a section title."""
    try:
        content = path.read_text(encoding="utf-8").strip()
        if content:
            return f"### {title}\n{content}"
    except (OSError, UnicodeDecodeError):
        pass
    return ""


def _read_tracking_mode(chainlink_dir: Path) -> str:
    """Read tracking mode from hook-config.json."""
    config_path = chainlink_dir / "hook-config.json"
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
        return config.get("tracking_mode", "strict")
    except (OSError, json.JSONDecodeError):
        return "strict"


def get_session_context() -> dict:
    """Get current chainlink session context."""
    context = {
        "active": False,
        "session_id": None,
        "active_issue": None,
        "handoff_notes": None,
        "ready_issues": [],
        "open_issues": [],
    }

    output, success = run_chainlink(["session", "status"])
    if success and output:
        context["active"] = "Session #" in output
        for line in output.split("\n"):
            if "Session #" in line:
                try:
                    context["session_id"] = int(line.split("#")[1].split()[0])
                except (IndexError, ValueError):
                    pass
            if "Working on:" in line:
                context["active_issue"] = line.split("Working on:")[1].strip()
            if "Handoff notes:" in line:
                idx = output.find("Handoff notes:")
                if idx != -1:
                    context["handoff_notes"] = output[idx + 14:].strip()

    output, success = run_chainlink(["ready"])
    if success and output and "No ready issues" not in output:
        for line in output.split("\n"):
            if line.strip().startswith("#"):
                context["ready_issues"].append(line.strip())

    output, success = run_chainlink(["list"])
    if success and output and "No issues found" not in output:
        for line in output.split("\n"):
            if line.strip().startswith("#") or line.strip().startswith("  #"):
                context["open_issues"].append(line.strip())

    return context


def _fallback_rules() -> str:
    """Hardcoded fallback rules when .chainlink/rules/ doesn't exist."""
    return """### General Requirements
1. **NO STUBS**: Never write placeholder comments, empty bodies, or incomplete markers
2. **NO DEAD CODE**: Remove unused code, don't comment it out
3. **FULL FEATURES**: Implement complete features, don't stop partway
4. **ERROR HANDLING**: Proper error handling everywhere, no panics on bad input
5. **SECURITY**: Validate input, use parameterized queries, no command injection
6. **READ BEFORE WRITE**: Always read a file before editing it"""


def format_output(context: dict, fmt: str = "xml") -> str:
    """Format the context for output."""

    if fmt == "json":
        return json.dumps(context, indent=2)

    parts = []

    # Session context
    if context.get("session"):
        session = context["session"]
        if fmt == "xml":
            parts.append("<chainlink-session-context>")
            if session["active"]:
                parts.append("## Session")
                parts.append(f"Session #{session['session_id']} active")
                if session["active_issue"]:
                    parts.append(f"Working on: {session['active_issue']}")
                if session["handoff_notes"]:
                    parts.append(f"Previous Handoff: {session['handoff_notes']}")
            else:
                parts.append("No active session. Use 'chainlink session start' to begin.")
            parts.append("")
        else:
            parts.append("## Chainlink Session")
            if session["active"]:
                parts.append(f"- **Session:** #{session['session_id']}")
                if session["active_issue"]:
                    parts.append(f"- **Working on:** {session['active_issue']}")
                if session["handoff_notes"]:
                    parts.append(f"- **Handoff:** {session['handoff_notes']}")
            else:
                parts.append("No active session.")
            parts.append("")

    # Issues context
    if context.get("issues"):
        issues = context["issues"]
        if fmt == "xml":
            parts.append("## Open Issues")
        else:
            parts.append("## Issues")
        if issues["ready"]:
            if fmt == "xml":
                parts.append("Ready (unblocked):")
            else:
                parts.append("### Ready (unblocked)")
            for issue in issues["ready"]:
                parts.append(f"  {issue}")
        if issues["open"]:
            if fmt == "xml":
                parts.append("Open:")
            else:
                parts.append("### Open")
            for issue in issues["open"]:
                parts.append(f"  {issue}")
        if not issues["ready"] and not issues["open"]:
            parts.append("No open issues.")
        parts.append("")

    # Project structure
    if context.get("structure"):
        if fmt == "xml":
            parts.append("## Project Structure")
        else:
            parts.append("## Project Structure")
        parts.append(f"Languages: {', '.join(context['languages'])}")
        parts.append("```")
        parts.append(context["structure"])
        parts.append("```")
        parts.append("")

    # Coding rules
    if context.get("rules"):
        if fmt == "xml":
            parts.append(context["rules"])
        else:
            parts.append(context["rules"])
        parts.append("")

    # Workflow reminder
    if context.get("session") or context.get("issues"):
        parts.append("## Workflow")
        parts.append("- Use `chainlink session start` at the beginning of work")
        parts.append('- Use `chainlink session work <id>` to mark current focus')
        parts.append('- Add comments: `chainlink comment <id> "..."`')
        parts.append('- End with notes: `chainlink session end --notes "..."`')
        if fmt == "xml":
            parts.append("</chainlink-session-context>")
        parts.append("")

    return "\n".join(parts)


def main():
    parser = argparse.ArgumentParser(
        description="Generate AI context from chainlink project state",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--format", "-f", choices=["xml", "md", "json"],
                        default="xml", help="Output format")
    parser.add_argument("--session", action="store_true", help="Session context only")
    parser.add_argument("--issues", action="store_true", help="Issues context only")
    parser.add_argument("--rules", action="store_true", help="Coding rules only")
    parser.add_argument("--structure", action="store_true", help="Project structure only")
    parser.add_argument("--prepend", metavar="PROMPT", help="Prepend context to prompt")
    parser.add_argument("--env", action="store_true", help="Output as environment variables")
    parser.add_argument("--clipboard", action="store_true", help="Copy to clipboard")

    args = parser.parse_args()

    include_all = not (args.session or args.issues or args.rules or args.structure)
    chainlink_dir = find_chainlink_dir()
    languages = detect_languages()

    context = {"languages": languages}

    if include_all or args.session or args.issues:
        session_ctx = get_session_context()
        if include_all or args.session:
            context["session"] = {
                "active": session_ctx["active"],
                "session_id": session_ctx["session_id"],
                "active_issue": session_ctx["active_issue"],
                "handoff_notes": session_ctx["handoff_notes"],
            }
        if include_all or args.issues:
            context["issues"] = {
                "ready": session_ctx["ready_issues"],
                "open": session_ctx["open_issues"],
            }

    if include_all or args.structure:
        context["structure"] = get_project_structure()

    if include_all or args.rules:
        if chainlink_dir:
            context["rules"] = get_coding_rules(chainlink_dir)
        else:
            context["rules"] = _fallback_rules()

    output = format_output(context, args.format)

    if args.prepend:
        output = f"{output}\n\n---\n\nUser request: {args.prepend}"

    if args.env:
        print(f'CHAINLINK_LANGUAGES="{",".join(languages)}"')
        if context.get("session"):
            print(f'CHAINLINK_SESSION_ACTIVE={"1" if context["session"]["active"] else "0"}')
            if context["session"]["session_id"]:
                print(f'CHAINLINK_SESSION_ID="{context["session"]["session_id"]}"')
        escaped = output.replace("\n", "\\n").replace('"', '\\"')
        print(f'CHAINLINK_CONTEXT="{escaped}"')
        return

    if args.clipboard:
        try:
            if sys.platform == "darwin":
                subprocess.run(["pbcopy"], input=output.encode(), check=True)
            elif sys.platform == "win32":
                subprocess.run(["clip"], input=output.encode(), check=True)
            else:
                subprocess.run(["xclip", "-selection", "clipboard"],
                               input=output.encode(), check=True)
            print("Context copied to clipboard", file=sys.stderr)
        except (subprocess.CalledProcessError, FileNotFoundError):
            print("Failed to copy to clipboard", file=sys.stderr)
            print(output)
        return

    print(output)


if __name__ == "__main__":
    main()
