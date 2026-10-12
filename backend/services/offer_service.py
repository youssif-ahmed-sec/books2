import uuid
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models.product import PriceLevelEnum, Product, ProductBundleComponent, ProductPrice, ProductUnit
from models.user import AuditLog
from schemas.offer import OfferInput
from services.product_service import ProductService


PRICE_LEVELS = tuple(PriceLevelEnum)


class OfferService:
    @staticmethod
    def _query():
        components = Product.bundle_components.and_(ProductBundleComponent.is_deleted == False)
        return select(Product).where(Product.is_bundle == True, Product.is_deleted == False).options(
            selectinload(Product.units.and_(ProductUnit.is_deleted == False)).selectinload(
                ProductUnit.prices.and_(ProductPrice.is_deleted == False)),
            selectinload(components).selectinload(ProductBundleComponent.component),
            selectinload(components).selectinload(ProductBundleComponent.unit).selectinload(
                ProductUnit.prices.and_(ProductPrice.is_deleted == False)),
        )

    @staticmethod
    def serialize(offer: Product) -> dict:
        unit = next((item for item in offer.units if not item.is_deleted and item.unit_name == "عرض" and item.conversion_factor == 1), None)
        sale = next((price.price for price in unit.prices if price.price_level == PriceLevelEnum.RETAIL), None) if unit else None
        lines = []
        reference_total = Decimal("0")
        for component in offer.bundle_components:
            selected_unit = component.unit
            factor = Decimal(str(selected_unit.conversion_factor)) if selected_unit else Decimal("1")
            count = Decimal(str(component.quantity)) / factor
            price = next((p.price for p in selected_unit.prices if p.price_level == component.price_level), None) if selected_unit else None
            line_total = Decimal(str(price)) * count if price is not None else None
            if line_total is not None:
                reference_total += line_total
            lines.append({
                "component_id": str(component.component_id),
                "product_name": component.component.name_ar if component.component else "صنف غير متاح",
                "unit_id": str(selected_unit.id) if selected_unit else None,
                "unit_name": selected_unit.unit_name if selected_unit else None,
                "price_level": component.price_level.value if component.price_level else None,
                "quantity": str(count),
                "unit_price": str(price) if price is not None else None,
                "line_total": str(line_total) if line_total is not None else None,
            })
        return {
            "id": str(offer.id), "name": offer.name_ar, "is_active": offer.is_active,
            "sale_price": str(sale) if sale is not None else None,
            "reference_total": str(reference_total), "components": lines,
        }

    @staticmethod
    async def list_offers(db: AsyncSession) -> list[dict]:
        offers = (await db.execute(OfferService._query().order_by(Product.created_at.desc()))).scalars().unique().all()
        return [OfferService.serialize(offer) for offer in offers]

    @staticmethod
    async def get_offer(db: AsyncSession, offer_id: uuid.UUID) -> dict | None:
        offer = (await db.execute(OfferService._query().where(Product.id == offer_id))).scalar_one_or_none()
        return OfferService.serialize(offer) if offer else None

    @staticmethod
    async def _components(db: AsyncSession, payload: OfferInput, offer_id: uuid.UUID):
        rows = []
        for line in payload.components:
            product = (await db.execute(select(Product).where(
                Product.id == line.component_id, Product.is_deleted == False,
                Product.is_active == True, Product.is_bundle == False,
            ))).scalar_one_or_none()
            if product is None or line.component_id == offer_id:
                raise ValueError("Selected product is unavailable")
            unit = (await db.execute(select(ProductUnit).where(
                ProductUnit.id == line.unit_id, ProductUnit.product_id == line.component_id,
                ProductUnit.is_deleted == False,
            ))).scalar_one_or_none()
            if unit is None:
                raise ValueError("Selected unit is unavailable for this product")
            price = (await db.execute(select(ProductPrice).where(
                ProductPrice.product_id == line.component_id, ProductPrice.unit_id == unit.id,
                ProductPrice.price_level == line.price_level, ProductPrice.is_deleted == False,
            ))).scalar_one_or_none()
            if price is None or price.price is None or price.price <= 0:
                raise ValueError("Selected price level is unavailable for this unit")
            base_quantity = Decimal(line.quantity) * Decimal(str(unit.conversion_factor))
            if base_quantity > Decimal("99999999.99"):
                raise ValueError("Offer component quantity is too large")
            rows.append(ProductBundleComponent(
                bundle_id=offer_id, component_id=line.component_id,
                unit_id=unit.id, price_level=line.price_level, quantity=base_quantity,
            ))
        return rows

    @staticmethod
    async def save(db: AsyncSession, payload: OfferInput, user_id: uuid.UUID, offer_id: uuid.UUID | None = None) -> uuid.UUID:
        if offer_id is None:
            offer_id = uuid.uuid4()
            offer = Product(
                id=offer_id, sku=f"OFFER-{uuid.uuid4().hex[:10].upper()}",
                name_ar=payload.name, name_en="", base_unit="عرض",
                cost=0, tax_rate=0, is_bundle=True, is_active=True,
            )
            db.add(offer)
            await db.flush()
            unit = ProductUnit(product_id=offer_id, unit_name="عرض", conversion_factor=1)
            db.add(unit)
            await db.flush()
            action = "CREATE_OFFER"
        else:
            offer = (await db.execute(select(Product).where(
                Product.id == offer_id, Product.is_bundle == True, Product.is_deleted == False,
            ).with_for_update())).scalar_one_or_none()
            if offer is None:
                raise LookupError("Offer not found")
            offer.name_ar = payload.name
            units = (await db.execute(select(ProductUnit).where(
                ProductUnit.product_id == offer_id, ProductUnit.is_deleted == False,
            ).with_for_update())).scalars().all()
            unit = next((item for item in units if item.unit_name == "عرض" and item.conversion_factor == 1), None)
            if unit is None:
                unit = ProductUnit(product_id=offer_id, unit_name="عرض", conversion_factor=1)
                db.add(unit)
                await db.flush()
            for old_unit in units:
                if old_unit.id != unit.id:
                    old_unit.is_deleted = True
            old_components = (await db.execute(select(ProductBundleComponent).where(
                ProductBundleComponent.bundle_id == offer_id, ProductBundleComponent.is_deleted == False,
            ).with_for_update())).scalars().all()
            for component in old_components:
                component.is_deleted = True
            action = "UPDATE_OFFER"

        rows = await OfferService._components(db, payload, offer_id)
        db.add_all(rows)
        prices = (await db.execute(select(ProductPrice).where(
            ProductPrice.product_id == offer_id,
        ).with_for_update())).scalars().all()
        by_level = {(price.unit_id, price.price_level): price for price in prices}
        for old_price in prices:
            old_price.is_deleted = True
        for level in PRICE_LEVELS:
            saved = by_level.get((unit.id, level))
            if saved is None:
                db.add(ProductPrice(product_id=offer_id, unit_id=unit.id, price_level=level, price=payload.sale_price))
            else:
                saved.price = payload.sale_price
                saved.is_deleted = False
        db.add(AuditLog(
            user_id=user_id, action=action, entity_type="Product", entity_id=str(offer_id),
            new_value={"name": payload.name, "sale_price": str(payload.sale_price),
                       "components": [line.model_dump(mode="json") for line in payload.components]},
        ))
        await db.commit()
        return offer_id

    @staticmethod
    async def set_active(db: AsyncSession, offer_id: uuid.UUID, active: bool, user_id: uuid.UUID) -> bool:
        offer = (await db.execute(select(Product).where(
            Product.id == offer_id, Product.is_bundle == True, Product.is_deleted == False,
        ).with_for_update())).scalar_one_or_none()
        if offer is None:
            return False
        if active:
            components = (await db.execute(select(ProductBundleComponent).where(
                ProductBundleComponent.bundle_id == offer_id, ProductBundleComponent.is_deleted == False,
            ))).scalars().all()
            if any(component.unit_id is None or component.price_level is None for component in components):
                raise ValueError("Edit the offer and select a unit and price for every component before activation")
            await ProductService.validate_bundle_components(db, offer_id, components)
            offer_unit = (await db.execute(select(ProductUnit).where(
                ProductUnit.product_id == offer_id, ProductUnit.is_deleted == False,
                ProductUnit.unit_name == "عرض", ProductUnit.conversion_factor == 1,
            ))).scalars().first()
            if offer_unit is None:
                raise ValueError("Offer sale unit is missing")
            sale_prices = (await db.execute(select(ProductPrice).where(
                ProductPrice.product_id == offer_id, ProductPrice.unit_id == offer_unit.id,
                ProductPrice.is_deleted == False,
            ))).scalars().all()
            if any(not any(price.price_level == level and price.price > 0 for price in sale_prices) for level in PRICE_LEVELS):
                raise ValueError("Offer sale price is incomplete; edit the offer before activation")
        offer.is_active = active
        db.add(AuditLog(user_id=user_id, action="ACTIVATE_OFFER" if active else "DEACTIVATE_OFFER",
                        entity_type="Product", entity_id=str(offer_id), new_value={"is_active": active}))
        await db.commit()
        return True
