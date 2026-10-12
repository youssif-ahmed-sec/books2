import uuid
from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.idempotency import request_fingerprint
from models.inventory import InventoryBalance, TransactionTypeEnum, Warehouse
from models.product import Product, ProductUnit, Supplier
from models.purchase_document import PurchaseDocument, PurchaseDocumentLine, PurchaseReceipt, PurchaseReceiptLine
from models.user import AuditLog, RoleEnum
from schemas.purchase_document import PurchaseDocumentCreate, PurchaseDocumentInput, PurchaseReceiptInput
from services.inventory_service import InventoryService
from services.notification_service import notify_roles, notify_user


class PurchaseDocumentService:
    @staticmethod
    def query():
        return select(PurchaseDocument).options(
            selectinload(PurchaseDocument.lines),
            selectinload(PurchaseDocument.receipts).selectinload(PurchaseReceipt.lines),
        ).execution_options(populate_existing=True)

    @staticmethod
    async def get(db: AsyncSession, document_id: uuid.UUID) -> PurchaseDocument | None:
        return (await db.execute(PurchaseDocumentService.query().where(PurchaseDocument.id == document_id))).scalar_one_or_none()

    @staticmethod
    async def list_documents(db: AsyncSession) -> list[PurchaseDocument]:
        return (await db.execute(PurchaseDocumentService.query().order_by(PurchaseDocument.created_at.desc()))).scalars().unique().all()

    @staticmethod
    async def build_lines(db: AsyncSession, document_id: uuid.UUID, payload: PurchaseDocumentInput) -> list[PurchaseDocumentLine]:
        supplier = (await db.execute(select(Supplier.id).where(
            Supplier.id == payload.supplier_id, Supplier.is_deleted == False,
        ))).scalar_one_or_none()
        if supplier is None:
            raise ValueError("Supplier is unavailable")
        seen: set[tuple[uuid.UUID, uuid.UUID]] = set()
        result = []
        for item in payload.lines:
            key = (item.product_id, item.unit_id)
            if key in seen:
                raise ValueError("Add each product and unit only once per purchase document")
            seen.add(key)
            product = (await db.execute(select(Product).where(
                Product.id == item.product_id, Product.is_deleted == False,
                Product.is_active == True, Product.is_bundle == False,
            ))).scalar_one_or_none()
            unit = (await db.execute(select(ProductUnit).where(
                ProductUnit.id == item.unit_id, ProductUnit.product_id == item.product_id,
                ProductUnit.is_deleted == False,
            ))).scalar_one_or_none()
            if product is None or unit is None:
                raise ValueError("Purchase product or unit is unavailable")
            factor = Decimal(str(unit.conversion_factor))
            base_quantity = item.quantity * factor
            if factor <= 0 or base_quantity > Decimal("9999999999999999.99") or base_quantity != base_quantity.quantize(Decimal("0.01")):
                raise ValueError("Quantity cannot be represented in base units")
            result.append(PurchaseDocumentLine(
                id=uuid.uuid4(), document_id=document_id, product_id=item.product_id,
                unit_id=item.unit_id, product_name=product.name_ar, unit_name=unit.unit_name,
                base_unit_name=product.base_unit,
                quantity=item.quantity, conversion_factor=factor, base_quantity=base_quantity,
                received_base_quantity=0,
            ))
        return result

    @staticmethod
    async def create(db: AsyncSession, payload: PurchaseDocumentCreate, user_id: uuid.UUID) -> uuid.UUID:
        fingerprint = request_fingerprint(payload)
        prior = (await db.execute(select(PurchaseDocument).where(PurchaseDocument.request_id == payload.request_id))).scalar_one_or_none()
        if prior is not None:
            if prior.request_fingerprint != fingerprint or prior.requested_by != user_id:
                raise ValueError("Request ID was already used for another purchase")
            return prior.id
        document_id = uuid.uuid4()
        lines = await PurchaseDocumentService.build_lines(db, document_id, payload)
        supplier_name = (await db.execute(select(Supplier.name).where(Supplier.id == payload.supplier_id))).scalar_one()
        db.add(PurchaseDocument(
            id=document_id, request_id=payload.request_id, request_fingerprint=fingerprint,
            supplier_id=payload.supplier_id, supplier_name=supplier_name,
            note=payload.note, requested_by=user_id,
            status="REQUESTED",
        ))
        db.add_all(lines)
        db.add(AuditLog(user_id=user_id, action="REQUEST_PURCHASE_DOCUMENT", entity_type="PurchaseDocument", entity_id=str(document_id),
                        new_value={"supplier_id": str(payload.supplier_id), "lines": [line.model_dump(mode="json") for line in payload.lines]}))
        await notify_roles(db, (RoleEnum.ADMIN,), kind="purchase_request", title="طلب شراء جديد",
                           message=f"طلب يضم {len(lines)} صنف", href="/purchases")
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            prior = (await db.execute(select(PurchaseDocument).where(PurchaseDocument.request_id == payload.request_id))).scalar_one_or_none()
            if prior is None or prior.request_fingerprint != fingerprint or prior.requested_by != user_id:
                raise ValueError("Purchase request could not be completed")
            return prior.id
        return document_id

    @staticmethod
    async def edit(db: AsyncSession, document_id: uuid.UUID, payload: PurchaseDocumentInput, user_id: uuid.UUID) -> None:
        document = (await db.execute(select(PurchaseDocument).where(
            PurchaseDocument.id == document_id,
        ).with_for_update())).scalar_one_or_none()
        if document is None:
            raise LookupError("Purchase document not found")
        if document.status != "REQUESTED":
            raise ValueError("Only a requested purchase can be edited")
        lines = await PurchaseDocumentService.build_lines(db, document_id, payload)
        previous = (await db.execute(select(PurchaseDocumentLine).where(
            PurchaseDocumentLine.document_id == document_id,
        ))).scalars().all()
        for line in previous:
            await db.delete(line)
        await db.flush()
        document.supplier_id = payload.supplier_id
        document.supplier_name = (await db.execute(select(Supplier.name).where(Supplier.id == payload.supplier_id))).scalar_one()
        document.note = payload.note
        db.add_all(lines)
        db.add(AuditLog(user_id=user_id, action="EDIT_PURCHASE_DOCUMENT", entity_type="PurchaseDocument", entity_id=str(document_id),
                        new_value={"supplier_id": str(payload.supplier_id), "lines": [line.model_dump(mode="json") for line in payload.lines]}))
        await db.commit()

    @staticmethod
    async def transition(db: AsyncSession, document_id: uuid.UUID, action: str, user_id: uuid.UUID) -> None:
        document = (await db.execute(select(PurchaseDocument).where(
            PurchaseDocument.id == document_id,
        ).with_for_update())).scalar_one_or_none()
        if document is None:
            raise LookupError("Purchase document not found")
        next_state = {
            ("REQUESTED", "approve"): "APPROVED",
            ("REQUESTED", "reject"): "REJECTED",
            ("APPROVED", "place"): "ORDERED",
            ("REQUESTED", "cancel"): "CANCELLED",
            ("APPROVED", "cancel"): "CANCELLED",
            ("ORDERED", "cancel"): "CANCELLED",
        }.get((document.status, action))
        if next_state is None:
            raise ValueError("This purchase action is unavailable in its current state")
        document.status = next_state
        if action == "approve":
            document.approved_by = user_id
            notify_user(db, document.requested_by, kind="purchase_approved", title="تمت الموافقة على طلب الشراء",
                        message="يمكن متابعة الطلب من قسم المشتريات.", href="/purchases")
        elif action == "reject":
            notify_user(db, document.requested_by, kind="purchase_rejected", title="تم رفض طلب الشراء",
                        message="راجع الطلب في قسم المشتريات.", href="/purchases")
        elif action == "place":
            document.ordered_at = datetime.now(timezone.utc)
        db.add(AuditLog(user_id=user_id, action=f"{action.upper()}_PURCHASE_DOCUMENT", entity_type="PurchaseDocument",
                        entity_id=str(document_id), new_value={"status": next_state}))
        await db.commit()

    @staticmethod
    async def receive(db: AsyncSession, document_id: uuid.UUID, payload: PurchaseReceiptInput, user_id: uuid.UUID) -> uuid.UUID:
        fingerprint = request_fingerprint(payload)
        document = (await db.execute(select(PurchaseDocument).where(
            PurchaseDocument.id == document_id,
        ).with_for_update())).scalar_one_or_none()
        if document is None:
            raise LookupError("Purchase document not found")
        prior = (await db.execute(select(PurchaseReceipt).where(
            PurchaseReceipt.request_id == payload.request_id,
        ))).scalar_one_or_none()
        if prior is not None:
            if prior.document_id != document_id or prior.request_fingerprint != fingerprint or prior.received_by != user_id:
                raise ValueError("Request ID was already used for another receipt")
            return prior.id
        if document.status not in ("ORDERED", "PARTIALLY_RECEIVED"):
            raise ValueError("Purchase document is not ready for receiving")
        warehouse = (await db.execute(select(Warehouse).where(
            Warehouse.id == payload.warehouse_id, Warehouse.is_active == True,
        ).with_for_update())).scalar_one_or_none()
        if warehouse is None:
            raise ValueError("Receiving warehouse is unavailable")
        lines = (await db.execute(select(PurchaseDocumentLine).where(
            PurchaseDocumentLine.document_id == document_id,
        ).with_for_update())).scalars().all()
        by_id = {line.id: line for line in lines}
        seen = set()
        receipt_id = uuid.uuid4()
        receipt_rows = []
        for item in payload.lines:
            if item.line_id in seen or item.line_id not in by_id:
                raise ValueError("Receipt contains a duplicate or unrelated line")
            seen.add(item.line_id)
            line = by_id[item.line_id]
            base_quantity = item.base_quantity
            if Decimal(str(line.received_base_quantity)) + base_quantity > Decimal(str(line.base_quantity)):
                raise ValueError("Receipt exceeds the ordered quantity")
            product = (await db.execute(select(Product.id).where(
                Product.id == line.product_id, Product.is_deleted == False, Product.is_bundle == False,
            ))).scalar_one_or_none()
            if product is None:
                raise ValueError("Product is no longer available for receiving")
            balance = (await db.execute(select(InventoryBalance).where(
                InventoryBalance.product_id == line.product_id,
                InventoryBalance.warehouse_id == payload.warehouse_id,
            ).with_for_update())).scalar_one_or_none()
            if balance is None:
                balance = InventoryBalance(product_id=line.product_id, warehouse_id=payload.warehouse_id, current_stock=0)
                db.add(balance)
                await db.flush()
            InventoryService.record_movement(
                db, balance, base_quantity, user_id, TransactionTypeEnum.RECEIVING,
                supplier_id=document.supplier_id, reference_document=str(receipt_id),
                notes=f"Purchase document {document_id}",
                request_id=uuid.uuid5(uuid.NAMESPACE_URL, f"purchase-receipt:{payload.request_id}:{line.id}"),
                request_fingerprint=fingerprint,
            )
            line.received_base_quantity = Decimal(str(line.received_base_quantity)) + base_quantity
            receipt_rows.append(PurchaseReceiptLine(
                receipt_id=receipt_id, document_line_id=line.id,
                base_quantity=base_quantity,
            ))
        db.add(PurchaseReceipt(
            id=receipt_id, document_id=document_id, warehouse_id=payload.warehouse_id,
            request_id=payload.request_id, request_fingerprint=fingerprint, received_by=user_id,
        ))
        db.add_all(receipt_rows)
        document.status = "RECEIVED" if all(
            Decimal(str(line.received_base_quantity)) == Decimal(str(line.base_quantity)) for line in lines
        ) else "PARTIALLY_RECEIVED"
        db.add(AuditLog(user_id=user_id, action="RECEIVE_PURCHASE_DOCUMENT", entity_type="PurchaseDocument",
                        entity_id=str(document_id), new_value={"receipt_id": str(receipt_id), "lines": [line.model_dump(mode="json") for line in payload.lines]}))
        await notify_roles(db, (RoleEnum.ADMIN,), kind="stock_received", title="استلام من أمر شراء",
                           message=f"تم استلام {len(receipt_rows)} صنف", href="/purchases")
        try:
            await db.commit()
        except IntegrityError:
            await db.rollback()
            prior = (await db.execute(select(PurchaseReceipt).where(PurchaseReceipt.request_id == payload.request_id))).scalar_one_or_none()
            if prior is None or prior.document_id != document_id or prior.request_fingerprint != fingerprint or prior.received_by != user_id:
                raise ValueError("Receipt could not be completed")
            return prior.id
        return receipt_id
