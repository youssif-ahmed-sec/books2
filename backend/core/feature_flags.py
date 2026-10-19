"""Optional warehouse handoff gate."""

import os

from fastapi import HTTPException


def warehouse_only_mode() -> bool:
    return os.getenv("BOOKS2_WAREHOUSE_ONLY", "0") == "1"


def require_full_mode() -> None:
    if warehouse_only_mode():
        raise HTTPException(status_code=404, detail="Feature is temporarily unavailable")
