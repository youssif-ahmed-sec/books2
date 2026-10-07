from models.order import OrderStatusEnum


_PIPELINE = (
    OrderStatusEnum.NEW_LEAD,
    OrderStatusEnum.DRAFT,
    OrderStatusEnum.WAITING_QUOTATION,
    OrderStatusEnum.QUOTATION_SENT,
    OrderStatusEnum.WAITING_APPROVAL,
    OrderStatusEnum.APPROVED,
    OrderStatusEnum.PREPARING,
    OrderStatusEnum.READY,
    OrderStatusEnum.DELIVERED,
    OrderStatusEnum.CLOSED,
)


def allowed_next_statuses(current_status: str) -> list[str]:
    for position, status in enumerate(_PIPELINE):
        if current_status == status.value:
            next_statuses = [] if position == len(_PIPELINE) - 1 else [_PIPELINE[position + 1].value]
            if status not in (OrderStatusEnum.DELIVERED, OrderStatusEnum.CLOSED):
                next_statuses.append(OrderStatusEnum.CANCELLED.value)
            return next_statuses
    return []
