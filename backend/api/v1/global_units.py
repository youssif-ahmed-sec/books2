from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy.exc import IntegrityError
from typing import List
from uuid import UUID

from database import get_db
from models.user import User
from models.product import GlobalUnit
from schemas.product import GlobalUnitCreate, GlobalUnitResponse
from core.dependencies import get_current_user, require_inventory_access

router = APIRouter(
    prefix="/global-units",
    tags=["Global Units"],
)

@router.get("", response_model=List[GlobalUnitResponse])
async def list_global_units(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    query = select(GlobalUnit).where(GlobalUnit.is_deleted == False)
    result = await db.execute(query)
    units = result.scalars().all()
    return units

@router.post("", response_model=GlobalUnitResponse, status_code=status.HTTP_201_CREATED)
async def create_global_unit(
    unit_in: GlobalUnitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_inventory_access)
):
    # Check if a unit with the same name already exists
    query = select(GlobalUnit).where(
        GlobalUnit.name == unit_in.name,
        GlobalUnit.is_deleted == False
    )
    result = await db.execute(query)
    existing_unit = result.scalar_one_or_none()
    
    if existing_unit:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="A unit with this name already exists."
        )
        
    new_unit = GlobalUnit(**unit_in.model_dump())
    db.add(new_unit)
    
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A unit with this name already exists."
        )
    except Exception:
        await db.rollback()
        raise
        
    await db.refresh(new_unit)
    return new_unit
