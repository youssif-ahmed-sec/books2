from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from uuid import UUID
from typing import List

from models.order import Order, OrderItem
from models.inventory import InventoryBalance, InventoryTransaction
from models.product import Product
from schemas.order import OrderCreate, OrderResponse
from database import get_db

router = APIRouter(prefix="/orders", tags=["Orders"])

# Mock get_current_user for now since auth integration is partial
async def get_current_user():
    return type('User', (object,), {"id": UUID("00000000-0000-0000-0000-000000000000")})()

@router.post("", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
async def create_order(
    order_in: OrderCreate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """
    Create a new order (POS checkout).
    Deducts inventory balances for each item.
    """
    # 1. Create the Order
    order = Order(
        customer_id=order_in.customer_id,
        user_id=current_user.id,
        status=order_in.status,
        total_amount=order_in.total_amount,
        tax_amount=order_in.tax_amount,
        discount_amount=order_in.discount_amount,
        payment_method=order_in.payment_method,
        notes=order_in.notes
    )
    db.add(order)
    await db.flush()

    # 2. Add Items & Deduct Inventory
    items_response = []
    
    # In a real app, you'd allow user to select warehouse for POS. We use the first warehouse for now.
    # We could fetch the 'Main' warehouse or let the POS send the warehouse_id. 
    # For simplicity, we just find any warehouse balance for the product and deduct.
    
    for item_in in order_in.items:
        order_item = OrderItem(
            order_id=order.id,
            product_id=item_in.product_id,
            unit_id=item_in.unit_id,
            quantity=item_in.quantity,
            unit_price=item_in.unit_price,
            total_price=item_in.total_price
        )
        db.add(order_item)
        await db.flush()
        items_response.append(order_item)
        
        # Deduct Inventory
        bal_query = select(InventoryBalance).where(InventoryBalance.product_id == item_in.product_id)
        bal_res = await db.execute(bal_query)
        balance = bal_res.scalars().first()
        
        if balance:
            if balance.current_stock < item_in.quantity:
                # Warning: Negative stock
                pass
            
            balance.current_stock -= item_in.quantity
            
            # Record Transaction
            tx = InventoryTransaction(
                product_id=item_in.product_id,
                warehouse_id=balance.warehouse_id,
                transaction_type="Issuing",
                quantity_changed=-item_in.quantity,
                balance_after=balance.current_stock,
                reference_id=str(order.id),
                notes=f"POS Order {order.id}",
                created_by=current_user.id
            )
            db.add(tx)
        
    await db.commit()
    
    # Return response
    order_dict = order.__dict__.copy()
    order_dict["items"] = items_response
    return order_dict

@router.get("", response_model=List[OrderResponse])
async def get_orders(db: AsyncSession = Depends(get_db)):
    """
    Get all orders with items.
    """
    query = select(Order).order_by(Order.created_at.desc())
    result = await db.execute(query)
    orders = result.scalars().all()
    
    responses = []
    for o in orders:
        items_query = select(OrderItem).where(OrderItem.order_id == o.id)
        items_res = await db.execute(items_query)
        items = items_res.scalars().all()
        
        o_dict = o.__dict__.copy()
        o_dict["items"] = items
        responses.append(o_dict)
        
    return responses
