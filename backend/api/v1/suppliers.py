from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import case, func, or_
from sqlalchemy.exc import IntegrityError
from uuid import UUID
from typing import Optional
from decimal import Decimal

from models.product import Supplier, SupplierPayment, SupplierDebtEntry, SupplierPaymentAllocation, PaymentMethodEnum
from models.financial import CashAdjustment
from services.cash_register_service import expected_cash, open_shift
from models.inventory import InventoryTransaction, TransactionTypeEnum
from schemas.product import (
    SupplierCreate, QuickSupplierCreate, SupplierUpdate, SupplierResponse,
    SupplierDetailResponse, SupplierPaymentCreate, SupplierPaymentResponse,
    SupplierDebtCreate, SupplierDebtReverse, SupplierDebtEntryResponse,
    PaginatedSupplierResponse
)
from core.dependencies import require_admin, require_inventory_access
from core.supplier_access import visible_supplier, visible_supplier_detail
from models.user import User, RoleEnum, AuditLog
from database import get_db

router = APIRouter(prefix="/suppliers", tags=["Suppliers"], dependencies=[Depends(require_inventory_access)])


async def _supplier_balance_summary(db: AsyncSession, supplier: Supplier) -> dict:
    supplier_id = supplier.id
    receipts = await db.execute(select(
        func.coalesce(func.sum(InventoryTransaction.quantity_changed * InventoryTransaction.unit_cost), 0),
        func.count(InventoryTransaction.id).filter(InventoryTransaction.unit_cost.is_(None)),
    ).where(
        InventoryTransaction.supplier_id == supplier_id,
        InventoryTransaction.transaction_type == TransactionTypeEnum.RECEIVING,
        InventoryTransaction.supplier_finance_included.is_(True),
    ))
    total_purchases, unpriced_receipts = receipts.one()
    unattributed_receipts = (await db.execute(select(func.count(InventoryTransaction.id)).where(
        InventoryTransaction.supplier_id.is_(None),
        InventoryTransaction.transaction_type == TransactionTypeEnum.RECEIVING,
        InventoryTransaction.supplier_finance_included.is_(True),
        or_(InventoryTransaction.notes.is_(None), InventoryTransaction.notes != "Initial stock from product creation"),
    ))).scalar_one()
    total_payments = (await db.execute(select(func.coalesce(func.sum(SupplierPayment.amount), 0)).where(
        SupplierPayment.supplier_id == supplier_id,
    ))).scalar_one()
    total_manual_debt = (await db.execute(select(func.coalesce(func.sum(case(
        (SupplierDebtEntry.entry_type == "DEBT", SupplierDebtEntry.amount),
        else_=-SupplierDebtEntry.amount,
    )), 0)).where(SupplierDebtEntry.supplier_id == supplier_id))).scalar_one()
    statement_incomplete = bool(unpriced_receipts or unattributed_receipts)
    balance = None if statement_incomplete else (
        Decimal(str(supplier.opening_balance or 0)) + Decimal(str(total_purchases))
        + Decimal(str(total_manual_debt)) - Decimal(str(total_payments))
    )
    return {
        "total_purchases": total_purchases, "unpriced_receipts": unpriced_receipts,
        "unattributed_receipts": unattributed_receipts, "total_payments": total_payments,
        "total_manual_debt": total_manual_debt, "statement_incomplete": statement_incomplete,
        "balance": balance,
    }


async def _payment_with_allocations(db: AsyncSession, payment: SupplierPayment) -> dict:
    rows = (await db.execute(select(SupplierPaymentAllocation).where(
        SupplierPaymentAllocation.payment_id == payment.id,
    ))).scalars().all()
    return {**payment.__dict__, "allocations": rows}


async def _same_payment_request(db: AsyncSession, prior: SupplierPayment, supplier_id: UUID, payload: SupplierPaymentCreate) -> bool:
    if (prior.supplier_id != supplier_id or Decimal(str(prior.amount)) != payload.amount
            or prior.payment_method != payload.payment_method or prior.cash_source != payload.cash_source
            or prior.reference_number != payload.reference_number or prior.notes != payload.notes):
        return False
    rows = (await db.execute(select(SupplierPaymentAllocation).where(
        SupplierPaymentAllocation.payment_id == prior.id,
    ))).scalars().all()
    return {row.debt_entry_id: Decimal(str(row.amount)) for row in rows} == {
        item.debt_entry_id: item.amount for item in payload.allocations
    }


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


@router.post("/quick", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def create_quick_supplier(
    payload: QuickSupplierCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access),
):
    name = " ".join(payload.name.split())
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Supplier name is required")
    match = (await db.execute(select(Supplier.id).where(
        Supplier.is_deleted == False, func.lower(Supplier.name) == name.casefold(),
    ).limit(1))).scalar_one_or_none()
    if match:
        raise HTTPException(status_code=409, detail="المورد مسجل بالفعل؛ اختره من القائمة.")
    supplier = Supplier(name=name, phone=(payload.phone or "").strip() or None)
    db.add(supplier)
    await db.flush()
    db.add(AuditLog(user_id=current_user.id, action="CREATE_SUPPLIER", entity_type="Supplier",
                    entity_id=str(supplier.id), new_value={"source": "stock_receipt"}))
    await db.commit()
    await db.refresh(supplier)
    return visible_supplier(supplier, current_user.role)


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

    summary = await _supplier_balance_summary(db, supplier)
    payments_list_query = select(SupplierPayment).where(
        SupplierPayment.supplier_id == supplier_id
    ).order_by(SupplierPayment.payment_date.desc())
    payments_list_result = await db.execute(payments_list_query)
    payments = payments_list_result.scalars().all()

    debt_entries = (await db.execute(select(SupplierDebtEntry).where(
        SupplierDebtEntry.supplier_id == supplier_id,
    ).order_by(SupplierDebtEntry.created_at.desc(), SupplierDebtEntry.id.desc()))).scalars().all()

    supplier_data = supplier.__dict__.copy()
    supplier_data.pop("_sa_instance_state", None)
    supplier_data.update(summary)
    allocations = (await db.execute(select(SupplierPaymentAllocation).join(
        SupplierDebtEntry, SupplierDebtEntry.id == SupplierPaymentAllocation.debt_entry_id,
    ).where(SupplierDebtEntry.supplier_id == supplier_id))).scalars().all()
    by_payment: dict[UUID, list] = {}
    by_debt: dict[UUID, Decimal] = {}
    for allocation in allocations:
        by_payment.setdefault(allocation.payment_id, []).append(allocation)
        by_debt[allocation.debt_entry_id] = by_debt.get(allocation.debt_entry_id, Decimal("0")) + Decimal(str(allocation.amount))
    supplier_data["payments"] = [{**payment.__dict__, "allocations": by_payment.get(payment.id, [])} for payment in payments]
    supplier_data["debt_entries"] = [{**entry.__dict__, "allocated_amount": by_debt.get(entry.id, Decimal("0"))} for entry in debt_entries]

    return visible_supplier_detail(supplier_data, current_user.role)


@router.post("", response_model=SupplierResponse, status_code=status.HTTP_201_CREATED)
async def create_supplier(
    supplier_in: SupplierCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Create a new supplier."""
    new_supplier = Supplier(**supplier_in.model_dump())
    db.add(new_supplier)
    await db.flush()
    db.add(AuditLog(user_id=current_user.id, action="CREATE_SUPPLIER", entity_type="Supplier", entity_id=str(new_supplier.id)))
    await db.commit()
    await db.refresh(new_supplier)
    return visible_supplier(new_supplier, current_user.role)


@router.put("/{supplier_id}", response_model=SupplierResponse)
async def update_supplier(
    supplier_id: UUID,
    supplier_in: SupplierUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Update an existing supplier."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False).with_for_update()
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    update_data = supplier_in.model_dump(exclude_unset=True)
    if "opening_balance" in update_data:
        raise HTTPException(status_code=422, detail="Opening balance is fixed after supplier creation; record a debt entry instead")
    if update_data.get("credit_limit") is not None and update_data["credit_limit"] != supplier.credit_limit:
        balance = (await _supplier_balance_summary(db, supplier))["balance"]
        if balance is None:
            raise HTTPException(status_code=409, detail="Supplier balance is unknown; reconcile old receipts before setting a credit limit")
        if balance > update_data["credit_limit"]:
            raise HTTPException(status_code=422, detail="Credit limit cannot be lower than the current supplier balance")
    for key, value in update_data.items():
        setattr(supplier, key, value)

    db.add(AuditLog(user_id=current_user.id, action="UPDATE_SUPPLIER", entity_type="Supplier", entity_id=str(supplier_id), new_value={"fields": list(update_data)}))

    await db.commit()
    await db.refresh(supplier)
    return visible_supplier(supplier, current_user.role)


@router.delete("/{supplier_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_supplier(
    supplier_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Soft delete a supplier."""
    result = await db.execute(
        select(Supplier).where(Supplier.id == supplier_id, Supplier.is_deleted == False)
    )
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")

    supplier.is_deleted = True
    db.add(AuditLog(user_id=current_user.id, action="ARCHIVE_SUPPLIER", entity_type="Supplier", entity_id=str(supplier_id)))
    await db.commit()


@router.post("/{supplier_id}/debts", response_model=SupplierDebtEntryResponse, status_code=status.HTTP_201_CREATED)
async def add_supplier_debt(
    supplier_id: UUID,
    payload: SupplierDebtCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin records a supplier debt independently from warehouse receiving."""
    note = payload.note.strip()
    if len(note) < 2:
        raise HTTPException(status_code=422, detail="Debt description is required")
    prior = (await db.execute(select(SupplierDebtEntry).where(SupplierDebtEntry.id == payload.request_id))).scalar_one_or_none()
    if prior is not None:
        if (prior.supplier_id != supplier_id or prior.entry_type != "DEBT"
                or Decimal(str(prior.amount)) != payload.amount or prior.note != note
                or prior.reference_number != payload.reference_number or prior.due_date != payload.due_date):
            raise HTTPException(status_code=409, detail="Debt request ID was already used differently")
        return prior
    supplier = (await db.execute(select(Supplier).where(
        Supplier.id == supplier_id, Supplier.is_deleted == False,
    ).with_for_update())).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")
    # A concurrent retry may have committed while this request waited for the supplier lock.
    prior = (await db.execute(select(SupplierDebtEntry).where(SupplierDebtEntry.id == payload.request_id))).scalar_one_or_none()
    if prior is not None:
        if (prior.supplier_id != supplier_id or prior.entry_type != "DEBT"
                or Decimal(str(prior.amount)) != payload.amount or prior.note != note
                or prior.reference_number != payload.reference_number or prior.due_date != payload.due_date):
            raise HTTPException(status_code=409, detail="Debt request ID was already used differently")
        return prior
    credit_limit_before = supplier.credit_limit
    credit_limit_after = credit_limit_before
    if credit_limit_before is not None:
        balance = (await _supplier_balance_summary(db, supplier))["balance"]
        if balance is None:
            raise HTTPException(status_code=409, detail="Supplier balance is unknown; reconcile old receipts before adding debt against a credit limit")
        projected_balance = balance + payload.amount
        if projected_balance > Decimal(str(credit_limit_before)):
            if payload.approved_credit_limit is None or payload.approved_credit_limit < projected_balance:
                raise HTTPException(status_code=409, detail="Credit limit approval is required for the current projected supplier balance; refresh and confirm again")
            supplier.credit_limit = projected_balance
            credit_limit_after = projected_balance
    entry = SupplierDebtEntry(
        id=payload.request_id, supplier_id=supplier_id, entry_type="DEBT",
        amount=payload.amount, note=note, reference_number=payload.reference_number, due_date=payload.due_date,
        created_by=current_user.id,
    )
    db.add(entry)
    try:
        await db.flush()
        db.add(AuditLog(user_id=current_user.id, action="SUPPLIER_DEBT_ADDED", entity_type="Supplier",
                        entity_id=str(supplier_id), new_value={
                            "entry_id": str(entry.id), "amount": str(entry.amount), "due_date": entry.due_date.isoformat(),
                            "credit_limit_before": str(credit_limit_before) if credit_limit_before is not None else None,
                            "credit_limit_after": str(credit_limit_after) if credit_limit_after is not None else None,
                        }))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(SupplierDebtEntry).where(SupplierDebtEntry.id == payload.request_id))).scalar_one_or_none()
        if (prior is None or prior.supplier_id != supplier_id or prior.entry_type != "DEBT"
                or Decimal(str(prior.amount)) != payload.amount or prior.note != note
                or prior.reference_number != payload.reference_number or prior.due_date != payload.due_date):
            raise HTTPException(status_code=409, detail="Debt request ID was already used differently")
        return prior
    await db.refresh(entry)
    return entry


@router.post("/{supplier_id}/debts/{entry_id}/reverse", response_model=SupplierDebtEntryResponse, status_code=status.HTTP_201_CREATED)
async def reverse_supplier_debt(
    supplier_id: UUID,
    entry_id: UUID,
    payload: SupplierDebtReverse,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Correct a mistaken debt with an immutable, auditable reversal."""
    reason = payload.reason.strip()
    if len(reason) < 2:
        raise HTTPException(status_code=422, detail="Reversal reason is required")
    prior = (await db.execute(select(SupplierDebtEntry).where(SupplierDebtEntry.id == payload.request_id))).scalar_one_or_none()
    if prior is not None:
        if (prior.supplier_id != supplier_id or prior.entry_type != "REVERSAL"
                or prior.reverses_entry_id != entry_id or prior.note != reason):
            raise HTTPException(status_code=409, detail="Reversal request ID was already used differently")
        return prior
    supplier = (await db.execute(select(Supplier).where(
        Supplier.id == supplier_id, Supplier.is_deleted == False,
    ).with_for_update())).scalar_one_or_none()
    if supplier is None:
        raise HTTPException(status_code=404, detail="Supplier not found")
    original = (await db.execute(select(SupplierDebtEntry).where(
        SupplierDebtEntry.id == entry_id, SupplierDebtEntry.supplier_id == supplier_id,
        SupplierDebtEntry.entry_type == "DEBT",
    ).with_for_update())).scalar_one_or_none()
    if original is None:
        raise HTTPException(status_code=404, detail="Debt entry not found")
    existing = (await db.execute(select(SupplierDebtEntry).where(
        SupplierDebtEntry.reverses_entry_id == entry_id,
    ))).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status_code=409, detail="Debt entry is already reversed")
    allocated = (await db.execute(select(func.coalesce(func.sum(SupplierPaymentAllocation.amount), 0)).where(
        SupplierPaymentAllocation.debt_entry_id == entry_id,
    ))).scalar_one()
    if allocated:
        raise HTTPException(status_code=409, detail="Cannot reverse a debt with allocated payments")
    entry = SupplierDebtEntry(
        id=payload.request_id, supplier_id=supplier_id, entry_type="REVERSAL",
        amount=original.amount, note=reason, reverses_entry_id=entry_id,
        created_by=current_user.id,
    )
    db.add(entry)
    try:
        await db.flush()
        db.add(AuditLog(user_id=current_user.id, action="SUPPLIER_DEBT_REVERSED", entity_type="Supplier",
                        entity_id=str(supplier_id), new_value={"entry_id": str(entry.id), "reverses": str(entry_id)}))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(SupplierDebtEntry).where(SupplierDebtEntry.id == payload.request_id))).scalar_one_or_none()
        if (prior is not None and prior.supplier_id == supplier_id and prior.entry_type == "REVERSAL"
                and prior.reverses_entry_id == entry_id and prior.note == reason):
            return prior
        raise HTTPException(status_code=409, detail="Debt entry is already reversed or request ID was reused")
    await db.refresh(entry)
    return entry


@router.post("/{supplier_id}/payments", response_model=SupplierPaymentResponse, status_code=status.HTTP_201_CREATED)
async def add_payment(
    supplier_id: UUID,
    payment_in: SupplierPaymentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Record an idempotent payment to a supplier."""
    if payment_in.payment_method == PaymentMethodEnum.CASH and payment_in.cash_source is None:
        raise HTTPException(status_code=422, detail="Choose whether cash came from the shift or outside it")
    if payment_in.payment_method != PaymentMethodEnum.CASH and payment_in.cash_source is not None:
        raise HTTPException(status_code=422, detail="Cash source applies only to cash payments")
    prior = (await db.execute(select(SupplierPayment).where(SupplierPayment.id == payment_in.request_id))).scalar_one_or_none()
    if prior is not None:
        if not await _same_payment_request(db, prior, supplier_id, payment_in):
            raise HTTPException(status_code=409, detail="Payment request ID was already used differently")
        return await _payment_with_allocations(db, prior)
    if payment_in.payment_method not in (PaymentMethodEnum.CASH, PaymentMethodEnum.INSTAPAY, PaymentMethodEnum.WALLET):
        raise HTTPException(status_code=422, detail="Supplier payments accept cash, Instapay, or wallet only")
    result = await db.execute(select(Supplier).where(
        Supplier.id == supplier_id, Supplier.is_deleted == False,
    ).with_for_update())
    supplier = result.scalar_one_or_none()
    if not supplier:
        raise HTTPException(status_code=404, detail="Supplier not found")
    prior = (await db.execute(select(SupplierPayment).where(SupplierPayment.id == payment_in.request_id))).scalar_one_or_none()
    if prior is not None:
        if not await _same_payment_request(db, prior, supplier_id, payment_in):
            raise HTTPException(status_code=409, detail="Payment request ID was already used differently")
        return await _payment_with_allocations(db, prior)
    if len({item.debt_entry_id for item in payment_in.allocations}) != len(payment_in.allocations):
        raise HTTPException(status_code=422, detail="A debt can appear only once in a payment")
    allocated_total = sum((item.amount for item in payment_in.allocations), Decimal("0"))
    if allocated_total > payment_in.amount or (allocated_total < payment_in.amount and not payment_in.allow_unallocated):
        raise HTTPException(status_code=422, detail="Allocate the full payment or explicitly allow an unallocated remainder")
    for item in payment_in.allocations:
        debt = (await db.execute(select(SupplierDebtEntry).where(
            SupplierDebtEntry.id == item.debt_entry_id,
            SupplierDebtEntry.supplier_id == supplier_id,
            SupplierDebtEntry.entry_type == "DEBT",
        ))).scalar_one_or_none()
        if debt is None:
            raise HTTPException(status_code=422, detail="Selected supplier debt is invalid")
        reversed_row = (await db.execute(select(SupplierDebtEntry.id).where(
            SupplierDebtEntry.reverses_entry_id == debt.id,
        ))).scalar_one_or_none()
        if reversed_row is not None:
            raise HTTPException(status_code=409, detail="Selected supplier debt was reversed")
        paid = (await db.execute(select(func.coalesce(func.sum(SupplierPaymentAllocation.amount), 0)).where(
            SupplierPaymentAllocation.debt_entry_id == debt.id,
        ))).scalar_one()
        if item.amount > Decimal(str(debt.amount)) - Decimal(str(paid)):
            raise HTTPException(status_code=409, detail="Allocation exceeds the debt's remaining amount; refresh supplier account")

    cash_shift = None
    if payment_in.payment_method == PaymentMethodEnum.CASH and payment_in.cash_source == "SHIFT":
        try:
            cash_shift = await open_shift(db, current_user.id)
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error))
        if await expected_cash(db, cash_shift) < payment_in.amount:
            raise HTTPException(status_code=400, detail="Insufficient cash in the open drawer")

    payment = SupplierPayment(
        id=payment_in.request_id,
        supplier_id=supplier_id,
        **payment_in.model_dump(exclude={"request_id", "allocations", "allow_unallocated"})
    )
    db.add(payment)
    for item in payment_in.allocations:
        db.add(SupplierPaymentAllocation(payment_id=payment.id, debt_entry_id=item.debt_entry_id, amount=item.amount))
    if cash_shift is not None:
        db.add(CashAdjustment(
            id=payment_in.request_id,
            shift_id=cash_shift.id,
            user_id=current_user.id,
            amount=-payment_in.amount,
            reason=f"Supplier payment {supplier_id}",
        ))
    try:
        await db.flush()
        db.add(AuditLog(user_id=current_user.id, action="SUPPLIER_PAYMENT", entity_type="Supplier", entity_id=str(supplier_id), new_value={"payment_id": str(payment.id), "amount": str(payment.amount), "payment_method": payment.payment_method.value, "cash_source": payment.cash_source, "allocations": [{"debt_entry_id": str(item.debt_entry_id), "amount": str(item.amount)} for item in payment_in.allocations], "unallocated_amount": str(payment_in.amount - allocated_total)}))
        await db.commit()
    except IntegrityError:
        await db.rollback()
        prior = (await db.execute(select(SupplierPayment).where(SupplierPayment.id == payment_in.request_id))).scalar_one_or_none()
        if prior is None or not await _same_payment_request(db, prior, supplier_id, payment_in):
            raise HTTPException(status_code=409, detail="Payment request ID was already used differently")
        return await _payment_with_allocations(db, prior)
    await db.refresh(payment)
    return await _payment_with_allocations(db, payment)
