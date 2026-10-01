from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, or_, update
from uuid import UUID
from typing import Optional
from decimal import Decimal

from models.product import Supplier, SupplierPayment
from models.inventory import InventoryTransaction
from schemas.product import (
    SupplierCreate, SupplierUpdate, SupplierResponse,
    SupplierDetailResponse, SupplierPaymentCreate, SupplierPaymentResponse,
    PaginatedSupplierResponse
)
from core.dependencies import require_admin, require_inventory_access
from core.supplier_access import visible_supplier, visible_supplier_detail
from models.user import User, RoleEnum
from database import get_db

router = APIRouter(prefix="/suppliers", tags=["Suppliers"], dependencies=[Depends(require_inventory_access)])


@router.get("", response_model=PaginatedSupplierResponse)
async def get_suppliers(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """Get all active suppliers with pagination."""
    base_query = select(Supplier).where(Supplier.is_deleted == False)
    if search:
        pattern = f"%{search}%"
        base_query = base_query.where(
            Supplier.name.ilike(pattern) |
            Supplier.phone.ilike(pattern) |
            Supplier.email.ilike(pattern)
        )
    count_query = select(func.count()).select_from(base_query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    result = await db.execute(base_query.offset(skip).limit(limit))
    suppliers = result.scalars().all()
    return {"data": [visible_supplier(supplier, current_user.role) for supplier in suppliers], "total": total}


@router.get("/{supplier_id}", response_model=SupplierDetailResponse)
async def get_supplier_detail(
    supplier_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """Get supplier detail with statement (purchases, payments, balance)."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    if current_user.role != RoleEnum.ADMIN:
        return visible_supplier_detail(supplier.__dict__, current_user.role)

    # Only priced receipts can contribute to the statement. Old receipts lack
    # both the historical supplier and price, so they cannot be reconstructed.
    receipts = await db.execute(select(
        func.coalesce(func.sum(InventoryTransaction.quantity_changed * InventoryTransaction.unit_cost), 0),
        func.count(InventoryTransaction.id).filter(InventoryTransaction.unit_cost.is_(None)),
    ).where(
        InventoryTransaction.supplier_id == supplier_id,
        InventoryTransaction.transaction_type == "Receiving",
    ))
    total_purchases, unpriced_receipts = receipts.one()
    unattributed_receipts = (await db.execute(select(func.count(InventoryTransaction.id)).where(
        InventoryTransaction.supplier_id.is_(None),
        InventoryTransaction.transaction_type == "Receiving",
        or_(InventoryTransaction.notes.is_(None), InventoryTransaction.notes != "Initial stock from product creation"),
    ))).scalar_one()
    statement_incomplete = bool(unpriced_receipts or unattributed_receipts)

    # Calculate total payments
    payments_query = select(func.sum(SupplierPayment.amount)).where(
        SupplierPayment.supplier_id == supplier_id
    )
    payments_result = await db.execute(payments_query)
    total_payments = payments_result.scalar() or Decimal("0")

    # Get payment history
    payments_list_query = select(SupplierPayment).where(
        SupplierPayment.supplier_id == supplier_id
    ).order_by(SupplierPayment.payment_date.desc())
    payments_list_result = await db.execute(payments_list_query)
    payments = payments_list_result.scalars().all()

    opening_balance = supplier.opening_balance or Decimal("0")
    balance = None if statement_incomplete else opening_balance + Decimal(str(total_purchases)) - Decimal(str(total_payments))

    supplier_data = supplier.__dict__.copy()
    supplier_data.pop("_sa_instance_state", None)
    supplier_data["total_purchases"] = total_purchases
    supplier_data["total_payments"] = total_payments
    supplier_data["balance"] = balance
    supplier_data["statement_incomplete"] = statement_incomplete
    supplier_data["unpriced_receipts"] = unpriced_receipts
    supplier_data["unattributed_receipts"] = unattributed_receipts
    supplier_data["payments"] = payments

    return visible_supplier_detail(supplier_data, current_user.role)


@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    supplier_in: SupplierCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """Create a new supplier."""
    if current_user.role != RoleEnum.ADMIN and {"opening_balance", "credit_limit"} & supplier_in.model_fields_set:
        raise HTTPException(status_code=403, detail="Admin access required for supplier financial fields")
    new_supplier = Supplier(**supplier_in.model_dump())
    db.add(new_supplier)
    await db.commit()
    await db.refresh(new_supplier)
    return visible_supplier(new_supplier, current_user.role)


@router.put("/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: UUID,
    supplier_in: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """Update an existing supplier."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    update_data = supplier_in.model_dump(exclude_unset=True)
    if current_user.role != RoleEnum.ADMIN and {"opening_balance", "credit_limit"} & update_data.keys():
        raise HTTPException(status_code=403, detail="Admin access required for supplier financial fields")
    for key, value in update_data.items():
        setattr(supplier, key, value)

    await db.commit()
    await db.refresh(supplier)
    return visible_supplier(supplier, current_user.role)


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier(
    supplier_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    """Soft delete a supplier."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier.is_deleted = True
    await db.commit()


@router.post("/{supplier_id}/payments", response_model=SupplierPaymentResponse, status_code=status.HTTP_201_CREATED)
async def add_payment(
    supplier_id: UUID,
    payment_in: SupplierPaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Record a payment to a supplier."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    payment = SupplierPayment(
        supplier_id=supplier_id,
        **payment_in.model_dump()
    )
    db.add(payment)
    await db.commit()
    await db.refresh(payment)
    return payment
