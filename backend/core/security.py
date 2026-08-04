import os
import jwt
from datetime import datetime, timedelta, timezone
import bcrypt

# ── Config ──────────────────────────────────────────────
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "CHANGE_ME_IN_PRODUCTION_USE_A_LONG_RANDOM_STRING")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

def hash_password(plain: str) -> str:
    # bcrypt requires bytes
    pwd_bytes = plain.encode('utf-8')
    if len(pwd_bytes) > 72:
        pwd_bytes = pwd_bytes[:72]
    salt = bcrypt.gensalt()
    hashed_bytes = bcrypt.hashpw(pwd_bytes, salt)
    return hashed_bytes.decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    pwd_bytes = plain.encode('utf-8')
    if len(pwd_bytes) > 72:
        # FastAPI's old passlib implementation truncated to 72 bytes.
        # We do the same to remain compatible.
        pwd_bytes = pwd_bytes[:72]
        
    hashed_bytes = hashed.encode('utf-8')
    try:
        return bcrypt.checkpw(pwd_bytes, hashed_bytes)
    except ValueError:
        return False


# ── JWT ─────────────────────────────────────────────────
def create_access_token(subject: str, extra_claims: dict = None) -> str:
    """Create a signed JWT token with the given subject (user_id as string)."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": subject,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    if extra_claims:
        payload.update(extra_claims)
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """
    Decode and verify a JWT token.
    Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError on failure.
    """
    return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
