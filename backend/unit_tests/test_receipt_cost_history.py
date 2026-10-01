from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.ext.compiler import compiles
from sqlalchemy.pool import StaticPool

from api.v1.inventory import create_inventory_transaction
from api.v1.suppliers import get_supplier_detail
from models.inventory import InventoryTransaction, TransactionTypeEnum, Warehouse
from models.product import Product, Supplier
from models.user import Base, RoleEnum, User
from schemas.inventory import InventoryTransactionCreate


@compiles(JSONB, "sqlite")
def compile_jsonb_for_test(_element, _compiler, **_kwargs):
    return "JSON"


@pytest.mark.asyncio
async def test_supplier_statement_uses_each_receipt_cost_and_supplier_snapshot():
    engine = create_async_engine("sqlite+aiosqlite://", poolclass=StaticPool)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    factory = async_sessionmaker(engine, expire_on_commit=False)
    user = User(id=uuid4(), role=RoleEnum.ADMIN)
    first = Supplier(id=uuid4(), name="First", opening_balance=0)
    second = Supplier(id=uuid4(), name="Second", opening_balance=0)
    product = Product(id=uuid4(), sku="HIST-1", name_en="Book", name_ar="كتاب",
                      base_unit="Piece", supplier_id=first.id, cost=Decimal("5"))
    warehouse = Warehouse(id=uuid4(), name="Main")
    async with factory() as db:
        db.add_all([user, first, second, product, warehouse])
        await db.commit()

        async def receive(supplier_id, cost):
            return await create_inventory_transaction(InventoryTransactionCreate(
                product_id=product.id, warehouse_id=warehouse.id,
                transaction_type="Receiving", quantity_changed=Decimal("2"),
                supplier_id=supplier_id, unit_cost=cost,
            ), db=db, current_user=user)

        await receive(first.id, Decimal("7"))
        product.cost = Decimal("100")
        product.supplier_id = second.id
        await db.commit()
        await receive(second.id, Decimal("9"))

        first_statement = await get_supplier_detail(first.id, db=db, current_user=user)
        second_statement = await get_supplier_detail(second.id, db=db, current_user=user)
        assert first_statement.total_purchases == Decimal("14")
        assert first_statement.balance == Decimal("14")
        assert second_statement.total_purchases == Decimal("18")
        assert second_statement.balance == Decimal("18")

        # A legacy receipt has no reliable cost or supplier attribution.
        db.add(InventoryTransaction(
            product_id=product.id, warehouse_id=warehouse.id, user_id=user.id,
            transaction_type=TransactionTypeEnum.RECEIVING, quantity_changed=1,
        ))
        await db.commit()
        first_statement = await get_supplier_detail(first.id, db=db, current_user=user)
        assert first_statement.total_purchases == Decimal("14")
        assert first_statement.balance is None
        assert first_statement.statement_incomplete is True
        assert first_statement.unattributed_receipts == 1

        db.add(InventoryTransaction(
            product_id=product.id, warehouse_id=warehouse.id, user_id=user.id,
            transaction_type=TransactionTypeEnum.RECEIVING, quantity_changed=1,
            notes="Initial stock from product creation",
        ))
        await db.commit()
        first_statement = await get_supplier_detail(first.id, db=db, current_user=user)
        assert first_statement.unattributed_receipts == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_receipt_requires_actual_cost_and_supplier_before_stock_changes():
    class NoDatabaseCalls:
        commits = 0

        async def execute(self, _query):
            raise AssertionError("Receipt validation should precede database access")

    session = NoDatabaseCalls()
    transaction = InventoryTransactionCreate(
        product_id=uuid4(), warehouse_id=uuid4(),
        transaction_type="Receiving", quantity_changed=1,
    )
    with pytest.raises(HTTPException) as error:
        await create_inventory_transaction(transaction, db=session, current_user=User(id=uuid4(), role=RoleEnum.ADMIN))
    assert error.value.status_code == 422
    assert session.commits == 0
