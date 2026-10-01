# Local print agent

The service listens on `127.0.0.1:8199` by default. It permits browser requests from its own settings page and from local Next.js development on port 3000.

For a deployed frontend, set `PRINT_AGENT_ALLOWED_ORIGINS` to its exact HTTPS origin before starting the agent. Use a comma-separated list if more than one frontend origin is required. Requests with an `Origin` outside this list receive HTTP 403, including print and settings requests.

The browser's access restriction is only one boundary; keep the agent bound to loopback and do not expose its port through a proxy.
