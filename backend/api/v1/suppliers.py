from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, update
from uuid import UUID
from typing import Optional
from decimal import Decimal

from models.product import Supplier, SupplierPayment
from models.product import Product
from models.inventory import InventoryTransaction
from schemas.product import (
    SupplierCreate, SupplierUpdate, SupplierResponse,
    SupplierDetailResponse, SupplierPaymentCreate, SupplierPaymentResponse,
    PaginatedSupplierResponse
)
from core.dependencies import get_current_user
from models.user import User
from database import get_db

router = APIRouter(prefix="/suppliers", tags=["Suppliers"])


@router.get("", response_model=PaginatedSupplierResponse)
async def get_suppliers(
    search: Optional[str] = None,
    skip: int = 0,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
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
    count_query = select(func.count(Supplier.id)).select_from(base_query.subquery())
    total = (await db.execute(count_query)).scalar() or 0

    result = await db.execute(base_query.offset(skip).limit(limit))
    suppliers = result.scalars().all()
    return {"data": suppliers, "total": total}


@router.get("/{supplier_id}", response_model=SupplierDetailResponse)
async def get_supplier_detail(supplier_id: UUID, db: AsyncSession = Depends(get_db)):
    """Get supplier detail with statement (purchases, payments, balance)."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    # Calculate total purchases from inventory transactions (stock-in from this supplier)
    purchases_query = select(func.sum(InventoryTransaction.quantity_changed * Product.cost)).join(
        Product, InventoryTransaction.product_id == Product.id
    ).where(
        Product.supplier_id == supplier_id,
        InventoryTransaction.transaction_type == "Receiving"
    )
    purchases_result = await db.execute(purchases_query)
    total_purchases = purchases_result.scalar() or Decimal("0")

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
    balance = opening_balance + Decimal(str(total_purchases)) - Decimal(str(total_payments))

    supplier_data = supplier.__dict__.copy()
    supplier_data.pop("_sa_instance_state", None)
    supplier_data["total_purchases"] = total_purchases
    supplier_data["total_payments"] = total_payments
    supplier_data["balance"] = balance
    supplier_data["payments"] = payments

    return supplier_data


@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    supplier_in: SupplierCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new supplier."""
    new_supplier = Supplier(**supplier_in.model_dump())
    db.add(new_supplier)
    await db.commit()
    await db.refresh(new_supplier)
    return new_supplier


@router.put("/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: UUID,
    supplier_in: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an existing supplier."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    update_data = supplier_in.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(supplier, key, value)

    await db.commit()
    await db.refresh(supplier)
    return supplier


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier(
    supplier_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
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
    current_user: User = Depends(get_current_user),
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
