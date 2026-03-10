from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import PurePosixPath
from typing import Iterable


Decision = str


@dataclass(frozen=True)
class ConflictDecision:
    path: str
    category: str
    decision: Decision
    reason: str


def normalize_path(path: str) -> PurePosixPath:
    return PurePosixPath(path.replace("\\", "/").lstrip("./"))


def categorize(path: str) -> tuple[str, Decision, str]:
    normalized = normalize_path(path)
    parts = normalized.parts
    value = normalized.as_posix()

    if value.startswith("src/agents/") or value.startswith("src/auto-reply/"):
        return (
            "agents",
            "required-manual",
            "Agent model-routing and thinking paths track upstream API contracts and need manual review.",
        )
    if value.startswith("extensions/acpx/"):
        return (
            "acpx",
            "required-manual",
            "ACPX config/runtime merges must preserve upstream bootstrap changes while reapplying local harness behavior.",
        )
    if (
        value.startswith("scripts/launchers/")
        or value == "scripts/setup-shortcut.ps1"
        or value == "scripts/HAKUA_LAUNCH.ps1"
        or value == "scripts/verify-voicevox.py"
        or value == "scripts/installers/create-desktop-shortcut.ps1"
        or value == "assets/clawdbot.ico"
    ):
        return (
            "launchers",
            "ours",
            "Windows launcher automation is custom-only and should prefer our branch unless upstream grows an equivalent feature.",
        )
    if any(part.lower() == "vrchat" for part in parts) or "line" in value.lower() or "voice" in value.lower():
        return (
            "vrchat/line",
            "ours",
            "VRChat, LINE, and voice integrations are local extensions and should keep our implementation by default.",
        )
    if value.startswith("_docs/") or value.startswith("docs/"):
        return (
            "docs",
            "ours",
            "Project documentation should keep local operating notes unless a manual review is requested.",
        )
    return (
        "other",
        "theirs",
        "Default to upstream for unrelated paths so security fixes and current APIs win unless explicitly reviewed.",
    )


def collect_unmerged_paths() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=U"],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def resolve(paths: Iterable[str]) -> list[ConflictDecision]:
    decisions: list[ConflictDecision] = []
    for path in paths:
        category, decision, reason = categorize(path)
        decisions.append(
            ConflictDecision(
                path=path,
                category=category,
                decision=decision,
                reason=reason,
            )
        )
    return decisions


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Route merge conflicts by path so py -3 can assist upstream transplant work."
    )
    parser.add_argument("paths", nargs="*", help="Conflicted paths. Uses git unmerged paths when omitted.")
    parser.add_argument("--json", action="store_true", help="Emit JSON instead of plain text.")
    args = parser.parse_args()

    paths = args.paths or collect_unmerged_paths()
    decisions = resolve(paths)

    if args.json:
        json.dump([asdict(item) for item in decisions], sys.stdout, indent=2)
        sys.stdout.write("\n")
        return 0

    if not decisions:
        print("no-conflicts")
        return 0

    for item in decisions:
        print(f"{item.path}\t{item.category}\t{item.decision}\t{item.reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
