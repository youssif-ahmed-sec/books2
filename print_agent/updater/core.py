"""Replace the user-selected print agent while preserving settings and rollback."""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from urllib.error import URLError
from urllib.request import urlopen

import psutil

AGENT_NAME = "SouodElShafiePrintAgent.exe"


class UpdateError(Exception):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_target(target: Path, payload: Path) -> Path:
    target = target.expanduser().resolve(strict=True)
    if target.name.casefold() != AGENT_NAME.casefold() or not target.is_file():
        raise UpdateError("اختر ملف برنامج الطباعة القديم باسمه الأصلي.")
    if target == payload.resolve():
        raise UpdateError("اختر نسخة البرنامج القديمة، وليس ملف التحديث.")
    with target.open("rb") as stream:
        if stream.read(2) != b"MZ":
            raise UpdateError("الملف المختار ليس برنامج Windows صالحًا.")
    return target


def matching_processes(target: Path) -> list[psutil.Process]:
    matches = []
    for process in psutil.process_iter(["pid", "name"]):
        try:
            if (process.info["name"] or "").casefold() != AGENT_NAME.casefold():
                continue
            path = process.exe()
            if not path:
                raise UpdateError("تعذر التحقق من مسار برنامج الطباعة المفتوح.")
            if os.path.normcase(os.path.realpath(path)) != os.path.normcase(str(target)):
                raise UpdateError("توجد نسخة أخرى من برنامج الطباعة مفتوحة في مسار مختلف. أغلقها أولًا.")
            matches.append(process)
        except psutil.NoSuchProcess:
            continue
        except psutil.AccessDenied as exc:
            raise UpdateError("تعذر التحقق من برنامج الطباعة المفتوح. أغلقه ثم أعد المحاولة.") from exc
    return matches


def stop_agent(target: Path) -> bool:
    processes = matching_processes(target)
    # A one-file PyInstaller process can have a parent and a child with the same executable.
    for process in processes:
        try:
            process.terminate()
        except psutil.NoSuchProcess:
            pass
        except psutil.AccessDenied as exc:
            raise UpdateError("تعذر إغلاق برنامج الطباعة. أغلقه وأعد المحاولة.") from exc
    _, alive = psutil.wait_procs(processes, timeout=12)
    if alive:
        raise UpdateError("لم يغلق برنامج الطباعة. أغلقه وأعد المحاولة.")
    return bool(processes)


def configured_port() -> int:
    settings = Path(os.environ.get("LOCALAPPDATA", "")) / "SouodElShafiePrintAgent" / "settings.json"
    try:
        data = json.loads(settings.read_text(encoding="utf-8"))
        port = int(data.get("local_port", 8199))
        if not 1 <= port <= 65535:
            raise ValueError("invalid port")
        return port
    except FileNotFoundError:
        return 8199
    except (OSError, ValueError, TypeError, AttributeError) as exc:
        raise UpdateError("تعذرت قراءة إعدادات برنامج الطباعة؛ لم يتم تعديلها.") from exc


def ensure_port_free(port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as exc:
            raise UpdateError("منفذ برنامج الطباعة مشغول. أغلق البرنامج الآخر وأعد المحاولة.") from exc


def start_and_verify(target: Path, port: int) -> None:
    process = subprocess.Popen([str(target)], cwd=str(target.parent),
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise UpdateError("برنامج الطباعة الجديد لم يستمر في التشغيل.")
        try:
            with urlopen(f"http://127.0.0.1:{port}/api/health", timeout=1) as response:
                result = json.load(response)
            if result.get("ok") is True and result.get("service") == "topchef-print-agent":
                return
        except (OSError, URLError, ValueError):
            pass
        time.sleep(0.5)
    raise UpdateError("لم يستجب برنامج الطباعة الجديد بعد التحديث.")


def update(target: Path, payload: Path, expected_hash: str) -> Path:
    target = validate_target(target, payload)
    if sha256(payload) != expected_hash:
        raise UpdateError("ملف التحديث غير مكتمل أو تالف.")
    port = configured_port()
    backup_dir = target.parent / "SouodElShafiePrintAgent-backups"
    backup_dir.mkdir(exist_ok=True)
    # Exclusive creation preserves earlier backups, even across rapid repeat attempts.
    with tempfile.NamedTemporaryFile(prefix="agent-", suffix=".exe", dir=backup_dir, delete=False) as stream:
        backup = Path(stream.name)
        with target.open("rb") as original:
            shutil.copyfileobj(original, stream)
    if sha256(backup) != sha256(target):
        raise UpdateError("تعذر التحقق من النسخة الاحتياطية؛ لم يُستبدل البرنامج.")
    with tempfile.NamedTemporaryFile(prefix=".agent-update-", suffix=".tmp", dir=target.parent, delete=False) as stream:
        staged = Path(stream.name)
        with payload.open("rb") as source:
            shutil.copyfileobj(source, stream)
    try:
        if sha256(staged) != expected_hash:
            raise UpdateError("تعذر التحقق من ملف التحديث؛ لم يُستبدل البرنامج.")
        was_running = stop_agent(target)
        try:
            ensure_port_free(port)
            os.replace(staged, target)
        except Exception:
            if was_running:
                try:
                    start_and_verify(target, port)
                except Exception as restart_error:
                    raise UpdateError(f"لم يكتمل التحديث وتعذر إعادة تشغيل البرنامج القديم. النسخة الاحتياطية: {backup}") from restart_error
            raise
        try:
            if sha256(target) != expected_hash:
                raise UpdateError("تعذر التحقق من النسخة المستبدلة.")
            start_and_verify(target, port)
        except Exception as exc:
            try:
                stop_agent(target)
                shutil.copy2(backup, target)
                start_and_verify(target, port)
            except Exception as rollback_error:
                raise UpdateError(f"فشل التحديث وتعذر تشغيل النسخة السابقة تلقائيًا. النسخة الاحتياطية: {backup}") from rollback_error
            raise UpdateError("فشل تشغيل النسخة الجديدة؛ تمت استعادة النسخة السابقة وتشغيلها.") from exc
        return backup
    finally:
        staged.unlink(missing_ok=True)
