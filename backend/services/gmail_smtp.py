"""Outbound Gmail SMTP configuration; credentials stay in server environment variables."""

import asyncio
import os
import smtplib
import ssl
from email.message import EmailMessage


def gmail_configured() -> bool:
    return bool(os.getenv("GMAIL_ADDRESS", "").strip() and os.getenv("GMAIL_APP_PASSWORD", "").strip())


async def send_gmail_message(recipient: str, subject: str, body: str) -> None:
    sender = os.getenv("GMAIL_ADDRESS", "").strip()
    app_password = os.getenv("GMAIL_APP_PASSWORD", "").replace(" ", "").strip()
    if not sender or not app_password:
        raise ValueError("Gmail SMTP is not configured")

    def send() -> None:
        message = EmailMessage()
        message["From"] = sender
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(body)
        with smtplib.SMTP_SSL("smtp.gmail.com", 465, timeout=10,
                              context=ssl.create_default_context()) as client:
            client.login(sender, app_password)
            client.send_message(message)

    await asyncio.to_thread(send)
