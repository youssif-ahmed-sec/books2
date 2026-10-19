from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_admin, require_inventory_access
from database import get_db
from models.user import User
from schemas.offer import OfferInput, OfferStatusInput
from services.offer_service import OfferService
from services.product_service import ProductService


router = APIRouter(prefix="/offers", tags=["Offers"])


@router.get("")
async def list_offers(db: AsyncSession = Depends(get_db), _user: User = Depends(require_inventory_access)):
    return await OfferService.list_offers(db)


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_offer(payload: OfferInput, db: AsyncSession = Depends(get_db), user: User = Depends(require_inventory_access)):
    try:
        offer_id = await OfferService.save(db, payload, user.id)
        return await OfferService.get_offer(db, offer_id)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{offer_id}")
async def update_offer(offer_id: UUID, payload: OfferInput, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    try:
        saved_id = await OfferService.save(db, payload, user.id, offer_id)
        return await OfferService.get_offer(db, saved_id)
    except LookupError as exc:
        await db.rollback()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.patch("/{offer_id}/status")
async def set_offer_status(offer_id: UUID, payload: OfferStatusInput, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    try:
        found = await OfferService.set_active(db, offer_id, payload.is_active, user.id)
    except ValueError as exc:
        await db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not found:
        raise HTTPException(status_code=404, detail="Offer not found")
    return await OfferService.get_offer(db, offer_id)


@router.delete("/{offer_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_offer(offer_id: UUID, db: AsyncSession = Depends(get_db), user: User = Depends(require_admin)):
    offer = await OfferService.get_offer(db, offer_id)
    if offer is None:
        raise HTTPException(status_code=404, detail="Offer not found")
    try:
        deleted = await ProductService.delete_product(db, offer_id, user.id, require_bundle=True)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Offer not found")
