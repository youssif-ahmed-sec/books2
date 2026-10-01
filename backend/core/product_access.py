from models.user import RoleEnum
from schemas.product import ProductResponse


def visible_product(product, role: RoleEnum) -> ProductResponse:
    response = ProductResponse.model_validate(product)
    if role not in (RoleEnum.ADMIN, RoleEnum.INVENTORY_CONTROLLER):
        response.cost = None
    return response
