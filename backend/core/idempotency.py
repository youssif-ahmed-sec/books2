import hashlib
import json

from pydantic import BaseModel


class IdempotencyConflict(ValueError):
    pass


def request_fingerprint(payload: BaseModel, *, exclude: set[str] | None = None) -> str:
    data = payload.model_dump(mode="json", exclude={"request_id"} | (exclude or set()))
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
