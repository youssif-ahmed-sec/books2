import logging
import os
import sys
import threading
import time
import webbrowser
from contextlib import asynccontextmanager
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

from print_agent.config import LOGS_DIR, config
from print_agent.printer import thermal_printer


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    handlers=[
        logging.FileHandler(LOGS_DIR / "print-agent.log", encoding="utf-8"),
        logging.StreamHandler(),
    ],
)
log = logging.getLogger("souod_el_shafie_print_agent")
_instance_mutex = None


def claim_single_instance() -> bool:
    """Keep a second launch from trying to bind the same local port."""
    global _instance_mutex
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return True
    import ctypes

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, ctypes.c_bool, ctypes.c_wchar_p]
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, False, "Local\\SouodElShafiePrintAgent")
    if not handle:
        log.error("Could not create the single-instance mutex: %s", ctypes.get_last_error())
        return False
    if ctypes.get_last_error() == 183:  # ERROR_ALREADY_EXISTS
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle(handle)
        return False
    _instance_mutex = handle
    return True


def ensure_windows_autostart() -> bool:
    """Register the installed agent for the current Windows user."""
    if sys.platform != "win32" or not getattr(sys, "frozen", False):
        return False
    try:
        import winreg

        command = f'"{sys.executable}"'
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Run",
            0,
            winreg.KEY_SET_VALUE,
        ) as key:
            winreg.SetValueEx(key, "SouodElShafiePrintAgent", 0, winreg.REG_SZ, command)
        return True
    except OSError as exc:
        log.warning("Could not register Windows autostart: %s", exc)
        return False


def open_settings_on_first_launch(server: uvicorn.Server, url: str) -> None:
    """Open setup only after this instance is serving its local page."""
    for _ in range(60):
        if server.started:
            break
        if server.should_exit:
            return
        time.sleep(0.25)
    else:
        log.warning("The settings page did not become available on first launch")
        return

    try:
        if webbrowser.open(url, new=2):
            config.set("browser_opened_once", True)
            if not config.save():
                log.warning("Could not remember that the settings page was opened")
        else:
            log.warning("Could not open the settings page in a browser")
    except Exception:
        log.exception("Could not open the settings page in a browser")


class PrinterSettings(BaseModel):
    receipt_printer_names: list[str]
    barcode_printer_names: list[str]
    printer_width_mm: int = Field(default=80, ge=58, le=80)


class PrintJob(BaseModel):
    order: dict
    receipt_type: str = "customer"


@asynccontextmanager
async def lifespan(_app: FastAPI):
    thermal_printer.start()
    yield

app = FastAPI(title="Saud El Shafie Print Agent", version="1.0.0", lifespan=lifespan)

@app.middleware("http")
async def custom_cors_middleware(request: Request, call_next):
    origin = request.headers.get("origin")
    allowed_origins = {
        f"http://127.0.0.1:{config.local_port}",
        f"http://localhost:{config.local_port}",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:8000",
        "http://localhost:8000",
    }
    allowed_origins.update(
        value.strip().rstrip("/")
        for value in os.getenv("PRINT_AGENT_ALLOWED_ORIGINS", "").split(",")
        if value.strip()
    )
    if origin and origin not in allowed_origins:
        return Response(status_code=403)
    if request.method == "OPTIONS":
        response = Response(content="OK", status_code=200)
        if origin:
            response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, Accept"
        response.headers["Access-Control-Allow-Private-Network"] = "true"
        response.headers["Access-Control-Max-Age"] = "86400"
        return response
    
    response = await call_next(request)
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


@app.middleware("http")
async def local_only(request: Request, call_next):
    client_host = request.client.host if request.client else ""
    if client_host not in {"127.0.0.1", "::1", "localhost", "testclient"}:
        return Response(status_code=403)
    return await call_next(request)


@app.get("/api/health")
def health():
    return {"ok": True, "service": "topchef-print-agent", "version": "1.0.0"}


@app.get("/api/printers")
def printers():
    return {
        "printers": thermal_printer.get_printers(),
        "receipt_selected": config.receipt_printer_names,
        "barcode_selected": config.barcode_printer_names,
    }


@app.get("/api/settings")
def get_settings():
    return {
        "receipt_printer_names": config.receipt_printer_names,
        "barcode_printer_names": config.barcode_printer_names,
        "printer_width_mm": config.printer_width_mm,
    }


@app.post("/api/settings")
def save_settings(settings: PrinterSettings):
    available = set(thermal_printer.get_printers())
    receipts = list(dict.fromkeys(settings.receipt_printer_names))
    barcodes = list(dict.fromkeys(settings.barcode_printer_names))
    unknown = [name for name in receipts + barcodes if name not in available]
    if unknown:
        raise HTTPException(status_code=400, detail=f"Unknown printers: {', '.join(unknown)}")
    if set(receipts) & set(barcodes):
        raise HTTPException(status_code=400, detail="Choose different printers for receipts and barcodes")
    previous = (config.receipt_printer_names, config.barcode_printer_names, config.printer_width_mm)
    config.set("receipt_printer_names", receipts)
    config.set("barcode_printer_names", barcodes)
    config.set("printer_width_mm", settings.printer_width_mm)
    if not config.save():
        config.set("receipt_printer_names", previous[0])
        config.set("barcode_printer_names", previous[1])
        config.set("printer_width_mm", previous[2])
        raise HTTPException(status_code=500, detail="Could not save settings")
    return {"ok": True, "receipt_printer_names": receipts, "barcode_printer_names": barcodes}


@app.post("/api/print", status_code=202)
def print_order(job: PrintJob):
    if not job.order:
        raise HTTPException(status_code=400, detail="Order data is required")
    if job.receipt_type not in {"customer", "invoice", "barcode", "stock_receipt", "sales_return", "purchase_document", "test"}:
        raise HTTPException(status_code=422, detail="Unsupported print document type")
    selected = config.printers_for(job.receipt_type)
    if not selected:
        raise HTTPException(status_code=409, detail=f"No {'barcode' if job.receipt_type == 'barcode' else 'receipt'} printer selected")
    if not set(selected) & set(thermal_printer.get_printers()):
        raise HTTPException(status_code=409, detail="Configured printer is unavailable")
    try:
        accepted = thermal_printer.print_receipt(job.order, job.receipt_type)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not accepted:
        raise HTTPException(status_code=500, detail="Print job was not accepted")
    return {"ok": True, "queued": True}


@app.post("/api/test-print", status_code=202)
def test_print(kind: Literal["receipt", "barcode"] = "receipt"):
    receipt_type = "barcode" if kind == "barcode" else "test"
    selected = config.printers_for(receipt_type)
    if not selected:
        raise HTTPException(status_code=409, detail=f"No {kind} printer selected")
    if not set(selected) & set(thermal_printer.get_printers()):
        raise HTTPException(status_code=409, detail="Configured printer is unavailable")
    if kind == "barcode":
        accepted = thermal_printer.print_receipt({
            "name_ar": "تجربة طباعة",
            "unit_name": "قطعة",
            "barcode": "123456789012",
            "sell_price": 10,
            "quantity": 1,
        }, "barcode")
    else:
        accepted = thermal_printer.test_print()
    if not accepted:
        raise HTTPException(status_code=500, detail="Test print was not accepted")
    return {"ok": True, "queued": True}


SETTINGS_HTML = """<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Souod El Shafie Print Agent</title><style>
body{font-family:Segoe UI,Tahoma,sans-serif;background:#101114;color:#f4f4f4;margin:0;display:grid;place-items:center;min-height:100vh}
main{width:min(620px,calc(100% - 32px));background:#1b1d22;border:1px solid #333842;border-radius:18px;padding:28px;box-shadow:0 20px 60px #0008}
h1{color:#f4b942;margin:0 0 8px}.status{color:#8bd49c;margin-bottom:22px}.printer{display:flex;gap:10px;align-items:center;padding:13px;background:#252830;border-radius:10px;margin:8px 0}
h3{margin:22px 0 10px}.hint{color:#b7becb;font-size:13px;margin:5px 0 12px}button{border:0;border-radius:9px;padding:11px 18px;font-weight:700;cursor:pointer;margin:4px}.primary{background:#f4b942;color:#171717}.secondary{background:#383d48;color:white}#msg{min-height:24px;margin-top:14px;color:#8bd49c}
</style></head><body><main><h1>Souod El Shafie Print Agent</h1><div class="status">الخدمة تعمل على هذا الجهاز</div>
<h3>طابعة الفواتير</h3><div id="receipt-printers">جاري تحميل الطابعات...</div>
<h3>طابعة الباركود</h3><div id="barcode-printers">جاري تحميل الطابعات...</div>
<p class="hint">اختَر طابعة مختلفة لكل نوع. اضبط مقاس الملصق من إعدادات طابعة الباركود في ويندوز.</p>
<p><button class="primary" onclick="save()">حفظ الاختيارات</button><button class="secondary" onclick="testPrint('receipt')">تجربة فاتورة</button><button class="secondary" onclick="testPrint('barcode')">تجربة باركود</button></p><div id="msg" role="status"></div>
<script>
const m=document.getElementById('msg');
function render(group,printers,selected){const box=document.getElementById(group+'-printers');box.replaceChildren();if(!printers.length){box.textContent='لا توجد طابعات معرفة على Windows';return;}for(const name of printers){const label=document.createElement('label'),input=document.createElement('input'),caption=document.createElement('span');label.className='printer';input.type='checkbox';input.name=group;input.value=name;input.checked=selected.includes(name);caption.textContent=name;label.append(input,caption);box.append(label);}}
async function load(){const r=await fetch('/api/printers');if(!r.ok)throw Error();const d=await r.json();render('receipt',d.printers,d.receipt_selected);render('barcode',d.printers,d.barcode_selected);}
function chosen(group){return [...document.querySelectorAll('input[name="'+group+'"]:checked')].map(input=>input.value);}
async function save(){const receipts=chosen('receipt'),barcodes=chosen('barcode');if(receipts.some(name=>barcodes.includes(name))){m.textContent='اختَر طابعة مختلفة للفواتير والباركود';return;}try{const r=await fetch('/api/settings',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({receipt_printer_names:receipts,barcode_printer_names:barcodes,printer_width_mm:80})});m.textContent=r.ok?'تم حفظ الطابعات بنجاح':'تعذر حفظ الإعدادات';}catch{m.textContent='تعذر الاتصال بتطبيق الطابعة';}}
async function testPrint(kind){try{const r=await fetch('/api/test-print?kind='+kind,{method:'POST'});if(r.ok){m.textContent='تم إرسال صفحة الاختبار للطابعة المختارة';}else if(r.status===409){m.textContent='الطابعة المختارة غير متاحة؛ تأكد من توصيلها وحفظ اختيارها';}else{m.textContent='تعذر تجهيز صفحة الاختبار (رمز '+r.status+'). راجع سجل التطبيق';}}catch{m.textContent='تعذر الاتصال بتطبيق الطابعة';}}
load().catch(()=>{document.getElementById('receipt-printers').textContent='تعذر قراءة الطابعات';document.getElementById('barcode-printers').textContent='تعذر قراءة الطابعات';});
</script></main></body></html>"""


@app.get("/", response_class=HTMLResponse)
def settings_page():
    return SETTINGS_HTML


def main():
    if not claim_single_instance():
        return
    ensure_windows_autostart()
    url = f"http://127.0.0.1:{config.local_port}"
    server = uvicorn.Server(uvicorn.Config(
        app,
        host="127.0.0.1",
        port=config.local_port,
        log_config=None,
        access_log=False,
    ))
    if not config.get("browser_opened_once", False):
        threading.Thread(target=open_settings_on_first_launch, args=(server, url), daemon=True).start()
    # A windowed PyInstaller executable has no stdout/stderr. Uvicorn's default
    # logging formatter probes those streams and crashes when they are None, so
    # the agent uses the file logger configured above instead.
    server.run()


if __name__ == "__main__":
    main()
