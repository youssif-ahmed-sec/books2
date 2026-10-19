from sqlalchemy import Column, String, DateTime, Numeric, ForeignKey, CheckConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
import uuid
from .user import Base

class Expense(Base):
    __tablename__ = "expenses"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    category = Column(String, nullable=False, index=True) # e.g., "Utilities", "Salaries", "Maintenance"
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String, nullable=True)
    expense_date = Column(DateTime(timezone=True), default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

class Income(Base):
    __tablename__ = "incomes"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    source = Column(String, nullable=False, index=True) # e.g., "Services", "External Consulting"
    amount = Column(Numeric(12, 2), nullable=False)
    description = Column(String, nullable=True)
    income_date = Column(DateTime(timezone=True), default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (Index("ix_payments_created_at", "created_at"), Index("ix_payments_shift_id", "shift_id"))

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey("orders.id"), nullable=True, index=True)
    customer_id = Column(UUID(as_uuid=True), ForeignKey("customers.id"), nullable=True, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("cash_shifts.id"), nullable=True)
    amount = Column(Numeric(12, 2), nullable=False)
    method = Column(String, nullable=False)
    kind = Column(String, nullable=False)  # SALE, COLLECTION, REFUND
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class CashShift(Base):
    __tablename__ = "cash_shifts"
    __table_args__ = (CheckConstraint("opening_cash >= 0 AND (closing_cash IS NULL OR closing_cash >= 0)", name="ck_cash_shift_nonnegative"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True)
    opening_cash = Column(Numeric(12, 2), nullable=False)
    closing_cash = Column(Numeric(12, 2), nullable=True)
    expected_cash = Column(Numeric(12, 2), nullable=True)
    status = Column(String, nullable=False, default="OPEN")
    opened_at = Column(DateTime(timezone=True), server_default=func.now())
    closed_at = Column(DateTime(timezone=True), nullable=True)


class CashAdjustment(Base):
    __tablename__ = "cash_adjustments"
    __table_args__ = (Index("ix_cash_adjustments_shift_id", "shift_id"),)

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    shift_id = Column(UUID(as_uuid=True), ForeignKey("cash_shifts.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    amount = Column(Numeric(12, 2), nullable=False)
    reason = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
