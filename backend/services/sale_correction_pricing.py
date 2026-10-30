"""Resolve correction line prices from trusted sale snapshots or the catalog.

This is only price resolution. The caller must authorize the operation, enforce
pricing policy, quote totals and settle stock, debt and payments transactionally.
"""
from dataclasses import dataclass
from copy import deepcopy
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.order import OrderItem
from models.product import PriceLevelEnum, Product, ProductBundleComponent, ProductPrice, ProductUnit


class CorrectionLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    product_id: UUID
    unit_id: UUID
    price_level: PriceLevelEnum
    quantity: Decimal = Field(gt=0, allow_inf_nan=False, max_digits=10, decimal_places=2)
    original_item_id: UUID | None = None


class CorrectionLines(BaseModel):
    items: list[CorrectionLine] = Field(min_length=1)

    @model_validator(mode="after")
    def original_lines_are_unique(self):
        ids = [item.original_item_id for item in self.items if item.original_item_id is not None]
        if len(ids) != len(set(ids)):
            raise ValueError("An original line cannot be reused twice.")
        return self


@dataclass(frozen=True)
class PricedCorrectionLine:
    product_id: UUID
    unit_id: UUID
    price_level: str
    quantity: Decimal
    unit_price: Decimal
    conversion_factor: Decimal
    original_item_id: UUID | None
    bundle_components_snapshot: list | None
    tax_rate: Decimal | None = None
    base_cost: Decimal | None = None


def _component_signature(snapshot):
    try:
        if not isinstance(snapshot, list):
            raise ValueError
        parts = [(str(UUID(part["product_id"])), Decimal(str(part["quantity"]))) for part in snapshot]
        if any(not amount.is_finite() or amount <= 0 for _, amount in parts):
            raise ValueError
        totals = {}
        for product_id, amount in parts:
            totals[product_id] = totals.get(product_id, Decimal("0")) + amount
        return sorted(totals.items())
    except (TypeError, KeyError, ValueError, ArithmeticError) as exc:
        raise ValueError("The original bundle components need manual review.") from exc


async def resolve_correction_prices(db: AsyncSession, order_id: UUID, lines: CorrectionLines) -> list[PricedCorrectionLine]:
    await db.flush()
    originals = (await db.execute(select(OrderItem).where(OrderItem.order_id == order_id)
                                  .execution_options(populate_existing=True))).scalars().all()
    by_id = {row.id: row for row in originals}
    products = {row.id: row for row in (await db.execute(select(Product).where(
        Product.id.in_({item.product_id for item in lines.items}),
    ).execution_options(populate_existing=True))).scalars().all()}
    units = {row.id: row for row in (await db.execute(select(ProductUnit).where(
        ProductUnit.id.in_({item.unit_id for item in lines.items}),
    ).execution_options(populate_existing=True))).scalars().all()}
    prices = (await db.execute(select(ProductPrice).where(
        ProductPrice.product_id.in_({item.product_id for item in lines.items}),
        ProductPrice.unit_id.in_({item.unit_id for item in lines.items}),
        ProductPrice.is_deleted == False,
    ).execution_options(populate_existing=True))).scalars().all()
    by_price = {(p.product_id, p.unit_id, p.price_level): p for p in prices}
    components = (await db.execute(select(ProductBundleComponent).where(
        ProductBundleComponent.bundle_id.in_({item.product_id for item in lines.items}),
        ProductBundleComponent.is_deleted == False,
    ).execution_options(populate_existing=True))).scalars().all()
    recipes = {}
    for component in components:
        recipes.setdefault(component.bundle_id, []).append((str(component.component_id), Decimal(str(component.quantity))))
    component_ids = {component.component_id for component in components}
    component_products = {row.id: row for row in (await db.execute(select(Product).where(
        Product.id.in_(component_ids),
    ).execution_options(populate_existing=True))).scalars().all()} if component_ids else {}
    resolved = []
    for line in lines.items:
        product, unit = products.get(line.product_id), units.get(line.unit_id)
        original = by_id.get(line.original_item_id) if line.original_item_id else None
        if line.original_item_id and (original is None or original.product_id != line.product_id
                                      or original.unit_id != line.unit_id or original.price_level != line.price_level.value):
            raise ValueError("The original line does not match this sale, product, unit and price level.")
        active = bool(product and unit and unit.product_id == line.product_id
                      and product.is_active and not product.is_deleted and not unit.is_deleted)
        if original is not None:
            snapshot = deepcopy(original.bundle_components_snapshot)
            if snapshot is None:
                raise ValueError("The original bundle components need manual review.")
            original_recipe = _component_signature(snapshot)
            # Never use changed package contents/conversion to increase a historical line.
            if line.quantity > Decimal(str(original.quantity_requested)) and (
                not active or Decimal(str(unit.conversion_factor)) != Decimal(str(original.conversion_factor))
                or bool(product.is_bundle) != bool(snapshot)
                or (bool(snapshot) and original_recipe != _component_signature([
                    {"product_id": component_id, "quantity": str(quantity)} for component_id, quantity in recipes.get(product.id, [])]))
            ):
                raise ValueError("The original unit changed or is unavailable; add a new line for extra quantity.")
            unit_price = Decimal(str(original.unit_price))
            conversion = Decimal(str(original.conversion_factor))
            tax_rate = Decimal(str(original.tax_rate)) if original.tax_rate is not None else None
            base_cost = (Decimal(str(original.cost_at_sale)) / Decimal(str(original.quantity_actual))
                         if original.cost_at_sale is not None and Decimal(str(original.quantity_actual)) > 0 else None)
        else:
            price = by_price.get((line.product_id, line.unit_id, line.price_level.value))
            if not active or price is None or (product.is_bundle and not recipes.get(product.id)):
                raise ValueError("The new product, unit or price is unavailable.")
            unit_price = Decimal(str(price.price))
            conversion = Decimal(str(unit.conversion_factor))
            tax_rate = Decimal(str(product.tax_rate)) if product.tax_rate is not None else None
            snapshot = [{"product_id": component_id, "quantity": str(quantity)}
                        for component_id, quantity in sorted(recipes.get(product.id, []))] if product.is_bundle else []
            if product.is_bundle:
                base_cost = Decimal("0")
                for component_id, quantity in recipes[product.id]:
                    component = component_products.get(UUID(component_id))
                    if component is None or component.is_deleted:
                        raise ValueError("The new product, unit or price is unavailable.")
                    base_cost += Decimal(str(component.cost or 0)) * quantity
            else:
                base_cost = Decimal(str(product.cost)) if product.cost is not None else None
        if not unit_price.is_finite() or unit_price <= 0 or not conversion.is_finite() or conversion <= 0:
            raise ValueError("The price or unit conversion is invalid.")
        resolved.append(PricedCorrectionLine(line.product_id, line.unit_id, line.price_level.value,
                                              line.quantity, unit_price, conversion, line.original_item_id, snapshot,
                                              tax_rate, base_cost))
    return resolved
