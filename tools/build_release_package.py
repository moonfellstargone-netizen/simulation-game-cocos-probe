#!/usr/bin/env python3
"""Build a clean UTF-8 release zip from a staging copy.

This script is intentionally limited to delivery packaging. It does not modify
runtime code, formal design snapshots, schemas, or gameplay logic.
"""
from __future__ import annotations

import argparse
import json
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

DEFAULT_PROJECT_TARGET_PATH = 'tools/quality/rules/project-target.json'
DEFAULT_SOURCE_ROOT = '.'
DEFAULT_KIND = 'code'
# Release root and zip names are derived from project-target.json (release.root / release.zip);
# no versioned default root is assigned in code here.
# release-surface marker (non-authoritative, must mirror project-target release root/zip):
#   模拟游戏_Cocos微信试水代码包_v0_0_2_34 / 模拟游戏_Cocos微信试水代码包_v0_0_2_34.zip


def load_project_target(path: Path) -> dict:
    if not path.is_file():
        print(f'project target file not found: {path}', file=sys.stderr)
        raise SystemExit(2)
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except json.JSONDecodeError as exc:
        print(f'project target is not valid JSON: {path}: {exc}', file=sys.stderr)
        raise SystemExit(2)


def release_from_target(project_target: dict) -> tuple[str, str]:
    release = project_target.get('release') or {}
    root = release.get('root')
    zip_name = release.get('zip')
    if not root or not zip_name:
        print('project target release.root and release.zip are required', file=sys.stderr)
        raise SystemExit(2)
    return str(root), str(zip_name)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description='Build a clean UTF-8 release zip.')
    parser.add_argument('--source-root', default=DEFAULT_SOURCE_ROOT, help='Directory whose contents should be packaged.')
    parser.add_argument('--project-target', default=DEFAULT_PROJECT_TARGET_PATH, help='Project target JSON for release root/zip authority.')
    parser.add_argument('--root-name', default=None, help='Root directory name inside the zip.')
    parser.add_argument('--output', default=None, help='Output zip path.')
    parser.add_argument('--kind', choices=['code', 'logs'], default=DEFAULT_KIND, help='Package kind for hygiene policy.')
    return parser.parse_args()


def resolve_release_args(args: argparse.Namespace) -> tuple[str, Path]:
    target_path = Path(args.project_target)
    if not target_path.is_absolute():
        target_path = (Path(args.source_root).resolve() / target_path).resolve()
    project_target = load_project_target(target_path)
    target_root, target_zip = release_from_target(project_target)

    root_name = args.root_name if args.root_name is not None else target_root
    if args.root_name is not None and args.root_name != target_root:
        print(
            f'conflicting release root: --root-name {args.root_name!r} != project-target release.root {target_root!r}',
            file=sys.stderr,
        )
        raise SystemExit(2)

    default_output = Path('..') / target_zip
    output = Path(args.output) if args.output is not None else default_output
    if args.output is not None:
        expected_output = (Path('..') / target_zip).resolve()
        actual_output = output.resolve()
        if actual_output != expected_output:
            print(
                f'conflicting release output: --output {output} != project-target release.zip ../{target_zip}',
                file=sys.stderr,
            )
            raise SystemExit(2)

    return root_name, output


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
    root_name, output = resolve_release_args(args)
    output = output.resolve()
    if not source_root.is_dir():
        print(f'source root does not exist or is not a directory: {source_root}', file=sys.stderr)
        return 2
    if not root_name or '/' in root_name or '\\' in root_name:
        print(f'root name must be a single directory name: {root_name!r}', file=sys.stderr)
        return 2

    with tempfile.TemporaryDirectory(prefix='qinglan_release_staging_') as temp_dir:
        staging_root = Path(temp_dir) / root_name
        staging_root.mkdir(parents=True, exist_ok=True)
        copy_clean_tree(source_root, staging_root, args.kind)
        build_zip(staging_root, output)

    print(f'built release zip: {output}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
