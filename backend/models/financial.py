from sqlalchemy import Column, String, DateTime, Numeric
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
