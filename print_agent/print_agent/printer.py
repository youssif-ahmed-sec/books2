import logging
import queue
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

import qrcode
import barcode
from barcode.writer import ImageWriter
import win32print
import win32ui
from PIL import Image, ImageDraw, ImageFont, ImageWin

from print_agent.config import config

log = logging.getLogger("topchef_print_agent")


def is_arabic(text: str) -> bool:
    if not isinstance(text, str):
        return False
    return any(
        "\u0600" <= c <= "\u06ff"
        or "\u0750" <= c <= "\u077f"
        or "\u08a0" <= c <= "\u08ff"
        or "\ufb50" <= c <= "\ufdff"
        or "\ufe70" <= c <= "\ufeff"
        for c in text
    )


class PrinterManager:
    PAPER_WIDTH_PX = 576
    MARGIN = 16
    CONTENT_WIDTH = PAPER_WIDTH_PX - (MARGIN * 2)
    RENDER_SCALE = 2

    @staticmethod
    def _paste_store_logo(image: Image.Image, y: int, scale: int) -> int:
        path = Path(__file__).resolve().parent / "assets" / "saud-logo.jpg"
        if not path.is_file():
            return y
        with Image.open(path) as source:
            logo = source.convert("RGB")
        ink = logo.convert("L").point(lambda value: 255 if value < 230 else 0)
        bounds = ink.getbbox()
        if not bounds:
            return y
        logo = logo.crop(bounds)
        mono = logo.convert("L").point(lambda value: 0 if value < 215 else 255).convert("RGB")
        mono.thumbnail((240 * scale, 80 * scale), Image.Resampling.LANCZOS)
        image.paste(mono, ((image.width - mono.width) // 2, y))
        return y + mono.height + (8 * scale)

    def __init__(self):
        self._job_queue: "queue.Queue[Dict[str, Any]]" = queue.Queue()
        self._worker_thread = threading.Thread(target=self._printer_worker, daemon=True)
        self._worker_thread.start()
        self._last_order_id = None
        self._last_order_data: Dict[str, Any] = {}
        self._last_receipt_type = "customer"

    def start(self):
        if not self._worker_thread.is_alive():
            self._worker_thread = threading.Thread(target=self._printer_worker, daemon=True)
            self._worker_thread.start()
            log.info("Native image printer manager started.")

    def get_printers(self) -> List[str]:
        try:
            flags = win32print.PRINTER_ENUM_LOCAL | win32print.PRINTER_ENUM_CONNECTIONS
            return [p[2] for p in win32print.EnumPrinters(flags)]
        except Exception as exc:
            log.error("Failed to enumerate printers: %s", exc)
            return []

    def test_print(self) -> bool:
        test_order = {
            "id": "TEST",
            "orderNumber": "0000",
            "created_at": datetime.now().isoformat(),
            "creator_name": "Admin",
            "orderType": "hall",
            "itemsTotal": 100.0,
            "grandTotal": 100.0,
            "cart": [{"item": {"name": "تجربة طباعة", "price": 100.0}, "qty": 1}],
        }
        return self.print_receipt(test_order, "test")

    def print_receipt(self, order: Dict[str, Any], receipt_type: str = "customer") -> bool:
        if not order:
            log.warning("No order data provided to native printer.")
            return False
        if receipt_type not in {"customer", "invoice", "barcode", "stock_receipt", "test"}:
            raise ValueError("Unsupported print document type")
        if receipt_type == "barcode":
            copies = order.get("quantity", order.get("qty", 1))
            if isinstance(copies, bool) or not isinstance(copies, int) or not 1 <= copies <= 20:
                raise ValueError("Barcode quantity must be an integer from 1 to 20")
            self._generate_barcode_image(order)
        self._last_order_id = order.get("id")
        self._last_order_data = order
        self._last_receipt_type = receipt_type
        document_name = f"order-{self._value(order, 'order_number', 'orderNumber', 'id', default='receipt')}"
        self._job_queue.put({"document_name": document_name, "order": order, "receipt_type": receipt_type})
        return True

    def print_html(self, html_content: str, document_name: str = "Souod El Shafie Receipt", order_data: dict = None) -> bool:
        order = order_data or {}
        if not order:
            log.warning("Frontend silent print did not include order data; native print skipped.")
            return False
        self._last_order_id = order.get("id")
        self._last_order_data = order
        self._last_receipt_type = "customer"
        self._job_queue.put({"document_name": document_name, "order": order, "receipt_type": "customer"})
        return True

    def reprint_last(self, receipt_type: str = "customer") -> bool:
        if not self._last_order_data:
            log.warning("No last order to reprint")
            return False
        self._job_queue.put(
            {
                "document_name": f"reprint-{self._last_order_id or 'receipt'}",
                "order": self._last_order_data,
                "receipt_type": receipt_type,
            }
        )
        return True

    def _value(self, payload: Dict[str, Any], *keys: str, default: Any = "") -> Any:
        for key in keys:
            value = payload.get(key)
            if value not in (None, ""):
                return value
        return default

    def _number(self, value: Any, default: float = 0.0) -> float:
        try:
            return float(value) if value not in (None, "") else default
        except (TypeError, ValueError):
            return default

    def _format_date_parts(self, raw_value: Any) -> tuple[str, str]:
        if not raw_value:
            return "---", "---"

        value = str(raw_value)
        for candidate in (value, value.replace("Z", "+00:00")):
            try:
                dt = datetime.fromisoformat(candidate)
                return dt.strftime("%Y/%m/%d"), dt.strftime("%I:%M %p")
            except ValueError:
                continue

        if len(value) > 10:
            return value[:10], value[11:16] if len(value) >= 16 else "---"
        return value, "---"

    def _order_type_label(self, order_type: Any) -> str:
        value = str(order_type or "").lower()
        if value == "delivery":
            return "دليفري"
        if value == "takeaway":
            return "تيك اواي"
        if value == "dine_in" or value == "hall":
            return "صالة"
        return "غير محدد"

    def _address_to_text(self, raw_address: Any) -> str:
        if isinstance(raw_address, dict):
            return str(
                raw_address.get("address")
                or raw_address.get("address_line")
                or raw_address.get("full_address")
                or raw_address.get("street")
                or raw_address.get("name")
                or ""
            )
        return str(raw_address or "")

    def _items(self, order: Dict[str, Any]) -> List[Dict[str, Any]]:
        cart = order.get("cart")
        if isinstance(cart, list) and cart:
            return cart

        items = []
        for item in order.get("items") or []:
            items.append(
                {
                    "qty": item.get("quantity", 0),
                    "item": {
                        "name": item.get("product_name") or item.get("name") or f"صنف #{item.get('product_id', '')}",
                        "price": item.get("unit_price", 0),
                    },
                }
            )
        return items

    def _font(self, name: str, size: int):
        paths = [
            f"C:/Windows/Fonts/{name}.ttf",
            "C:/Windows/Fonts/arial.ttf",
        ]
        for path in paths:
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
        return ImageFont.load_default()

    def _get_fonts(self, scale: int = 1):
        def size(value: int) -> int:
            return int(value * scale)

        return {
            "body": self._font("arialbd", size(26)),
            "small": self._font("arialbd", size(27)),
            "tiny": self._font("arialbd", size(25)),
            "item": self._font("arialbd", size(28)),
            "table": self._font("arialbd", size(27)),
            "customer": self._font("arialbd", size(26)),
            "footer": self._font("arialbd", size(24)),
            "order": self._font("arialbd", size(35)),
            "grand": self._font("arialbd", size(33)),
        }

    def _generate_stock_receipt_image(self, receipt: Dict[str, Any]) -> Image.Image:
        scale = self.RENDER_SCALE
        width = self.PAPER_WIDTH_PX * scale
        margin = self.MARGIN * scale
        rows = self._items(receipt)
        fonts = self._get_fonts(scale)
        image = Image.new("RGB", (width, (570 + len(rows) * 100) * scale), "white")
        draw = ImageDraw.Draw(image)
        right = width - margin
        y = self._paste_store_logo(image, margin, scale) + 20 * scale

        def write(value, font=fonts["small"], step=36):
            nonlocal y
            value = str(value)
            draw.text((right, y), value, fill="black", font=font, anchor="ra",
                      direction="rtl" if is_arabic(value) else "ltr")
            y += step * scale

        write("مكتبة سعود الشافعي", fonts["order"], 55)
        write("فاتورة استلام مخزون", fonts["order"], 52)
        write(f"رقم الاستلام: {receipt.get('id', '')}")
        date_text, time_text = self._format_date_parts(receipt.get("created_at"))
        write(f"التاريخ: {date_text} {time_text}")
        write(f"المورد: {receipt.get('supplier_name', '')}")
        write(f"المخزن: {receipt.get('warehouse_name', '')}")
        if receipt.get("supplier_document"):
            write(f"مستند المورد: {receipt['supplier_document']}")
        y += 12 * scale
        draw.line((margin, y, right, y), fill="black", width=scale)
        y += 18 * scale
        for row in rows:
            item = row.get("item") or row
            name = str(item.get("name") or item.get("product_name") or "")
            unit = str(item.get("unit") or "")
            qty = row.get("qty") or row.get("quantity") or 0
            write(name, fonts["item"], 40)
            write(f"{qty} {unit}", fonts["small"], 38)
            draw.line((margin, y, right, y), fill="#dddddd", width=scale)
            y += 12 * scale
        write(f"عدد الأصناف: {len(rows)}", fonts["small"])
        write("هذا المستند للكميات فقط؛ المديونية تُسجل من حساب المورد.", fonts["small"])
        return image.crop((0, 0, width, min(image.height, y + margin)))

    def _generate_receipt_image(self, order: Dict[str, Any], receipt_type: str = "customer") -> Image.Image:
        scale = self.RENDER_SCALE
        fonts = self._get_fonts(scale)
        items = self._items(order)
        width = self.PAPER_WIDTH_PX * scale
        margin = self.MARGIN * scale
        content_right = width - margin

        def u(value: int | float) -> int:
            return int(round(value * scale))

        # Allocate enough vertical room for wrapped product names and addresses;
        # the image is cropped to the actual drawn height before printing.
        height = u(1050 + (len(items) * 190))
        if self._has_customer_info(order):
            height += u(300)
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)
        y = margin

        def text_size(text: Any, font) -> tuple[int, int]:
            value = str(text)
            box = draw.textbbox((0, 0), value, font=font, direction="rtl" if is_arabic(value) else "ltr")
            return box[2] - box[0], box[3] - box[1]

        def draw_text(text: Any, x: int, y_pos: int, font, anchor: str = "la", fill: str = "black"):
            value = str(text)
            draw.text((x, y_pos), value, fill=fill, font=font, anchor=anchor,
                      direction="rtl" if is_arabic(value) else "ltr")

        def draw_right(text: Any, y_pos: int, font, x: int = content_right):
            draw_text(text, x, y_pos, font, "ra")

        def draw_center(text: Any, y_pos: int, font):
            draw_text(text, width // 2, y_pos, font, "ma")

        def line(y_pos: int, fill: str = "black", dash: bool = False):
            if dash:
                x = margin
                while x < content_right:
                    draw.line((x, y_pos, min(x + u(12), content_right), y_pos), fill=fill, width=scale)
                    x += u(18)
            else:
                draw.line((margin, y_pos, content_right, y_pos), fill=fill, width=scale)

        def wrap_text(text: Any, font, max_width: int) -> list[str]:
            raw = str(text or "")
            if not raw:
                return [""]

            words = raw.split()
            if not words:
                words = list(raw)

            lines: list[str] = []
            current = ""

            def measured(value: str) -> float:
                return draw.textlength(value, font=font, direction="rtl" if is_arabic(value) else "ltr")

            def append_fitted_chunk(chunk: str):
                piece = ""
                for char in chunk:
                    candidate = piece + char
                    if piece and measured(candidate) > max_width:
                        lines.append(piece)
                        piece = char
                    else:
                        piece = candidate
                if piece:
                    lines.append(piece)

            for word in words:
                candidate = f"{current} {word}".strip()
                if measured(candidate) <= max_width:
                    current = candidate
                    continue
                if current:
                    lines.append(current)
                    current = ""
                if measured(word) <= max_width:
                    current = word
                else:
                    append_fitted_chunk(word)

            if current:
                lines.append(current)
            return lines or [raw]

        full_order_number = self._value(order, "orderNumber", "order_number", "id", default="---")
        order_number = str(full_order_number).split("-")[-1] if "-" in str(full_order_number) else str(full_order_number)
        cashier = self._value(order, "creator_name", "cashierName", "cashier_name", default="---")
        order_type = self._value(order, "orderType", "order_type", default="")
        formatted_date, formatted_time = self._format_date_parts(self._value(order, "created_at", "order_date"))

        # Saud El Shafie Library Header
        y = self._paste_store_logo(image, y, scale)
        y += u(20)
        draw_center("مكتبة سعود الشافعي", y, fonts["order"])
        y += u(50)

        draw_right(formatted_date, y + u(14), fonts["small"])
        draw_right(formatted_time, y + u(42), fonts["small"])
        order_text = f"رقم الفاتورة {order_number}"
        order_bbox = draw.textbbox((0, 0), order_text, font=fonts["order"], direction="rtl")
        order_w = order_bbox[2] - order_bbox[0]
        order_h = order_bbox[3] - order_bbox[1]
        box_pad_x = u(14)
        box_pad_y = u(8)
        box_left = (width - order_w) // 2 - box_pad_x
        box_top = y + u(30) - ((order_h + (box_pad_y * 2)) // 2)
        box_right = box_left + order_w + (box_pad_x * 2)
        box_bottom = box_top + order_h + (box_pad_y * 2)
        draw.rounded_rectangle(
            (box_left, box_top, box_right, box_bottom),
            radius=u(5),
            outline="black",
            width=u(2),
        )
        text_x = box_left + box_pad_x - order_bbox[0]
        text_y = box_top + box_pad_y - order_bbox[1]
        draw.text((text_x, text_y), order_text, fill="black", font=fonts["order"], direction="rtl")

        y += u(112) + u(8)
        line(y, dash=True)
        y += u(12)

        draw_right(f"المستخدم: {cashier}", y, fonts["small"])
        y += u(40)

        line(y, dash=True)
        y += u(12)

        qty_x = content_right - u(18)
        item_right = content_right - u(56)
        price_x = margin + u(180)
        total_x = margin + u(52)

        draw_right("ك", y, fonts["table"], qty_x)
        draw_right("الصنف", y, fonts["table"], item_right)
        draw_text("سعر", price_x, y, fonts["table"], "ma")
        draw_text("إجمالي", total_x, y, fonts["table"], "ma")
        y += u(37)
        line(y)
        y += u(10)

        for cart_item in items:
            item_data = cart_item.get("item") or cart_item
            qty = self._number(cart_item.get("qty") or cart_item.get("quantity") or 0)
            price = self._number(item_data.get("price") or cart_item.get("price") or item_data.get("unit_price") or 0)
            name = item_data.get("name") or item_data.get("product_name") or "---"
            total = qty * price

            name_lines = wrap_text(name, fonts["item"], u(235))
            row_start_y = y
            draw_right(f"{qty:g}", row_start_y, fonts["item"], qty_x)
            for line_index, line_text in enumerate(name_lines):
                draw.text(
                    (item_right, row_start_y + (line_index * u(34))),
                    line_text,
                    fill="black",
                    font=fonts["item"],
                    anchor="ra",
                    direction="rtl" if is_arabic(line_text) else "ltr",
                )
            draw_text(f"{price:g}", price_x, row_start_y, fonts["item"], "ma")
            draw_text(f"{total:.0f}", total_x, row_start_y, fonts["item"], "ma")
            y += max(u(44), len(name_lines) * u(34) + u(10))
            draw.line((margin, y, content_right, y), fill="#eeeeee", width=scale)
            y += u(12)

        y += u(2)
        line(y)
        y += u(12)

        subtotal = self._number(self._value(order, "itemsTotal", "subtotal", default=0))
        grand_total = self._number(self._value(order, "total_amount", "grandTotal", default=0))

        draw_right("المجموع:", y, fonts["small"])
        draw_text(f"{subtotal:.2f}", margin, y, fonts["small"])
        y += u(34)

        discount_amount = self._number(self._value(order, "discount_amount", "discountAmount", default=0))
        discount_reason = self._value(order, "discount_reason", "discountReason", default="")
        
        if discount_amount > 0:
            discount_label = "الخصم:"
            if discount_reason:
                discount_label = f"الخصم ({discount_reason}):"
            draw_right(discount_label, y, fonts["small"])
            draw_text(f"- {discount_amount:.2f}", margin, y, fonts["small"])
            y += u(34)

        shipping_cost = self._number(self._value(order, "shipping_cost", default=0))
        if shipping_cost > 0:
            draw_right("الشحن:", y, fonts["small"])
            draw_text(f"{shipping_cost:.2f}", margin, y, fonts["small"])
            y += u(34)

        tax_amount = self._number(self._value(order, "tax_amount", default=0))
        if tax_amount > 0:
            draw_right("ضريبة ضمن السعر:", y, fonts["small"])
            draw_text(f"{tax_amount:.2f}", margin, y, fonts["small"])
            y += u(34)

        y += u(2)
        line(y, dash=True)
        y += u(12)
        draw_right("الإجمالي النهائي:", y, fonts["grand"])
        draw_text(f"{grand_total:.2f} ج.م", margin, y, fonts["grand"])
        y += u(50)

        payment_method = self._value(order, "payment_method", default="")
        if receipt_type == "invoice" and payment_method:
            draw_right(f"وسيلة الدفع: {payment_method}", y, fonts["small"])
            y += u(34)

        y = self._draw_customer_info(order, image, draw, fonts, y, scale)

        line(y, fill="#777777", dash=True)
        y += u(16)
        draw_center("مكتبة سعود الشافعي تشكركم لزيارتكم", y, fonts["footer"])
        y += u(34)
        draw_center("الزقازيق - الشرقية", y, fonts["footer"])
        y += u(52)

        return image.crop((0, 0, width, y))

    def _generate_barcode_image(self, product: Dict[str, Any]) -> Image.Image:
        scale = self.RENDER_SCALE
        fonts = self._get_fonts(scale)
        width = self.PAPER_WIDTH_PX * scale
        height = 270 * scale
        image = Image.new("RGB", (width, height), "white")
        draw = ImageDraw.Draw(image)

        def draw_center(text: Any, y_pos: int, font):
            value = str(text)
            direction = "rtl" if is_arabic(value) else "ltr"
            draw.text((width // 2, y_pos), value, fill="black", font=font, anchor="ma", direction=direction)

        y = 12 * scale
        draw_center("مكتبة سعود الشافعي", y, fonts["small"])
        y += 30 * scale
        
        name = product.get("name_ar") or product.get("name") or ""
        unit_name = product.get("unit_name") or ""
        draw_center(f"{name} · {unit_name}" if unit_name else name, y, fonts["item"])
        y += 36 * scale
        
        barcode_value = str(product.get("barcode") or product.get("sku") or "")
        if not barcode_value or len(barcode_value) > 64 or any(ord(char) < 32 or ord(char) > 126 for char in barcode_value):
            raise ValueError("Barcode must contain 1-64 printable ASCII characters")
        code128 = barcode.get_barcode_class("code128")
        barcode_image = code128(barcode_value, writer=ImageWriter()).render(
            {"write_text": False, "module_height": 7.0, "module_width": 0.25, "quiet_zone": 2.0}
        ).convert("RGB")
        if barcode_image.width > width - (self.MARGIN * 2 * scale):
            raise ValueError("Barcode is too wide for the label; use a shorter code")
        image.paste(barcode_image, ((width - barcode_image.width) // 2, y))
        y += barcode_image.height + (5 * scale)
        draw_center(barcode_value, y, fonts["tiny"])
        y += 25 * scale
        price = product.get("sell_price") or product.get("price") or 0
        draw_center(f"السعر: {price} ج.م", y, fonts["small"])
        y += 38 * scale
        return image.crop((0, 0, width, y))

    def _has_customer_info(self, order: Dict[str, Any]) -> bool:
        return bool(
            self._value(order, "customerName", "customer_name", default="")
            or self._value(order, "customerPhone", "customer_phone", default="")
            or self._value(order, "customerNotes", "customer_notes", default="")
            or self._address_to_text(
                self._value(order, "customerAddress", "customer_address", "address", default="")
            )
        )

    def _draw_customer_info(self, order, image, draw, fonts, y: int, scale: int = 1) -> int:
        customer_name = self._value(order, "customerName", "customer_name", default="")
        customer_phone = self._value(order, "customerPhone", "customer_phone", default="")
        customer_notes = self._value(order, "customerNotes", "customer_notes", default="")
        address = self._address_to_text(
            self._value(order, "customerAddress", "customer_address", "address", default="")
        )
        if not any([customer_name, customer_phone, address, customer_notes]):
            return y

        def u(value: int | float) -> int:
            return int(round(value * scale))

        x1 = self.MARGIN * scale
        x2 = (self.PAPER_WIDTH_PX * scale) - (self.MARGIN * scale)
        box_top = y
        y += u(14)

        def draw_center(text, y_pos, font):
            value = str(text)
            draw.text(((self.PAPER_WIDTH_PX * scale) // 2, y_pos), value, fill="black", font=font,
                      anchor="ma", direction="rtl" if is_arabic(value) else "ltr")

        def draw_right(text, y_pos, font):
            value = str(text)
            draw.text((x2 - u(12), y_pos), value, fill="black", font=font,
                      anchor="ra", direction="rtl" if is_arabic(value) else "ltr")

        draw_center("بيانات العميل", y, fonts["small"])
        y += u(37)
        if customer_name:
            draw_right(f" اسم العميل :{customer_name}", y, fonts["customer"])
            y += u(36)
        if customer_phone:
            draw_right(f" رقم التليفون :{customer_phone}", y, fonts["customer"])
            y += u(36)
        if address:
            draw_right(f" العنوان :{address}", y, fonts["customer"])
            y += u(36)
        if customer_notes:
            draw_right(f" ملاحظات :{customer_notes}", y, fonts["customer"])
            y += u(36)

        draw.rounded_rectangle((x1, box_top, x2, y + u(10)), radius=u(4), outline="black", width=scale)
        return y + u(24)

    def _target_printers(self) -> List[str]:
        available = self.get_printers()
        selected = [name for name in config.printer_names if name in available]
        if config.printer_names:
            return selected
        ignore_list = ("pdf", "onenote", "xps", "fax", "microsoft", "send to", "webex")
        physical_printers = [
            printer
            for printer in available
            if not any(ignored in printer.lower() for ignored in ignore_list)
        ]
        if physical_printers:
            return physical_printers
        try:
            return [win32print.GetDefaultPrinter()]
        except Exception:
            return available[:1]

    def _is_printer_ready(self, printer_name: str) -> tuple[bool, str]:
        handle = None
        try:
            handle = win32print.OpenPrinter(printer_name)
            info = win32print.GetPrinter(handle, 2)
            status = info.get("Status", 0) if isinstance(info, dict) else 0
            if not isinstance(status, int):
                try:
                    status = int(status)
                except (TypeError, ValueError):
                    return False, "Unknown"

            # Printer Status is only a best-effort optimization.
            # Some Windows printer drivers (especially thermal printers) report Status == 0 even when
            # the printer is disconnected. The actual readiness check is whether StartDoc succeeds.
            unready_masks = (
                (getattr(win32print, "PRINTER_STATUS_OFFLINE", 0x00000080), "Offline"),
                (getattr(win32print, "PRINTER_STATUS_ERROR", 0x00000002), "Error"),
                (getattr(win32print, "PRINTER_STATUS_NOT_AVAILABLE", 0x00001000), "Not Available"),
                (getattr(win32print, "PRINTER_STATUS_PAPER_OUT", 0x00000010), "Paper Out"),
                (getattr(win32print, "PRINTER_STATUS_DOOR_OPEN", 0x00400000), "Door Open"),
                (getattr(win32print, "PRINTER_STATUS_PAUSED", 0x00000001), "Paused"),
                (getattr(win32print, "PRINTER_STATUS_PAPER_JAM", 0x00000008), "Paper Jam"),
                (getattr(win32print, "PRINTER_STATUS_PAPER_PROBLEM", 0x00000040), "Paper Problem"),
            )
            for mask, label in unready_masks:
                if status & mask:
                    return False, label

            return True, "No blocking status"
        except Exception as exc:
            log.warning("Could not read printer readiness for '%s': %s", printer_name, exc)
            return False, "Unknown"
        finally:
            if handle is not None:
                try:
                    win32print.ClosePrinter(handle)
                except Exception:
                    pass

    def _print_native_gdi(self, image: Image.Image, printer_name: str, document_name: str) -> bool:
        hdc = None
        try:
            hdc = win32ui.CreateDC()
            hdc.CreatePrinterDC(printer_name)
            printable_width = hdc.GetDeviceCaps(110)
            printable_height = hdc.GetDeviceCaps(111)

            success = False
            for attempt in range(2):
                try:
                    hdc.StartDoc(document_name)
                    success = True
                    break
                except Exception as e:
                    if attempt == 0:
                        log.warning("StartDoc failed on %s (attempt %d). Retrying in 0.5s...", printer_name, attempt + 1)
                        time.sleep(0.5)
                    else:
                        raise e

            if success:
                hdc.StartPage()

                dib = ImageWin.Dib(image)
                scaled_height = int(image.size[1] * (printable_width / image.size[0]))
                dib.draw(hdc.GetHandleOutput(), (0, 0, printable_width, min(scaled_height, printable_height)))

                hdc.EndPage()
                hdc.EndDoc()
                log.info("Native Python GDI print successful to %s", printer_name)
                return True
            return False
        except Exception as exc:
            printer_status = "Unknown"
            try:
                handle = win32print.OpenPrinter(printer_name)
                info = win32print.GetPrinter(handle, 2)
                status = info.get("Status", 0)
                win32print.ClosePrinter(handle)
                status_label = self._status_label(status)
                printer_status = f"Status Code: {status} ({status_label})"
            except Exception:
                pass
            
            log.error("Native Python GDI print failed on %s: %s | Printer Status: %s", printer_name, exc, printer_status)
            try:
                if hdc:
                    hdc.AbortDoc()
            except Exception:
                pass
            return False
        finally:
            try:
                if hdc:
                    hdc.DeleteDC()
            except Exception:
                pass

    def _status_label(self, status: Any) -> str:
        if not isinstance(status, int):
            try:
                status = int(status)
            except (TypeError, ValueError):
                return "Unknown"

        status_map = {
            getattr(win32print, "PRINTER_STATUS_OFFLINE", 0x00000080): "Offline",
            getattr(win32print, "PRINTER_STATUS_ERROR", 0x00000002): "Error",
            getattr(win32print, "PRINTER_STATUS_NOT_AVAILABLE", 0x00001000): "Not Available",
            getattr(win32print, "PRINTER_STATUS_PAPER_OUT", 0x00000010): "Paper Out",
            getattr(win32print, "PRINTER_STATUS_DOOR_OPEN", 0x00400000): "Door Open",
            getattr(win32print, "PRINTER_STATUS_PAUSED", 0x00000001): "Paused",
            getattr(win32print, "PRINTER_STATUS_PAPER_JAM", 0x00000008): "Paper Jam",
            getattr(win32print, "PRINTER_STATUS_PAPER_PROBLEM", 0x00000040): "Paper Problem",
        }

        matched = [label for mask, label in status_map.items() if status & mask]
        if matched:
            return ", ".join(matched)
        return "Unknown"

    def _alert_ui(self, message: str) -> None:
        log.error("Print alert: %s", message)

    def _printer_worker(self):
        while True:
            try:
                job = self._job_queue.get()
                order = job.get("order")
                if not order:
                    continue

                receipt_type = job.get("receipt_type", "customer")
                if receipt_type == "barcode":
                    image = self._generate_barcode_image(order)
                    copies = int(order.get("quantity") or order.get("qty") or 1)
                elif receipt_type == "stock_receipt":
                    image = self._generate_stock_receipt_image(order)
                    copies = 1
                else:
                    image = self._generate_receipt_image(order, receipt_type)
                    copies = 1

                printers = self._target_printers()
                if not printers:
                    log.error("No printers found on this device.")
                    self._alert_ui("No printers found. Please check printer connections.")
                    continue

                printed_count = 0
                for printer_name in printers:
                    try:
                        ready, reason = self._is_printer_ready(printer_name)
                        if not ready:
                            log.warning("Skipping printer '%s' because it is %s.", printer_name, reason)
                            continue

                        for _ in range(copies):
                            if self._print_native_gdi(image, printer_name, job.get("document_name", "Saud El Shafie Receipt")):
                                printed_count += 1
                                time.sleep(0.1)
                    except Exception as exc:
                        log.error("Failed to print to %s: %s", printer_name, exc)

                if printed_count == 0:
                    self._alert_ui("No available printer found. Please check printer connections.")
                    log.error("No available printer found. Please check printer connections.")
            except Exception as exc:
                log.error("Printer worker encountered an error: %s", exc, exc_info=True)
            finally:
                self._job_queue.task_done()


thermal_printer = PrinterManager()
