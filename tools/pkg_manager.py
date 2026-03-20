#!/usr/bin/env python3
"""
tsuki pkg manager
=================
Manages the pkg/ directory and keeps packages.json in sync.

Usage
-----
  python pkg_manager.py list                       # list all packages
  python pkg_manager.py validate                   # validate every package
  python pkg_manager.py sync                       # rebuild packages.json from disk
  python pkg_manager.py new <name> [--version 1.0.0] [--desc "..."] [--lib "Arduino Lib"]
  python pkg_manager.py add-example <pkg> [--version 1.0.0] <example-name>
  python pkg_manager.py bump <pkg> <new-version>   # bump version, scaffold new dir

All commands read/write relative to the script's own directory (pkg/).
"""

import argparse
import json
import os
import re
import shutil
import sys
import textwrap
from pathlib import Path
from typing import Optional

try:
    import tomllib  # Python 3.11+
except ImportError:
    try:
        import tomli as tomllib  # pip install tomli
    except ImportError:
        tomllib = None  # type: ignore


# ── Paths ─────────────────────────────────────────────────────────────────────

# tools/pkg_manager.py lives at <repo>/tools/pkg_manager.py
# pkg/ lives at <repo>/pkg/ — one level up from this script.
SCRIPT_DIR = Path(__file__).parent.resolve()   # <repo>/tools
REPO_ROOT  = SCRIPT_DIR.parent                 # <repo>
PKG_DIR    = REPO_ROOT / 'pkg'                 # <repo>/pkg

GITHUB_RAW_BASE = "https://raw.githubusercontent.com/s7lver2/tsuki/refs/heads"


def _check_pkg_dir() -> None:
    """Abort with a clear message if pkg/ can't be found."""
    if not PKG_DIR.exists():
        print(f"[error] pkg/ directory not found at: {PKG_DIR}", file=sys.stderr)
        print(f"        Script is at: {SCRIPT_DIR}", file=sys.stderr)
        print(f"        Expected layout: <repo>/tools/pkg_manager.py  +  <repo>/pkg/", file=sys.stderr)
        sys.exit(1)


def _detect_branch() -> str:
    """Return the current git branch name.

    Resolution order (highest priority first):
      1. TSUKI_BRANCH env var — explicit override (useful in CI).
      2. git rev-parse --abbrev-ref HEAD run from REPO_ROOT.
      3. Falls back to 'main' if git is unavailable or returns 'HEAD'
         (detached HEAD state, e.g. during a CI checkout without a branch).
    """
    if env := os.environ.get("TSUKI_BRANCH", "").strip():
        return env
    try:
        import subprocess as _sp
        result = _sp.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=REPO_ROOT,          # run from repo root, not tools/
            capture_output=True,
            text=True,
            timeout=5,
        )
        branch = result.stdout.strip()
        if result.returncode == 0 and branch and branch != "HEAD":
            return branch
    except Exception:
        pass
    return "main"


def _registry_url(branch: str | None = None) -> str:
    """Build the raw-GitHub base URL for the given branch (or auto-detect)."""
    b = branch or _detect_branch()
    return f"{GITHUB_RAW_BASE}/{b}/pkg"


# ── TOML helpers (graceful without tomllib) ───────────────────────────────────

def read_toml(path: Path) -> dict:
    if tomllib is None:
        # Minimal regex-based fallback — only reads the [package] section
        text = path.read_text(encoding='utf-8')
        m = re.search(r'\[package\](.*?)(\n\[|\Z)', text, re.DOTALL)
        section = m.group(1) if m else text
        result: dict = {}
        for line in section.splitlines():
            m2 = re.match(r'(\w+)\s*=\s*"([^"]*)"\s*$', line)
            if m2:
                result[m2.group(1)] = m2.group(2)
        return result
    with open(path, 'rb') as f:
        raw = tomllib.load(f)
    # Flatten: if fields are nested under [package], hoist them to top level
    if 'package' in raw and isinstance(raw['package'], dict):
        flat = dict(raw['package'])
        for k, v in raw.items():
            if k != 'package':
                flat[k] = v
        return flat
    return raw


# ── Package discovery ─────────────────────────────────────────────────────────

def iter_packages():
    """Yield (name, version, toml_path) for every package on disk."""
    if not PKG_DIR.exists():
        return
    for pkg_dir in sorted(PKG_DIR.iterdir()):
        if not pkg_dir.is_dir() or pkg_dir.name.startswith('.'):
            continue
        if pkg_dir.name == 'keys':
            continue
        for ver_dir in sorted(pkg_dir.iterdir()):
            if not ver_dir.is_dir():
                continue
            toml = ver_dir / 'godotinolib.toml'
            if toml.exists():
                yield pkg_dir.name, ver_dir.name, toml


def latest_version(pkg_name: str) -> Optional[tuple]:
    """Return (version_str, toml_path) for the lexicographically latest version."""
    versions = [
        (ver, toml) for name, ver, toml in iter_packages() if name == pkg_name
    ]
    if not versions:
        return None
    return sorted(versions)[-1]


# ── Registry builder ──────────────────────────────────────────────────────────

def build_registry(branch: str | None = None) -> dict:
    """Build the full packages.json dict from the current pkg/ directory.

    Package TOML URLs are generated for *branch* (auto-detected from git when
    None).  Pass an explicit branch name or set TSUKI_BRANCH to override.
    """
    registry_url = _registry_url(branch)
    registry: dict = {"packages": {}, "branch": branch or _detect_branch()}

    all_versions: dict = {}  # name → {version: toml_path}
    for name, ver, toml_path in iter_packages():
        all_versions.setdefault(name, {})[ver] = toml_path

    for pkg_name, versions in sorted(all_versions.items()):
        latest_ver = sorted(versions.keys())[-1]
        toml_data  = read_toml(versions[latest_ver])

        clean_ver = latest_ver.lstrip('v')
        description = toml_data.get('description', f'{pkg_name} package')
        author      = toml_data.get('author', 'tsuki-team')

        version_urls = {}
        for ver, path in versions.items():
            clean = ver.lstrip('v')
            version_urls[clean] = f"{registry_url}/{pkg_name}/{ver}/godotinolib.toml"

        registry['packages'][pkg_name] = {
            'description': description,
            'author':      author,
            'latest':      clean_ver,
            'versions':    version_urls,
        }

    return registry


# ── Validation ────────────────────────────────────────────────────────────────

REQUIRED_TOML_FIELDS = ['name', 'version', 'description', 'author', 'cpp_header', 'arduino_lib']
REQUIRED_EXAMPLE_FILES = ['main.go', 'tsuki_example.json', 'circuit.tsuki-circuit']

def validate_package(pkg_name: str, ver: str, toml_path: Path) -> list[str]:
    """Return list of error strings (empty = OK)."""
    errors = []
    ver_dir = toml_path.parent

    # Check toml fields
    try:
        data = read_toml(toml_path)
    except Exception as e:
        return [f"Cannot parse TOML: {e}"]

    for field in REQUIRED_TOML_FIELDS:
        if field not in data:
            errors.append(f"Missing TOML field: '{field}'")

    if data.get('name') != pkg_name:
        errors.append(f"TOML name '{data.get('name')}' doesn't match directory name '{pkg_name}'")

    # Check examples referenced in TOML
    if tomllib is not None:
        full = read_toml(toml_path)
        for ex in full.get('example', []):
            ex_dir = ver_dir / ex.get('dir', '')
            if not ex_dir.exists():
                errors.append(f"Example dir not found: {ex_dir.relative_to(PKG_DIR)}")
                continue
            for req in REQUIRED_EXAMPLE_FILES:
                if not (ex_dir / req).exists():
                    errors.append(f"Missing '{req}' in example {ex_dir.name}")

    return errors


# ── Scaffolding ───────────────────────────────────────────────────────────────

TOML_TEMPLATE = '''\
[package]
name        = "{name}"
version     = "{version}"
description = "{description}"
author      = "tsuki-team"
cpp_header  = "{cpp_header}"
arduino_lib = "{arduino_lib}"
cpp_class   = "{cpp_class}"

aliases = ["{Name}"]

# ── Constructor ───────────────────────────────────────────────────────────────
[[function]]
go  = "New"
cpp = "{Name}()"

# ── Instance methods ──────────────────────────────────────────────────────────
[[function]]
go  = "Begin"
cpp = "{{0}}.begin()"

# ── Examples ──────────────────────────────────────────────────────────────────
[[example]]
dir = "examples/basic"
'''

EXAMPLE_MAIN_TEMPLATE = '''\
package main

import (
\t"arduino"
\t"{name}"
\t"fmt"
)

func setup() {{
\tarduino.Serial.Begin(9600)
\t// TODO: initialise {Name}
\tfmt.Println("{Name} ready")
}}

func loop() {{
\t// TODO: read from {Name}
\tarduino.Delay(1000)
}}
'''

EXAMPLE_JSON_TEMPLATE = '''{{\n  "name": "Basic Example",\n  "description": "Basic usage of the {name} package."\n}}\n'''

CIRCUIT_TEMPLATE = '''\
{{
  "version": "1",
  "name": "{Name} Basic",
  "board": "uno",
  "description": "TODO: describe the circuit for {Name}.",
  "components": [
    {{
      "id": "uno", "type": "arduino_uno", "label": "Arduino Uno",
      "x": 40, "y": 20, "rotation": 0, "color": "", "props": {{}}
    }}
  ],
  "wires": [],
  "notes": []
}}
'''


def scaffold_new(name: str, version: str, description: str, arduino_lib: str, cpp_header: str):
    ver_str  = f'v{version}'
    ver_dir  = PKG_DIR / name / ver_str
    ex_dir   = ver_dir / 'examples' / 'basic'

    if ver_dir.exists():
        print(f'[error] {ver_dir} already exists')
        sys.exit(1)

    ex_dir.mkdir(parents=True)
    Name = name[0].upper() + name[1:]
    cpp_class = cpp_header.replace('.h', '').replace('.hpp', '')

    (ver_dir / 'godotinolib.toml').write_text(TOML_TEMPLATE.format(
        name=name, version=version, description=description,
        cpp_header=cpp_header, arduino_lib=arduino_lib,
        cpp_class=cpp_class, Name=Name,
    ))

    (ex_dir / 'main.go').write_text(EXAMPLE_MAIN_TEMPLATE.format(name=name, Name=Name))
    (ex_dir / 'tsuki_example.json').write_text(EXAMPLE_JSON_TEMPLATE.format(name=name))
    (ex_dir / 'circuit.tsuki-circuit').write_text(CIRCUIT_TEMPLATE.format(Name=Name))

    print(f'[ok] Scaffolded pkg/{name}/{ver_str}/')
    print(f'     Edit godotinolib.toml, then run: python pkg_manager.py sync')


def scaffold_example(pkg_name: str, version: str, example_name: str):
    ver_str = f'v{version}'
    ex_dir  = PKG_DIR / pkg_name / ver_str / 'examples' / example_name
    Name    = pkg_name[0].upper() + pkg_name[1:]

    if ex_dir.exists():
        print(f'[error] {ex_dir} already exists')
        sys.exit(1)

    ex_dir.mkdir(parents=True)
    (ex_dir / 'main.go').write_text(EXAMPLE_MAIN_TEMPLATE.format(name=pkg_name, Name=Name))
    (ex_dir / 'tsuki_example.json').write_text(EXAMPLE_JSON_TEMPLATE.format(name=pkg_name))
    (ex_dir / 'circuit.tsuki-circuit').write_text(CIRCUIT_TEMPLATE.format(Name=Name))

    print(f'[ok] Scaffolded example pkg/{pkg_name}/{ver_str}/examples/{example_name}/')
    print(f'     Remember to add [[example]] dir = "examples/{example_name}" to the TOML')


def bump_version(pkg_name: str, new_version: str):
    """Copy the latest version dir to a new version dir."""
    latest = latest_version(pkg_name)
    if not latest:
        print(f'[error] Package {pkg_name!r} not found')
        sys.exit(1)

    old_ver, old_toml = latest
    old_dir  = old_toml.parent
    new_ver  = f'v{new_version}'
    new_dir  = PKG_DIR / pkg_name / new_ver

    if new_dir.exists():
        print(f'[error] {new_dir} already exists')
        sys.exit(1)

    shutil.copytree(old_dir, new_dir)
    # Patch version field in new TOML
    toml_path = new_dir / 'godotinolib.toml'
    text = toml_path.read_text(encoding='utf-8')
    text = re.sub(r'^version\s*=\s*"[^"]*"', f'version     = "{new_version}"', text, flags=re.MULTILINE)
    toml_path.write_text(text, encoding='utf-8')
    print(f'[ok] Bumped {pkg_name}: {old_ver} → {new_ver}')
    print(f'     Edit pkg/{pkg_name}/{new_ver}/godotinolib.toml, then run: python pkg_manager.py sync')


# ── Commands ──────────────────────────────────────────────────────────────────

def cmd_list(_args):
    _check_pkg_dir()
    rows = []
    last_pkg = None
    for name, ver, toml_path in iter_packages():
        try:
            data = read_toml(toml_path)
            desc = data.get('description', '')[:60]
        except Exception:
            desc = '(parse error)'
        marker = '└─' if name == last_pkg else name
        rows.append((name, ver, desc))
        last_pkg = name

    if not rows:
        print('No packages found in', PKG_DIR)
        return

    col1 = max(len(r[0]) for r in rows) + 2
    col2 = max(len(r[1]) for r in rows) + 2
    print(f"{'PACKAGE':<{col1}} {'VERSION':<{col2}} DESCRIPTION")
    print('─' * 80)
    for name, ver, desc in rows:
        print(f'{name:<{col1}} {ver:<{col2}} {desc}')


def cmd_validate(_args):
    _check_pkg_dir()
    found_errors = False
    for name, ver, toml_path in iter_packages():
        errors = validate_package(name, ver, toml_path)
        if errors:
            found_errors = True
            print(f'[FAIL] {name}/{ver}')
            for e in errors:
                print(f'       • {e}')
        else:
            print(f'[ OK ] {name}/{ver}')

    if found_errors:
        sys.exit(1)


def cmd_sync(args):
    _check_pkg_dir()
    branch   = getattr(args, 'branch', None) or None
    resolved = branch or _detect_branch()
    registry = build_registry(branch=resolved)
    out_path = PKG_DIR / 'packages.json'
    out_path.write_text(json.dumps(registry, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    n = len(registry['packages'])
    print(f'[ok] Wrote packages.json ({n} package{"s" if n != 1 else ""}) — branch: {resolved}')


def cmd_new(args):
    scaffold_new(
        name        = args.name,
        version     = args.version,
        description = args.desc or f'{args.name} package',
        arduino_lib = args.lib or args.name,
        cpp_header  = args.header or f'{args.name}.h',
    )
    cmd_sync(args)


def cmd_add_example(args):
    ver = args.version
    if not ver.startswith('v'):
        ver = f'v{ver}'
    ver = ver  # already prefixed
    scaffold_example(args.pkg, args.version, args.example_name)


def cmd_bump(args):
    bump_version(args.pkg, args.new_version)
    cmd_sync(args)


# ── CLI ───────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='tsuki pkg manager',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=textwrap.dedent("""\
            Examples:
              python pkg_manager.py list
              python pkg_manager.py validate
              python pkg_manager.py sync                        # auto-detects branch from git
              python pkg_manager.py sync --branch dev           # force a specific branch
              python pkg_manager.py new max7219 --desc "MAX7219 LED matrix" --lib "MD_MAX72XX"
              python pkg_manager.py add-example dht dual_dht22
              python pkg_manager.py bump ws2812 1.1.0

            Branch resolution order:
              1. --branch flag
              2. TSUKI_BRANCH env var
              3. git rev-parse --abbrev-ref HEAD  (auto-detected)
              4. 'main' fallback
        """),
    )
    sub = parser.add_subparsers(dest='cmd', required=True)

    # ── branch flag shared by commands that call build_registry ───────────────
    branch_flag = argparse.ArgumentParser(add_help=False)
    branch_flag.add_argument(
        '--branch',
        default='',
        metavar='BRANCH',
        help='GitHub branch to embed in package URLs (default: auto-detect from git)',
    )

    sub.add_parser('list',     help='List all packages and versions')
    sub.add_parser('validate', help='Validate package structure')
    sub.add_parser('sync',     help='Rebuild packages.json from disk',
                   parents=[branch_flag])

    p_new = sub.add_parser('new', help='Scaffold a new package',
                            parents=[branch_flag])
    p_new.add_argument('name')
    p_new.add_argument('--version', default='1.0.0')
    p_new.add_argument('--desc',   default='')
    p_new.add_argument('--lib',    default='')
    p_new.add_argument('--header', default='')

    p_ex = sub.add_parser('add-example', help='Add a new example to an existing package')
    p_ex.add_argument('pkg')
    p_ex.add_argument('example_name')
    p_ex.add_argument('--version', default='1.0.0')

    p_bump = sub.add_parser('bump', help='Bump package version (copies current → new version)',
                             parents=[branch_flag])
    p_bump.add_argument('pkg')
    p_bump.add_argument('new_version')

    args = parser.parse_args()
    dispatch = {
        'list':        cmd_list,
        'validate':    cmd_validate,
        'sync':        cmd_sync,
        'new':         cmd_new,
        'add-example': cmd_add_example,
        'bump':        cmd_bump,
    }
    dispatch[args.cmd](args)


if __name__ == '__main__':
    main()