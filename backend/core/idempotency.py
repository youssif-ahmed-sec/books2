import hashlib
import json

from pydantic import BaseModel


class IdempotencyConflict(ValueError):
    pass


def request_fingerprint(payload: BaseModel) -> str:
    data = payload.model_dump(mode="json", exclude={"request_id"})
    encoded = json.dumps(data, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()
