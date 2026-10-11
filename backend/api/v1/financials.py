from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import List
from uuid import UUID

from database import get_db
from core.dependencies import require_financial_access
from models.financial import Expense, Income
from schemas.financial import ExpenseCreate, ExpenseResponse, IncomeCreate, IncomeResponse
from models.user import AuditLog, User

router = APIRouter(
    prefix="/financials", tags=["Financials"],
    dependencies=[Depends(require_financial_access)],
)

@router.get("/expenses", response_model=List[ExpenseResponse])
async def get_expenses(db: AsyncSession = Depends(get_db)):
    query = select(Expense).order_by(Expense.expense_date.desc())
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/expenses", response_model=ExpenseResponse, status_code=status.HTTP_201_CREATED)
async def create_expense(expense_in: ExpenseCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_financial_access)):
    new_expense = Expense(**expense_in.model_dump())
    db.add(new_expense)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="CREATE_EXPENSE", entity_type="Expense", entity_id=str(new_expense.id), new_value={"amount": str(new_expense.amount), "category": new_expense.category}))
    await db.commit()
    await db.refresh(new_expense)
    return new_expense

@router.get("/incomes", response_model=List[IncomeResponse])
async def get_incomes(db: AsyncSession = Depends(get_db)):
    query = select(Income).order_by(Income.income_date.desc())
    result = await db.execute(query)
    return result.scalars().all()

@router.post("/incomes", response_model=IncomeResponse, status_code=status.HTTP_201_CREATED)
async def create_income(income_in: IncomeCreate, db: AsyncSession = Depends(get_db), user: User = Depends(require_financial_access)):
    new_income = Income(**income_in.model_dump())
    db.add(new_income)
    await db.flush()
    db.add(AuditLog(user_id=user.id, action="CREATE_INCOME", entity_type="Income", entity_id=str(new_income.id), new_value={"amount": str(new_income.amount), "source": new_income.source}))
    await db.commit()
    await db.refresh(new_income)
    return new_income
