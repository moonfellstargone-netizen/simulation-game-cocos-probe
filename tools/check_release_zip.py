#!/usr/bin/env python3
"""Validate release zip path encoding, UTF-8 metadata, root name and hygiene."""
from __future__ import annotations

import argparse
import sys
from pathlib import PurePosixPath
from zipfile import BadZipFile, ZipFile

UTF8_FLAG = 0x800
MOJIBAKE_SENTINELS = set('µσΣτΦ╕╛╜╛╚╔╩╦╬╠═║╗╝┐└┘┌┬┴┼─│áü')
FORBIDDEN_DIR_NAMES = {'__pycache__', 'node_modules', 'dist', 'coverage', '.cache'}
FORBIDDEN_FILE_NAMES = {'.DS_Store'}
FORBIDDEN_SUFFIXES = {'.pyc', '.pyo'}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Check release zip encoding and hygiene.')
    parser.add_argument('zip_path', help='Release zip path to check.')
    parser.add_argument('--expected-root', required=True, help='Expected single root directory inside the zip.')
    parser.add_argument('--kind', choices=['code', 'logs'], default='code', help='Package kind for log-artifact policy.')
    return parser.parse_args()


def has_non_ascii(text: str) -> bool:
    return any(ord(ch) > 127 for ch in text)


def looks_like_mojibake(name: str) -> bool:
    if any(ch in MOJIBAKE_SENTINELS for ch in name):
        return True
    try:
        recovered = name.encode('cp437').decode('utf-8')
    except (UnicodeEncodeError, UnicodeDecodeError):
        return False
    return recovered != name and any('\u4e00' <= ch <= '\u9fff' for ch in recovered)


def check_path_safety(name: str) -> str | None:
    path = PurePosixPath(name)
    if name.startswith('/') or name.startswith('\\'):
        return 'absolute path is forbidden'
    if any(part in {'..', ''} for part in path.parts if part != '/'):
        return 'empty or parent path segment is forbidden'
    return None


def check_hygiene(name: str, kind: str) -> str | None:
    stripped = name.rstrip('/')
    parts = stripped.split('/') if stripped else []
    if any(part in FORBIDDEN_DIR_NAMES for part in parts):
        return 'generated/cache/build directory is forbidden'
    leaf = parts[-1] if parts else ''
    if leaf in FORBIDDEN_FILE_NAMES:
        return 'system metadata file is forbidden'
    if any(leaf.endswith(suffix) for suffix in FORBIDDEN_SUFFIXES):
        return 'compiled Python cache is forbidden'
    if leaf.endswith('.log'):
        return 'log artifact file is forbidden'
    if kind == 'code':
        if parts[:3] == [parts[0], 'reports', 'quality'] or parts[:2] == ['reports', 'quality']:
            return 'temporary quality report directory is forbidden inside code package'
        if any(part == 'logs' or part.endswith('_logs') for part in parts):
            return 'development log directory is forbidden inside code package'
        if any('开发日志包' in part or '开发记录' in part for part in parts):
            return 'development log content is forbidden inside code package'
    return None


def main() -> int:
    args = parse_args()
    violations: list[str] = []
    try:
        with ZipFile(args.zip_path) as archive:
            infos = archive.infolist()
            if not infos:
                violations.append('zip is empty')
                infos = []
            roots = set()
            for info in infos:
                name = info.filename
                roots.add(name.split('/', 1)[0])
                if has_non_ascii(name) and not (info.flag_bits & UTF8_FLAG):
                    violations.append(f'{name}: UTF-8 flag is not set')
                if looks_like_mojibake(name):
                    violations.append(f'{name}: path looks like mojibake')
                safety = check_path_safety(name)
                if safety:
                    violations.append(f'{name}: {safety}')
                if not (name == args.expected_root + '/' or name.startswith(args.expected_root + '/')):
                    violations.append(f'{name}: outside expected root {args.expected_root}/')
                hygiene = check_hygiene(name, args.kind)
                if hygiene:
                    violations.append(f'{name}: {hygiene}')
            if roots != {args.expected_root}:
                violations.append(f'zip must contain exactly one root {args.expected_root!r}, got {sorted(roots)!r}')
    except BadZipFile as exc:
        violations.append(f'bad zip file: {exc}')
    except FileNotFoundError:
        violations.append(f'zip file not found: {args.zip_path}')

    if violations:
        print('release zip check failed:')
        for violation in sorted(set(violations)):
            print(f' - {violation}')
        return 1
    print(f'release zip check passed: {args.zip_path}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
