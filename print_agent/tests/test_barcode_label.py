from fastapi import HTTPException
import pytest

from print_agent.config import config
from print_agent.printer import PrinterManager, _PrintDraw
from print_agent.service import PrintJob, print_order, thermal_printer


SAMPLE = {
    "name_ar": "كتاب تجريبي",
    "barcode": "INV-SAMPLE-001",
    "sell_price": "120.00",
    "quantity": 1,
}


def test_barcode_label_has_scannable_width_and_quiet_zones():
    manager = PrinterManager.__new__(PrinterManager)
    image = manager._generate_barcode_image(SAMPLE)
    assert image.width == manager.PAPER_WIDTH_PX * manager.RENDER_SCALE
    scale = manager.RENDER_SCALE
    assert 200 * scale < image.height < 320 * scale
    barcode_band = image.crop((0, 100 * scale, image.width, 150 * scale))
    dark_columns = [x for x in range(barcode_band.width) if barcode_band.getpixel((x, 25 * scale))[0] < 128]
    assert len(dark_columns) > 100
    assert min(dark_columns) > 50
    assert max(dark_columns) < image.width - 50


def test_barcode_label_renders_the_selected_unit_price(monkeypatch):
    drawn = []
    original = _PrintDraw.text

    def capture(self, xy, value, *args, **kwargs):
        drawn.append(str(value))
        return original(self, xy, value, *args, **kwargs)

    monkeypatch.setattr(_PrintDraw, "text", capture)
    manager = PrinterManager.__new__(PrinterManager)
    manager._generate_barcode_image({**SAMPLE, "name_ar": "بالون", "unit_name": "كيس", "sell_price": "45.00"})
    assert any("بالون" in value and "كيس" in value for value in drawn)
    assert any("45.00" in value for value in drawn)


@pytest.mark.parametrize("code", ["", "اسم عربي", "A\nB", "X" * 64])
def test_invalid_or_unprintable_barcode_is_rejected(code):
    manager = PrinterManager.__new__(PrinterManager)
    with pytest.raises(ValueError):
        manager._generate_barcode_image({**SAMPLE, "barcode": code, "sku": ""})


@pytest.mark.parametrize("quantity", [0, -1, 21, 1.5, True, "2"])
def test_barcode_print_quantity_is_bounded(quantity):
    manager = PrinterManager.__new__(PrinterManager)
    with pytest.raises(ValueError, match="quantity"):
        manager.print_receipt({**SAMPLE, "quantity": quantity}, "barcode")


def test_barcode_api_returns_validation_error_before_queue(monkeypatch):
    monkeypatch.setattr(config, "_data", {**config._data, "barcode_printer_names": ["test printer"]})
    monkeypatch.setattr(thermal_printer, "get_printers", lambda: ["test printer"])
    with pytest.raises(HTTPException) as error:
        print_order(PrintJob(order={**SAMPLE, "barcode": "اسم عربي"}, receipt_type="barcode"))
    assert error.value.status_code == 422
