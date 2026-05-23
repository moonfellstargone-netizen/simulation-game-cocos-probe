#!/usr/bin/env python3
"""Build a clean UTF-8 release zip from a staging copy.

This script is intentionally limited to delivery packaging. It does not modify
runtime code, formal design snapshots, schemas, or gameplay logic.
"""
from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
from pathlib import Path, PurePosixPath
from zipfile import ZIP_DEFLATED, ZipFile

FORBIDDEN_DIR_NAMES = {
    '__pycache__',
    'node_modules',
    'dist',
    'coverage',
    '.cache',
    '.git',
    '.idea',
    '.vscode',
}
FORBIDDEN_FILE_NAMES = {'.DS_Store'}
FORBIDDEN_SUFFIXES = {'.pyc', '.pyo'}
FORBIDDEN_SOURCE_ARTIFACT_SUFFIXES = {'.log'}
QUALITY_REPORT_DIR = 'reports/quality'

DEFAULT_CODE_ROOT = '模拟游戏_Cocos微信试水代码包_v0_0_2_22'
DEFAULT_OUTPUT = '模拟游戏_Cocos微信试水代码包_v0_0_2_22.zip'


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build a clean UTF-8 release zip.')
    parser.add_argument('--source-root', default='.', help='Directory whose contents should be packaged.')
    parser.add_argument('--root-name', default=DEFAULT_CODE_ROOT, help='Root directory name inside the zip.')
    parser.add_argument('--output', default=f'../{DEFAULT_OUTPUT}', help='Output zip path.')
    parser.add_argument('--kind', choices=['code', 'logs'], default='code', help='Package kind for hygiene policy.')
    return parser.parse_args()


def normalized_rel(path: Path, root: Path) -> str:
    return path.relative_to(root).as_posix()


def is_forbidden(path: Path, source_root: Path, kind: str) -> str | None:
    rel = normalized_rel(path, source_root)
    parts = rel.split('/') if rel else []
    if any(part in FORBIDDEN_DIR_NAMES for part in parts):
        return 'generated/cache/build directory'
    if path.name in FORBIDDEN_FILE_NAMES:
        return 'system metadata file'
    if path.is_file() and path.suffix in FORBIDDEN_SUFFIXES:
        return 'compiled Python cache'
    if path.is_file() and path.suffix in FORBIDDEN_SOURCE_ARTIFACT_SUFFIXES:
        return 'log artifact'
    if kind == 'code':
        if parts[:2] == ['reports', 'quality']:
            return 'temporary quality report inside code package'
        if '_logs' in parts or any('开发日志包' in part or '开发记录' in part for part in parts):
            return 'development log artifact inside code package'
    return None


def copy_clean_tree(source_root: Path, staging_root: Path, kind: str) -> None:
    def copy_dir(current: Path) -> None:
        for path in current.iterdir():
            reason = is_forbidden(path, source_root, kind)
            if reason and path.is_dir():
                continue
            if reason and path.is_file():
                continue
            rel = path.relative_to(source_root)
            target = staging_root / rel
            if path.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                copy_dir(path)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, target)

    copy_dir(source_root)


def iter_zip_paths(staged_root: Path):
    yield staged_root, PurePosixPath(staged_root.name).as_posix() + '/'
    for path in sorted(staged_root.rglob('*'), key=lambda p: p.relative_to(staged_root).as_posix()):
        rel = PurePosixPath(staged_root.name) / PurePosixPath(path.relative_to(staged_root).as_posix())
        arcname = rel.as_posix() + ('/' if path.is_dir() else '')
        yield path, arcname


def build_zip(staged_root: Path, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()
    with ZipFile(output, 'w', compression=ZIP_DEFLATED) as archive:
        for path, arcname in iter_zip_paths(staged_root):
            archive.write(path, arcname)


def main() -> int:
    args = parse_args()
    source_root = Path(args.source_root).resolve()
    output = Path(args.output).resolve()
    if not source_root.is_dir():
        print(f'source root does not exist or is not a directory: {source_root}', file=sys.stderr)
        return 2
    if not args.root_name or '/' in args.root_name or '\\' in args.root_name:
        print(f'root name must be a single directory name: {args.root_name!r}', file=sys.stderr)
        return 2

    # Local generated directories such as node_modules/ may exist after npm ci.
    # They are skipped when copying into staging; the final zip checker verifies
    # that none of them entered the delivery archive. Source-tree pollution is
    # still checked separately by validate_code_architecture.py and
    # tests/package-hygiene.test.mjs.
    with tempfile.TemporaryDirectory(prefix='qinglan_release_staging_') as temp_dir:
        staging_root = Path(temp_dir) / args.root_name
        staging_root.mkdir(parents=True, exist_ok=True)
        copy_clean_tree(source_root, staging_root, args.kind)
        build_zip(staging_root, output)

    print(f'built release zip: {output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
