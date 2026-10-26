import pytest

from print_agent.printer import PrinterManager


@pytest.mark.parametrize("renderer,payload", [
    ("_generate_stock_receipt_image", {"supplier_name": "مورد", "warehouse_name": "مخزن", "lines": []}),
    ("_generate_purchase_document_image", {"supplier_name": "مورد", "status": "تم الطلب", "lines": []}),
    ("_generate_sales_return_image", {"kind": "REFUND", "returned_lines": [], "replacement_lines": []}),
])
def test_document_prints_short_number_with_sales_sized_barcode(renderer, payload):
    manager = PrinterManager.__new__(PrinterManager)
    seen = []
    original = manager._document_barcode

    def capture(image, y, value, scale, **kwargs):
        bottom = original(image, y, value, scale, **kwargs)
        seen.append((str(value), kwargs, bottom))
        return bottom

    manager._document_barcode = capture
    image = getattr(manager, renderer)({"id": "legacy-id", "public_number": 100011, **payload})

    assert image.width == manager.PAPER_WIDTH_PX * manager.RENDER_SCALE
    assert len(seen) == 1
    assert seen[0][:2] == ("100011", {"large": True, "show_text": False})
    assert image.height >= seen[0][2]


def test_stock_receipt_prints_api_lines():
    manager = PrinterManager.__new__(PrinterManager)
    line = {"product_name": "كتاب", "unit_name": "قطعة", "quantity": 2}
    seen = []
    original = manager._quantity_table

    def capture(image, y, rows, scale):
        seen.extend(rows)
        return original(image, y, rows, scale)

    manager._quantity_table = capture
    manager._generate_stock_receipt_image({"public_number": 100012, "lines": [line]})
    assert seen == [line]


def test_wallet_exchange_footer_is_not_cropped():
    manager = PrinterManager.__new__(PrinterManager)
    bottom = []
    original = manager._document_footer

    def capture(image, y, number, scale):
        result = original(image, y, number, scale)
        bottom.append(result)
        return result

    manager._document_footer = capture
    image = manager._generate_sales_return_image({
        "public_number": 100013,
        "order_public_number": 100011,
        "exchange_order_public_number": 100012,
        "kind": "EXCHANGE",
        "payment_method": "Wallet",
        "charge_amount": "125.00",
        "wallet_fee_amount": "1.25",
        "collection_amount": "126.25",
        "returned_lines": [{"product_name": "كتاب قديم", "quantity": 1, "amount": 25}],
        "replacement_lines": [{"product_name": "كتاب جديد", "quantity": 1, "amount": 150}],
    })
    assert image.height >= bottom[0]
