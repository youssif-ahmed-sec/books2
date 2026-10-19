from sqlalchemy import Column, String, Boolean, DateTime, Enum, JSON, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import declarative_base
from sqlalchemy.sql import func
import enum
import uuid

Base = declarative_base()

class RoleEnum(str, enum.Enum):
    ADMIN = "ADMIN"
    CASHIER_ORDERS = "CASHIER_ORDERS"
    SENIOR_SALES = "SENIOR_SALES"
    INVENTORY_CONTROLLER = "INVENTORY_CONTROLLER"
    SALES_ASSISTANT = "SALES_ASSISTANT"

class User(Base):
    __tablename__ = "users"
    
    # ID is a UUID and acts as PK & FK to auth.users.id in Supabase
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, nullable=True, index=True)
    username = Column(String(50), unique=True, nullable=True, index=True)
    full_name = Column(String(100), nullable=True)
    hashed_password = Column(String, nullable=True)
    role = Column(Enum(RoleEnum), nullable=False)
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), nullable=False) # FK to users.id
    action = Column(String, nullable=False)
    entity_type = Column(String, nullable=True)
    entity_id = Column(String, nullable=True)
    old_value = Column(JSONB, nullable=True)
    new_value = Column(JSONB, nullable=True)
    ip_address = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())


class RevokedAccessToken(Base):
    __tablename__ = "revoked_access_tokens"
    __table_args__ = (Index("ix_revoked_access_tokens_expires_at", "expires_at"),)

    token_hash = Column(String(64), primary_key=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
