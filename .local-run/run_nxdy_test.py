"""Run the local app only against the confirmed nxdy test project."""

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import dotenv_values


backend = Path(__file__).resolve().parents[1] / "backend"
settings = dotenv_values(backend / ".env")
url = settings.get("DATABASE_URL") or ""
target = urlsplit(url)
if not (
    target.hostname == "aws-0-eu-west-1.pooler.supabase.com"
    and target.username == "postgres.nxdyxkvqiamjodmnetvs"
    and target.port == 6543
    and "htdudqglmohxikoiqbdq" not in url
):
    raise RuntimeError("Refusing to start on an unexpected database")

os.environ.update({key: value for key, value in settings.items() if value is not None})
os.environ["DATABASE_SSL_CA_CERT"] = str(backend / "certs" / "supabase-root-2021.crt")
os.environ["DATABASE_SSL_ALLOW_LEGACY_CA"] = "1"
os.chdir(backend)
sys.path.insert(0, str(backend))

import uvicorn  # noqa: E402

uvicorn.run("main:app", host="127.0.0.1", port=8000, log_level="warning")
