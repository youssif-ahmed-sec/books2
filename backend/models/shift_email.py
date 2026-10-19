from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from .user import Base


class ShiftReportRecipient(Base):
    __tablename__ = "shift_report_recipient"

    id = Column(Integer, primary_key=True)
    email = Column(String(320), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class ShiftEmailReport(Base):
    __tablename__ = "shift_email_reports"

    shift_id = Column(UUID(as_uuid=True), ForeignKey("cash_shifts.id"), primary_key=True)
    recipient_email = Column(String(320), nullable=False)
    subject = Column(String(200), nullable=False)
    body = Column(Text, nullable=False)
    status = Column(String(16), nullable=False, default="PENDING")
    attempts = Column(Integer, nullable=False, default=0)
    sent_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
