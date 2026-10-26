import json
import os
import sys
from pathlib import Path
from threading import RLock


def _base_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(os.environ.get("LOCALAPPDATA", Path(sys.executable).parent)) / "SouodElShafiePrintAgent"
    return Path(__file__).resolve().parent


BASE_DIR = _base_dir()
BASE_DIR.mkdir(parents=True, exist_ok=True)
SETTINGS_PATH = BASE_DIR / "settings.json"
LOGS_DIR = BASE_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)

DEFAULTS = {
    "local_port": 8199,
    "receipt_printer_names": [],
    "barcode_printer_names": [],
    "allowed_origins": [
        "https://elshafie-library.fastapicloud.dev"
    ],
    "printer_width_mm": 80,
}


class PrintAgentConfig:
    def __init__(self):
        self._lock = RLock()
        self._data = {}
        self.load()

    def load(self):
        with self._lock:
            try:
                value = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
                self._data = value if isinstance(value, dict) else {}
                if "receipt_printer_names" not in self._data and isinstance(self._data.get("printer_names"), list):
                    self._data["receipt_printer_names"] = list(self._data["printer_names"])
            except (OSError, json.JSONDecodeError):
                self._data = {}

    def save(self) -> bool:
        with self._lock:
            temp_path = SETTINGS_PATH.with_suffix(".json.tmp")
            try:
                temp_path.write_text(
                    json.dumps(self.all(), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                os.replace(temp_path, SETTINGS_PATH)
                return True
            except OSError:
                temp_path.unlink(missing_ok=True)
                return False

    def get(self, key, fallback=None):
        return self._data.get(key, DEFAULTS.get(key, fallback))

    def set(self, key, value):
        with self._lock:
            self._data[key] = value

    def all(self):
        return {**DEFAULTS, **self._data}

    @property
    def local_port(self) -> int:
        return int(self.get("local_port"))

    @property
    def receipt_printer_names(self) -> list[str]:
        # Existing installations stored one shared list. Keep it for receipts only.
        names = self._data.get("receipt_printer_names", self._data.get("printer_names", []))
        return [str(name) for name in names] if isinstance(names, list) else []

    @property
    def barcode_printer_names(self) -> list[str]:
        names = self.get("barcode_printer_names", [])
        return [str(name) for name in names] if isinstance(names, list) else []

    @property
    def allowed_origins(self) -> list[str]:
        values = self.get("allowed_origins", [])
        return [str(value) for value in values] if isinstance(values, list) else []

    def printers_for(self, receipt_type: str) -> list[str]:
        return self.barcode_printer_names if receipt_type == "barcode" else self.receipt_printer_names

    @property
    def printer_width_mm(self) -> int:
        return int(self.get("printer_width_mm"))


config = PrintAgentConfig()
