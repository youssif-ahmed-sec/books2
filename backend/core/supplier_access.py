from models.user import RoleEnum
from schemas.product import SupplierDetailResponse, SupplierResponse


def visible_supplier(supplier, role: RoleEnum) -> SupplierResponse:
    response = SupplierResponse.model_validate(supplier)
    if role != RoleEnum.ADMIN:
        response.opening_balance = None
        response.credit_limit = None
    return response


def visible_supplier_detail(data: dict, role: RoleEnum) -> SupplierDetailResponse:
    response = SupplierDetailResponse.model_validate(data)
    if role != RoleEnum.ADMIN:
        response.opening_balance = None
        response.credit_limit = None
        response.total_purchases = None
        response.total_payments = None
        response.balance = None
        response.statement_incomplete = False
        response.unpriced_receipts = 0
        response.unattributed_receipts = 0
        response.payments = []
    return response
