"""Optional Windows integration test; compiles a tiny disposable loopback agent."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from unittest.mock import patch
from urllib.request import urlopen

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "updater"))
import core

SOURCE = r'''
#include <winsock2.h>
#include <windows.h>
int main(void) {
 WSADATA w; SOCKET s,c; struct sockaddr_in a; char buf[1024];
 WSAStartup(MAKEWORD(2,2), &w); s=socket(AF_INET,SOCK_STREAM,IPPROTO_TCP);
 a.sin_family=AF_INET; a.sin_port=htons(19877); a.sin_addr.s_addr=htonl(INADDR_LOOPBACK);
 if(bind(s,(struct sockaddr*)&a,sizeof(a)) || listen(s,5)) return 2;
 for (;;) { c=accept(s,0,0); if(c==INVALID_SOCKET) break; recv(c,buf,sizeof(buf),0);
  const char *r="HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 43\r\nConnection: close\r\n\r\n{\"ok\":true,\"service\":\"topchef-print-agent\"}";
  send(c,r,(int)strlen(r),0); closesocket(c); }
 closesocket(s); WSACleanup(); return 0;
}
'''

@pytest.mark.skipif(sys.platform != "win32" or not shutil.which("gcc"), reason="Windows and gcc required")
def test_real_process_is_replaced_and_started(tmp_path):
    source = tmp_path / "agent.c"
    source.write_text('#include <string.h>\n' + SOURCE)
    old = tmp_path / core.AGENT_NAME
    payload = tmp_path / "payload.exe"
    for dest in (old, payload):
        subprocess.run(["gcc", str(source), "-o", str(dest), "-lws2_32"], check=True, capture_output=True)
    # Make payload independently verifiable without changing its executable behavior.
    with payload.open("ab") as f:
        f.write(b"NEW")
    settings_dir = tmp_path / "profile" / "SouodElShafiePrintAgent"
    settings_dir.mkdir(parents=True)
    settings = settings_dir / "settings.json"
    settings.write_text(json.dumps({"local_port": 19877, "receipt_printer_names": ["test-printer"]}))
    before = settings.read_bytes()
    old_process = subprocess.Popen([str(old)], creationflags=subprocess.CREATE_NO_WINDOW)
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                with urlopen("http://127.0.0.1:19877/api/health", timeout=1):
                    break
            except OSError:
                if time.monotonic() >= deadline:
                    raise
                time.sleep(.1)
        with patch.dict(os.environ, {"LOCALAPPDATA": str(tmp_path / "profile")}):
            backup = core.update(old, payload, core.sha256(payload))
        assert backup.read_bytes().endswith(b"NEW") is False
        assert core.sha256(old) == core.sha256(payload)
        assert settings.read_bytes() == before
        assert old_process.poll() is not None
        assert core.matching_processes(old)
    finally:
        for process in core.matching_processes(old):
            process.terminate()
        old_process.wait(timeout=5)
