# Local print agent

The service listens on `127.0.0.1:8199` by default. It permits browser requests from its own settings page, local Next.js development on port 3000, and the packaged local backend on port 8000.

Build the Windows executable from the `print_agent` directory after running `python build_icon.py` with Pillow installed, then `pyinstaller --noconfirm SouodElShafiePrintAgent.spec`. The executable uses the bookstore logo as its Windows icon. On its first successful launch for a Windows user, it opens `http://127.0.0.1:8199` in the default browser. Later launches stay in the background. It registers itself in that user's Windows Run key so it starts when the user signs in; keep the executable at the same path after the first launch. A second launch while it is already running exits without binding the port again.

For a deployed frontend, set `PRINT_AGENT_ALLOWED_ORIGINS` to its exact HTTPS origin before starting the agent. Use a comma-separated list if more than one frontend origin is required. Requests with an `Origin` outside this list receive HTTP 403, including print and settings requests.

The browser's access restriction is only one boundary; keep the agent bound to loopback and do not expose its port through a proxy.

The settings page has separate printer selections for receipts and barcode labels. Existing shared printer selections migrate to receipts only; choose the barcode printer explicitly after upgrading. The same Windows printer cannot be selected for both types. Jobs capture the selected printer names when queued, and a missing or unavailable selection receives HTTP 409. The two test buttons send a receipt or barcode label to its selected printer. Set label dimensions in the Windows barcode-printer driver; the agent renders the image to the driver's printable page width.
