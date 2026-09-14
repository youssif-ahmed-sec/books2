from fastapi import APIRouter, Request, Response, BackgroundTasks, Depends
from sqlalchemy.ext.asyncio import AsyncSession
from database import get_db
from core.automations import handle_new_lead_automation, send_auto_reply
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/webhooks", tags=["Webhooks"])

VERIFY_TOKEN = "SAUD_EL_SHAFIE_SECURE_TOKEN"

@router.get("/whatsapp")
async def verify_whatsapp_webhook(
    request: Request,
):
    """Verify webhook for WhatsApp Cloud API"""
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")

    if mode and token:
        if mode == "subscribe" and token == VERIFY_TOKEN:
            logger.info("WEBHOOK_VERIFIED")
            return Response(content=challenge, status_code=200)
        else:
            return Response(status_code=403)
    return Response(status_code=400)

@router.post("/whatsapp")
async def receive_whatsapp_message(
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    """Receive messages from WhatsApp Cloud API"""
    body = await request.json()
    
    if body.get("object"):
        for entry in body.get("entry", []):
            for change in entry.get("changes", []):
                value = change.get("value", {})
                if "messages" in value:
                    for message in value["messages"]:
                        phone_number = message.get("from")
                        text = message.get("text", {}).get("body", "")
                        
                        # Background task: create lead and send auto reply
                        background_tasks.add_task(
                            handle_new_lead_automation,
                            phone_number=phone_number,
                            source="WhatsApp",
                            message=text,
                            db=db
                        )
                        background_tasks.add_task(
                            send_auto_reply,
                            phone_number=phone_number,
                            message="Thank you for contacting Saud El Shafie Bookstore. Your request has been received. One of our representatives will contact you shortly."
                        )

        return Response(content="EVENT_RECEIVED", status_code=200)
    return Response(status_code=404)
