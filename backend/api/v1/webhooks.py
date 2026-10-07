from fastapi import APIRouter, Request, Response
import logging
import hashlib
import hmac
import os

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

@router.get("/whatsapp")
async def verify_whatsapp_webhook(
    request: Request,
):
    """Verify webhook for WhatsApp Cloud API"""
    if os.getenv("WHATSAPP_ENABLED") != "1":
        return Response(status_code=404)
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    verify_token = os.getenv("WHATSAPP_VERIFY_TOKEN")

    if not verify_token:
        logger.error("WhatsApp webhook verification token is not configured")
        return Response(status_code=503)

    if mode and token and challenge:
        if mode == "subscribe" and hmac.compare_digest(token, verify_token):
            logger.info("WEBHOOK_VERIFIED")
            return Response(content=challenge, status_code=200)
        else:
            return Response(status_code=403)
    return Response(status_code=400)

@router.post("/whatsapp")
async def receive_whatsapp_message(
    request: Request,
):
    """Receive messages from WhatsApp Cloud API"""
    if os.getenv("WHATSAPP_ENABLED") != "1":
        return Response(status_code=404)
    app_secret = os.getenv("WHATSAPP_APP_SECRET")
    if not app_secret:
        logger.error("WhatsApp webhook app secret is not configured")
        return Response(status_code=503)

    raw_body = await request.body()
    received_signature = request.headers.get("x-hub-signature-256", "")
    expected_signature = "sha256=" + hmac.new(
        app_secret.encode("utf-8"), raw_body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(received_signature, expected_signature):
        return Response(status_code=403)

    body = await request.json()
    
    if body.get("object"):
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                if value.get("messages"):
                    # Do not acknowledge messages before they are durably stored and handled.
                    return Response(status_code=503)

        return Response(content="EVENT_RECEIVED", status_code=200)
    return Response(status_code=404)
