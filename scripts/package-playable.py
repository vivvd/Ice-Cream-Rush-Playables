#!/usr/bin/env python3
"""Create a deterministic Unix-friendly ZIP for a static YouTube Playable."""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
from pathlib import Path
import sys
import zipfile


DEFAULT_EXCLUDES = (
    ".git",
    ".git/*",
    "node_modules",
    "node_modules/*",
    "__pycache__",
    "__pycache__/*",
    ".DS_Store",
    "Thumbs.db",
    "*.zip",
    "*.psd",
    "*.kra",
    "*.blend",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Package a static Playable with index.html at ZIP root.")
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--exclude", action="append", default=[])
    return parser.parse_args()


def excluded(relative_path: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(relative_path, pattern) for pattern in patterns)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def main() -> int:
    args = parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if not source.is_dir() or not (source / "index.html").is_file():
        print("ERROR: source must contain index.html at its root", file=sys.stderr)
        return 2

    patterns = DEFAULT_EXCLUDES + tuple(args.exclude)
    files = []
    for path in sorted(source.rglob("*")):
        if not path.is_file() or path.resolve() == output:
            continue
        relative = path.relative_to(source).as_posix()
        if not excluded(relative, patterns):
            files.append((path, relative))

    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path, relative in files:
            info = zipfile.ZipInfo(relative, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())

    with zipfile.ZipFile(output, "r") as archive:
        names = archive.namelist()
        if "index.html" not in names or any("\\" in name for name in names) or archive.testzip():
            print("ERROR: archive validation failed", file=sys.stderr)
            return 3

    print(f"Created: {output}")
    print(f"Files:   {len(files)}")
    print(f"Size:    {output.stat().st_size / (1024 * 1024):.2f} MiB")
    print(f"SHA256:  {sha256(output)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
