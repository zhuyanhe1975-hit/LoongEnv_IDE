from __future__ import annotations

import os
import sys
from pathlib import Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def project_venv_python() -> Path:
    return project_root() / ".venv-backend" / "Scripts" / "python.exe"


def _candidate_site_packages() -> list[Path]:
    raw = os.environ.get("LOONGENV_BACKEND_SITE_PACKAGES", "")
    return [Path(chunk) for chunk in raw.split(os.pathsep) if chunk.strip()]


def _candidate_cuda_dll_dirs() -> list[Path]:
    raw = os.environ.get("LOONGENV_CUDA_DLL_DIRS", "")
    configured = [Path(chunk) for chunk in raw.split(os.pathsep) if chunk.strip()]
    defaults = [
        Path(r"C:\isaacsim\exts\omni.isaac.ml_archive\pip_prebundle\torch\lib"),
    ]
    return configured + defaults


def inject_backend_site_packages() -> None:
    for site_packages in reversed(_candidate_site_packages()):
        if site_packages.exists():
            site_packages_text = str(site_packages)
            if site_packages_text not in sys.path:
                sys.path.insert(0, site_packages_text)


def inject_cuda_runtime_dlls() -> None:
    known_path = os.environ.get("PATH", "")
    path_entries = known_path.split(os.pathsep) if known_path else []
    for dll_dir in _candidate_cuda_dll_dirs():
        if not dll_dir.exists():
            continue
        dll_dir_text = str(dll_dir)
        if hasattr(os, "add_dll_directory"):
            try:
                os.add_dll_directory(dll_dir_text)
            except OSError:
                pass
        if dll_dir_text not in path_entries:
            path_entries.insert(0, dll_dir_text)
    os.environ["PATH"] = os.pathsep.join(path_entries)
