"""Test replacement and rollback only in pytest temporary directories."""
from pathlib import Path
import sys
from unittest.mock import patch
import pytest
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "updater"))
import core

@pytest.fixture
def paths(tmp_path):
    target = tmp_path / core.AGENT_NAME
    payload = tmp_path / "new.exe"
    target.write_bytes(b"MZold-version")
    payload.write_bytes(b"MZnew-version")
    return target, payload, core.sha256(payload)

def test_success_preserves_original_backup(paths):
    target, payload, digest = paths
    with patch.object(core, "configured_port", return_value=8199), patch.object(core, "stop_agent", return_value=True), patch.object(core, "ensure_port_free"), patch.object(core, "start_and_verify") as start:
        backup = core.update(target, payload, digest)
    assert target.read_bytes() == b"MZnew-version"
    assert backup.read_bytes() == b"MZold-version"
    start.assert_called_once_with(target.resolve(), 8199)

def test_failed_new_start_restores_old_and_restarts(paths):
    target, payload, digest = paths
    with patch.object(core, "configured_port", return_value=8199), patch.object(core, "stop_agent", return_value=True), patch.object(core, "ensure_port_free"), patch.object(core, "start_and_verify", side_effect=[core.UpdateError("no response"), None]) as start:
        with pytest.raises(core.UpdateError, match="استعادة النسخة السابقة"):
            core.update(target, payload, digest)
    assert target.read_bytes() == b"MZold-version"
    assert start.call_count == 2

def test_wrong_filename_or_corrupt_payload_never_stops_process(paths, tmp_path):
    target, payload, digest = paths
    wrong = tmp_path / "unrelated.exe"
    wrong.write_bytes(b"MZunrelated")
    with patch.object(core, "stop_agent") as stop:
        with pytest.raises(core.UpdateError):
            core.update(wrong, payload, digest)
        with pytest.raises(core.UpdateError, match="تالف"):
            core.update(target, payload, "bad-digest")
    stop.assert_not_called()
    assert target.read_bytes() == b"MZold-version"
    assert wrong.read_bytes() == b"MZunrelated"

def test_busy_port_restarts_unmodified_original(paths):
    target, payload, digest = paths
    with patch.object(core, "configured_port", return_value=8199), patch.object(core, "stop_agent", return_value=True), patch.object(core, "ensure_port_free", side_effect=core.UpdateError("busy")), patch.object(core, "start_and_verify") as start:
        with pytest.raises(core.UpdateError, match="busy"):
            core.update(target, payload, digest)
    assert target.read_bytes() == b"MZold-version"
    start.assert_called_once_with(target.resolve(), 8199)
