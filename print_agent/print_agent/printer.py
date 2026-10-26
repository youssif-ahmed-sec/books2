import logging
import queue
import threading
import time
from datetime import datetime
from typing import Any, Dict, List

import qrcode
import barcode
import arabic_reshaper
from barcode.writer import ImageWriter
from bidi.algorithm import get_display
import win32print
import win32ui
import win32con
from PIL import Image, ImageDraw, ImageFont, ImageWin, features

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


class _PrintDraw:
    """Render Arabic with a shaping fallback when Pillow lacks libraqm."""

    def __init__(self, image: Image.Image):
        self._draw = ImageDraw.Draw(image)
        self._has_raqm = features.check("raqm")

    def __getattr__(self, name):
        return getattr(self._draw, name)

    def _prepare(self, text, options):
        if self._has_raqm:
            return text, options
        options.pop("direction", None)
        value = str(text)
        if is_arabic(value):
            value = get_display(arabic_reshaper.reshape(value))
        return value, options

    def text(self, xy, text, *args, **kwargs):
        value, options = self._prepare(text, kwargs)
        return self._draw.text(xy, value, *args, **options)

    def textbbox(self, xy, text, *args, **kwargs):
        value, options = self._prepare(text, kwargs)
        return self._draw.textbbox(xy, value, *args, **options)

    def textlength(self, text, *args, **kwargs):
        value, options = self._prepare(text, kwargs)
        return self._draw.textlength(value, *args, **options)


class PrinterManager:
    PAPER_WIDTH_PX = 576
    MARGIN = 16
    CONTENT_WIDTH = PAPER_WIDTH_PX - (MARGIN * 2)
    RENDER_SCALE = 2

    @staticmethod
    def _paste_store_logo(image: Image.Image, y: int, scale: int) -> int:
        # Match the filled book glyph in frontend/src/components/BrandMark.tsx.
        draw = ImageDraw.Draw(image)
        cx = image.width // 2
        mark_scale = 2 * scale
        left_edge = cx - 24 * mark_scale
        top = y + 4 * scale
        point = lambda x, yy: (left_edge + x * mark_scale, top + yy * mark_scale)
        draw.rounded_rectangle((point(0, 0), point(48, 48)), radius=7 * mark_scale, fill="black")
        left = [point(x, yy) for x, yy in ((5, 11), (12, 10), (19, 12), (24, 16), (24, 39), (18, 35), (11, 33), (5, 35))]
        right = [point(x, yy) for x, yy in ((43, 11), (36, 10), (29, 12), (24, 16), (24, 39), (30, 35), (37, 33), (43, 35))]
        draw.polygon(left, fill="white")
        draw.polygon(right, fill="white")
        for start, end in (((29, 21), (39, 18)), ((29, 27), (39, 24)), ((29, 33), (39, 30))):
            draw.line((point(*start), point(*end)), fill="black", width=2 * scale)
        return top + 50 * mark_scale

    def _document_header(self, image: Image.Image, y: int, title: str, number: Any,
                         created_at: Any, employee: Any, scale: int) -> int:
        draw = _PrintDraw(image)
        fonts = self._get_fonts(scale)
        width = image.width
        margin = self.MARGIN * scale
        y = self._paste_store_logo(image, y, scale)
        draw.text((width // 2, y), "مكتبة سعود الشافعي", fill="black", font=fonts["brand"], anchor="ma", direction="rtl")
        y += 50 * scale
        draw.text((width // 2, y), title, fill="black", font=fonts["order"], anchor="ma", direction="rtl")
        y += 48 * scale
        date_text, time_text = self._format_date_parts(created_at)
        number_label = "رقم الفاتورة:" if title.startswith("فاتورة") else "رقم المستند:"
        draw.text((width - margin, y), f"{number_label} {number}", fill="black", font=fonts["small"], anchor="ra", direction="rtl")
        y += 34 * scale
        draw.text((width - margin, y), f"التاريخ: {date_text}", fill="black", font=fonts["small"], anchor="ra", direction="rtl")
        draw.text((width // 2 - margin, y), f"الوقت: {time_text}", fill="black", font=fonts["small"], anchor="ra", direction="rtl")
        y += 40 * scale
        x = margin
        while x < width - margin:
            draw.line((x, y, min(x + 10 * scale, width - margin), y), fill="black", width=2 * scale)
            x += 16 * scale
        y += 18 * scale
        if employee and title != "فاتورة بيع":
            draw.text((width - margin, y), f"الموظف: {employee}", fill="black", font=fonts["small"], anchor="ra", direction="rtl")
            y += 34 * scale
        return y

    def _document_barcode(self, image: Image.Image, y: int, value: Any, scale: int,
                          *, large: bool = False, show_text: bool = True) -> int:
        code = str(value or "").strip()
        if not code or len(code) > 64 or any(ord(char) < 32 or ord(char) > 126 for char in code):
            raise ValueError("Document barcode must contain 1-64 printable ASCII characters")
        code128 = barcode.get_barcode_class("code128")
        rendered = code128(code, writer=ImageWriter()).render(
            {"write_text": False, "module_height": 8.0, "module_width": 0.28, "quiet_zone": 2.0}
        ).convert("RGB")
        ink = rendered.convert("L").point(lambda pixel: 255 if pixel < 128 else 0).getbbox()
        if ink:
            rendered = rendered.crop((0, max(0, ink[1] - 2), rendered.width, min(rendered.height, ink[3] + 2)))
        max_width = image.width - 2 * self.MARGIN * scale
        if large:
            rendered = rendered.resize((min(max_width, 280 * scale), 60 * scale), Image.Resampling.NEAREST)
        elif rendered.width > max_width:
            rendered = rendered.resize((max_width, 80 * scale), Image.Resampling.NEAREST)
        image.paste(rendered, ((image.width - rendered.width) // 2, y))
        y += rendered.height + 12 * scale
        if show_text:
            draw = _PrintDraw(image)
            draw.text((image.width // 2, y), code, fill="black", font=self._font("arialbd", 21 * scale), anchor="ma")
            y += 32 * scale
        return y

    def _document_footer(self, image: Image.Image, y: int, number: Any, scale: int) -> int:
        draw = _PrintDraw(image)
        fonts = self._get_fonts(scale)
        margin = self.MARGIN * scale
        width = image.width
        y += 14 * scale
        draw.line((margin, y, width - margin, y), fill="black", width=scale)
        y += 18 * scale
        draw.text((width // 2, y), "احتفظ بهذا المستند للرجوع إليه", fill="black",
                  font=fonts["footer"], anchor="ma", direction="rtl")
        y += 42 * scale
        y = self._document_barcode(image, y, number, scale, large=True, show_text=False)
        draw.text((width // 2, y), f"رقم المستند: {number}", fill="black",
                  font=fonts["tiny"], anchor="ma", direction="rtl")
        y += 36 * scale
        draw.line((margin, y, width - margin, y), fill="black", width=scale)
        y += 18 * scale
        draw.text((width // 2, y), "مكتبة سعود الشافعي", fill="black",
                  font=fonts["small"], anchor="ma", direction="rtl")
        y += 38 * scale
        draw.text((width // 2, y), "ش المكاتب بجوار مسجد الشافعي - الزقازيق - الشرقية",
                  fill="black", font=fonts["tiny"], anchor="ma", direction="rtl")
        return y + 38 * scale

    def _quantity_table(self, image: Image.Image, y: int, rows: List[Dict[str, Any]], scale: int) -> int:
        draw = _PrintDraw(image)
        fonts = self._get_fonts(scale)
        right = image.width - self.MARGIN * scale
        left = self.MARGIN * scale
        unit_x, qty_x = left + 166 * scale, left + 56 * scale
        for label, x, anchor in (("الصنف", right, "ra"), ("الوحدة", unit_x, "ma"), ("الكمية", qty_x, "ma")):
            draw.text((x, y), label, font=fonts["table"], fill="black", anchor=anchor, direction="rtl")
        y += 37 * scale
        draw.line((left, y, right, y), fill="black", width=scale)
        y += 12 * scale
        for row in rows:
            item = row.get("item") or row
            name = str(item.get("name") or item.get("product_name") or "—")
            unit = str(item.get("unit") or item.get("unit_name") or "")
            quantity = row.get("qty", row.get("quantity", 0))
            words = name.split()
            lines: list[str] = []
            current = ""
            for word in words:
                candidate = f"{current} {word}".strip()
                if current and draw.textlength(candidate, font=fonts["item"], direction="rtl" if is_arabic(candidate) else "ltr") > 260 * scale:
                    lines.append(current)
                    current = word
                else:
                    current = candidate
            lines.append(current or name)
            for index, part in enumerate(lines):
                draw.text((right, y + index * 32 * scale), part, font=fonts["item"], fill="black", anchor="ra",
                          direction="rtl" if is_arabic(part) else "ltr")
            draw.text((unit_x, y), unit[:14], font=fonts["small"], fill="black", anchor="ma", direction="rtl" if is_arabic(unit) else "ltr")
            draw.text((qty_x, y), str(quantity), font=fonts["small"], fill="black", anchor="ma")
            y += max(43, len(lines) * 32 + 8) * scale
            draw.line((left, y, right, y), fill="#999999", width=scale)
            y += 12 * scale
        return y + 8 * scale

    def _return_table(self, image: Image.Image, y: int, rows: List[Dict[str, Any]], scale: int) -> int:
        draw = _PrintDraw(image)
        fonts = self._get_fonts(scale)
        right = image.width - self.MARGIN * scale
        left = self.MARGIN * scale
        qty_x, amount_x = left + 208 * scale, left + 64 * scale
        for label, x, anchor in (("الصنف", right, "ra"), ("الكمية", qty_x, "ma"), ("القيمة", amount_x, "ma")):
            draw.text((x, y), label, font=fonts["table"], fill="black", anchor=anchor, direction="rtl")
        y += 37 * scale
        draw.line((left, y, right, y), fill="black", width=scale)
        y += 12 * scale
        for row in rows:
            name = str(row.get("product_name") or "—")
            lines: list[str] = []
            current = ""
            for word in name.split():
                candidate = f"{current} {word}".strip()
                if current and draw.textlength(candidate, font=fonts["item"], direction="rtl" if is_arabic(candidate) else "ltr") > 270 * scale:
                    lines.append(current)
                    current = word
                else:
                    current = candidate
            lines.append(current or name)
            for index, part in enumerate(lines):
                draw.text((right, y + index * 32 * scale), part, font=fonts["item"], fill="black", anchor="ra",
                          direction="rtl" if is_arabic(part) else "ltr")
            quantity = f"{row.get('quantity', 0)} {row.get('unit_name', '')}"
            draw.text((qty_x, y), quantity, font=fonts["tiny"], fill="black", anchor="ma", direction="rtl" if is_arabic(quantity) else "ltr")
            draw.text((amount_x, y), f"{self._number(row.get('amount', 0)):.2f}", font=fonts["tiny"], fill="black", anchor="ma")
            y += max(48, len(lines) * 32 + 8) * scale
            draw.line((left, y, right, y), fill="#999999", width=scale)
            y += 10 * scale
        return y + 8 * scale

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
        if receipt_type not in {"customer", "invoice", "barcode", "stock_receipt", "sales_return", "purchase_document", "test"}:
            raise ValueError("Unsupported print document type")
        if receipt_type == "barcode":
            copies = order.get("quantity", order.get("qty", 1))
            if isinstance(copies, bool) or not isinstance(copies, int) or not 1 <= copies <= 20:
                raise ValueError("Barcode quantity must be an integer from 1 to 20")
            self._generate_barcode_image(order)
        printer_names = config.printers_for(receipt_type)
        if not printer_names:
            return False
        self._last_order_id = order.get("id")
        self._last_order_data = order
        self._last_receipt_type = receipt_type
        document_name = f"order-{self._value(order, 'order_number', 'orderNumber', 'id', default='receipt')}"
        self._job_queue.put({"document_name": document_name, "order": order, "receipt_type": receipt_type, "printer_names": printer_names})
        return True

    def print_html(self, html_content: str, document_name: str = "Souod El Shafie Receipt", order_data: dict = None) -> bool:
        order = order_data or {}
        if not order:
            log.warning("Frontend silent print did not include order data; native print skipped.")
            return False
        printer_names = config.receipt_printer_names
        if not printer_names:
            return False
        self._last_order_id = order.get("id")
        self._last_order_data = order
        self._last_receipt_type = "customer"
        self._job_queue.put({"document_name": document_name, "order": order, "receipt_type": "customer", "printer_names": printer_names})
        return True

    def reprint_last(self, receipt_type: str = "customer") -> bool:
        if not self._last_order_data:
            log.warning("No last order to reprint")
            return False
        printer_names = config.printers_for(receipt_type)
        if not printer_names:
            return False
        self._job_queue.put(
            {
                "document_name": f"reprint-{self._last_order_id or 'receipt'}",
                "order": self._last_order_data,
                "receipt_type": receipt_type,
                "printer_names": printer_names,
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
            "body": self._font("arial", size(22)),
            "small": self._font("arialbd", size(22)),
            "tiny": self._font("arialbd", size(18)),
            "item": self._font("arialbd", size(22)),
            "table": self._font("arialbd", size(19)),
            "customer": self._font("arial", size(22)),
            "footer": self._font("arialbd", size(28)),
            "order": self._font("arialbd", size(28)),
            "brand": self._font("arialbd", size(36)),
            "grand": self._font("arialbd", size(28)),
        }

    def _generate_stock_receipt_image(self, receipt: Dict[str, Any]) -> Image.Image:
        scale = self.RENDER_SCALE
        width = self.PAPER_WIDTH_PX * scale
        margin = self.MARGIN * scale
        rows = receipt.get("lines") or self._items(receipt)
        fonts = self._get_fonts(scale)
        image = Image.new("RGB", (width, (850 + len(rows) * 100) * scale), "white")
        draw = _PrintDraw(image)
        right = width - margin
        number = receipt.get("public_number") or f"RCV-{receipt.get('id', '')}"
        y = self._document_header(image, margin, "فاتورة استلام مخزون", number,
                                  receipt.get("created_at"), receipt.get("employee_name"), scale)

        def write(value, font=fonts["small"], step=36):
            nonlocal y
            value = str(value)
            draw.text((right, y), value, fill="black", font=font, anchor="ra",
                      direction="rtl" if is_arabic(value) else "ltr")
            y += step * scale

        write(f"المورد: {receipt.get('supplier_name', '')}")
        write(f"المخزن: {receipt.get('warehouse_name', '')}")
        if receipt.get("supplier_document"):
            write(f"مستند المورد: {receipt['supplier_document']}")
        y += 12 * scale
        draw.line((margin, y, right, y), fill="black", width=scale)
        y += 18 * scale
        y = self._quantity_table(image, y, rows, scale)
        write(f"عدد الأصناف: {len(rows)}", fonts["small"])
        write("هذا المستند للكميات فقط؛ المديونية تُسجل من حساب المورد.", fonts["small"])
        y = self._document_footer(image, y, number, scale)
        return image.crop((0, 0, width, min(image.height, y + margin)))

    def _generate_purchase_document_image(self, document: Dict[str, Any]) -> Image.Image:
        scale = self.RENDER_SCALE
        width = self.PAPER_WIDTH_PX * scale
        margin = self.MARGIN * scale
        right = width - margin
        rows = document.get("lines") or []
        fonts = self._get_fonts(scale)
        image = Image.new("RGB", (width, (850 + len(rows) * 110) * scale), "white")
        draw = _PrintDraw(image)
        number = document.get("public_number") or f"PUR-{document.get('id', '')}"
        y = self._document_header(image, margin, "أمر شراء", number,
                                  document.get("created_at"), document.get("employee_name"), scale)

        def write(value: Any, step: int = 38):
            nonlocal y
            text = str(value)
            draw.text((right, y), text, fill="black", font=fonts["small"], anchor="ra",
                      direction="rtl" if is_arabic(text) else "ltr")
            y += step * scale

        write(f"المورد: {document.get('supplier_name', '')}")
        write(f"الحالة: {document.get('status', '')}")
        y += 12 * scale
        y = self._quantity_table(image, y, rows, scale)
        if document.get("note"):
            write(f"ملاحظة: {document['note']}")
        write("هذا المستند للكميات فقط؛ لا يثبت مديونية المورد.")
        y = self._document_footer(image, y, number, scale)
        return image.crop((0, 0, width, min(image.height, y + margin)))

    def _generate_sales_return_image(self, receipt: Dict[str, Any]) -> Image.Image:
        scale = self.RENDER_SCALE
        width = self.PAPER_WIDTH_PX * scale
        margin = self.MARGIN * scale
        right = width - margin
        returned = receipt.get("returned_lines") or []
        replacements = receipt.get("replacement_lines") or []
        fonts = self._get_fonts(scale)
        image = Image.new("RGB", (width, (1000 + 180 * (len(returned) + len(replacements))) * scale), "white")
        draw = _PrintDraw(image)
        kind = "استبدال" if receipt.get("kind") == "EXCHANGE" else "استرجاع"
        number = receipt.get("public_number") or f"RET-{receipt.get('id', '')}"
        y = self._document_header(image, margin, f"إيصال {kind}", number,
                                  receipt.get("created_at"), receipt.get("employee_name"), scale)

        def write(value: Any, font=None, step: int = 36):
            nonlocal y
            value = str(value)
            draw.text((right, y), value, fill="black", font=font or fonts["small"], anchor="ra",
                      direction="rtl" if is_arabic(value) else "ltr")
            y += step * scale

        def divider():
            nonlocal y
            draw.line((margin, y, right, y), fill="#777777", width=scale)
            y += 18 * scale

        def money(value: Any) -> str:
            return f"{self._number(value):.2f} ج.م"

        write(f"الفاتورة الأصلية: {receipt.get('order_public_number') or receipt.get('order_id', '')}")
        if receipt.get("exchange_order_id"):
            write(f"فاتورة البديل: {receipt.get('exchange_order_public_number') or receipt['exchange_order_id']}")
        if receipt.get("customer_name"):
            write(f"العميل: {receipt['customer_name']}")
        if receipt.get("customer_phone"):
            write(f"الهاتف: {receipt['customer_phone']}")
        divider()

        write("الأصناف المسترجعة", fonts["item"], 44)
        y = self._return_table(image, y, returned, scale)
        write(f"قيمة المرتجع بعد الخصم: {money(receipt.get('returned_value', 0))}", fonts["small"], 44)
        divider()

        if replacements:
            write("الأصناف البديلة", fonts["item"], 44)
            y = self._return_table(image, y, replacements, scale)
            write(f"قيمة البدائل: {money(receipt.get('replacement_value', 0))}", fonts["small"], 44)
            divider()

        payment_names = {
            "Cash": "نقدي", "Credit Card": "بطاقة", "Vodafone Cash": "فودافون كاش",
            "Instapay": "إنستاباي", "Bank Transfer": "تحويل بنكي", "Deferred Payment": "آجل",
        }
        write(f"وسيلة التسوية: {payment_names.get(receipt.get('payment_method'), receipt.get('payment_method', ''))}")
        refund = self._number(receipt.get("refund_amount", 0))
        charge = self._number(receipt.get("charge_amount", 0))
        if refund:
            label = "المخصوم من رصيد العميل" if receipt.get("payment_method") == "Deferred Payment" else "المبلغ المرتد للعميل"
            write(f"{label}: {money(refund)}", fonts["grand"], 50)
        elif charge:
            label = "المضاف إلى رصيد العميل" if receipt.get("payment_method") == "Deferred Payment" else "المبلغ المحصّل من العميل"
            write(f"{label}: {money(charge)}", fonts["grand"], 50)
        else:
            write("لا يوجد فرق مالي", fonts["grand"], 50)
        wallet_fee = self._number(receipt.get("wallet_fee_amount", 0))
        if wallet_fee:
            write(f"رسوم المحفظة: {money(wallet_fee)}")
            write(f"إجمالي المحصّل: {money(receipt.get('collection_amount', charge + wallet_fee))}", fonts["grand"], 50)
        divider()
        y = self._document_footer(image, y, number, scale)
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
        height = u(1450 + (len(items) * 190))
        if self._has_customer_info(order):
            height += u(300)
        image = Image.new("RGB", (width, height), "white")
        draw = _PrintDraw(image)
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
                    draw.line((x, y_pos, min(x + u(12), content_right), y_pos), fill=fill, width=2 * scale)
                    x += u(18)
            else:
                draw.line((margin, y_pos, content_right, y_pos), fill=fill, width=2 * scale)

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
        order_number = str(full_order_number)
        cashier = self._value(order, "employee_name", "creator_name", "cashierName", "cashier_name", default="")
        y = self._document_header(image, y, "فاتورة بيع", order_number,
                                  self._value(order, "created_at", "order_date"), cashier, scale)

        customer_name = self._value(order, "customer_name", "customerName", default="عميل نقدي") or "عميل نقدي"
        customer_phone = self._value(order, "customer_phone", "customerPhone", default="")
        source = self._value(order, "source", default="")
        customer_address = self._address_to_text(self._value(order, "customer_address", "customerAddress", default="")) if source == "Delivery" else ""
        payment_method = self._value(order, "payment_method", default="")
        payment_names = {"Cash": "نقدي", "Instapay": "إنستاباي", "Wallet": "محفظة", "Credit Card": "فيزا", "Deferred Payment": "آجل"}
        payment_label = payment_names.get(payment_method, payment_method)
        def info_pair(right_label: str, right_value: Any, left_label: str = "", left_value: Any = ""):
            nonlocal y
            right_text = f"{right_label}: {right_value}" if right_value else ""
            left_text = f"{left_label}: {left_value}" if left_value else ""
            half_width = width // 2 - 2 * margin
            right_lines = wrap_text(right_text, fonts["small"], half_width) if right_text else []
            left_lines = wrap_text(left_text, fonts["small"], half_width) if left_text else []
            for index, part in enumerate(right_lines):
                draw_right(part, y + index * u(33), fonts["small"])
            for index, part in enumerate(left_lines):
                draw_right(part, y + index * u(33), fonts["small"], width // 2 - margin)
            y += max(len(right_lines), len(left_lines), 1) * u(33)

        info_pair("العميل", customer_name, "الهاتف", customer_phone)
        info_pair("الموظف", cashier or "غير مسجل", "نوع العملية", "بيع دليفري" if source == "Delivery" else "بيع من المكتبة")
        info_pair("الدفع", payment_label, "العنوان", customer_address)
        received_method = self._value(order, "received_method", default="")
        if received_method:
            info_pair("طريقة تحصيل المستلم", payment_names.get(received_method, received_method))
        expected_method = self._value(order, "expected_collection_method", default="")
        if expected_method:
            info_pair("تحصيل الباقي لاحقًا", payment_names.get(expected_method, expected_method))
        next_due_date = self._value(order, "next_due_date", default="")
        if next_due_date:
            info_pair("استحقاق الدفعة القادمة", str(next_due_date))
        line(y, dash=True)
        y += u(16)

        item_right = content_right - u(8)
        level_x = margin + u(330)
        unit_x = margin + u(250)
        qty_x = margin + u(195)
        price_x = margin + u(125)
        total_x = margin + u(43)

        draw_right("الصنف", y, fonts["table"], item_right)
        draw_text("التسعير", level_x, y, fonts["table"], "ma")
        draw_text("الوحدة", unit_x, y, fonts["table"], "ma")
        draw_text("العدد", qty_x, y, fonts["table"], "ma")
        draw_text("السعر", price_x, y, fonts["table"], "ma")
        draw_text("إجمالي", total_x, y, fonts["table"], "ma")
        y += u(37)
        line(y)
        y += u(10)

        for cart_item in items:
            item_data = cart_item.get("item") or cart_item
            qty = self._number(cart_item.get("qty") or cart_item.get("quantity") or 0)
            price = self._number(item_data.get("price") or cart_item.get("price") or item_data.get("unit_price") or 0)
            name = item_data.get("name") or item_data.get("product_name") or "---"
            unit = item_data.get("unit") or cart_item.get("unit") or ""
            total = qty * price

            name_lines = wrap_text(name, fonts["item"], u(154))
            row_start_y = y
            unit_lines = wrap_text(str(unit), fonts["tiny"], u(65))
            for line_index, unit_line in enumerate(unit_lines):
                draw_text(unit_line, unit_x, row_start_y + line_index * u(30), fonts["tiny"], "ma")
            draw_text(f"{qty:g}", qty_x, row_start_y, fonts["item"], "ma")
            for line_index, line_text in enumerate(name_lines):
                draw.text(
                    (item_right, row_start_y + (line_index * u(34))),
                    line_text,
                    fill="black",
                    font=fonts["item"],
                    anchor="ra",
                    direction="rtl" if is_arabic(line_text) else "ltr",
                )
            price_level = item_data.get("price_level") or cart_item.get("price_level")
            level_lines = []
            if price_level:
                level_names = {"Retail": "مستهلك", "Semi Wholesale": "نصف جملة", "Wholesale": "جملة",
                               "Super Wholesale": "سوبر جملة", "VIP": "كبار العملاء"}
                level_lines = wrap_text(level_names.get(price_level, price_level), fonts["tiny"], u(72))
                for line_index, level_line in enumerate(level_lines):
                    draw_text(level_line, level_x, row_start_y + line_index * u(30), fonts["tiny"], "ma")
            draw_text(f"{price:.2f}", price_x, row_start_y, fonts["tiny"], "ma")
            draw_text(f"{total:.2f}", total_x, row_start_y, fonts["tiny"], "ma")
            y += max(u(44), len(name_lines) * u(34), len(level_lines) * u(30), len(unit_lines) * u(30)) + u(10)
            draw.line((margin, y, content_right, y), fill="black", width=2 * scale)
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
        discount_percent = self._value(order, "discount_percent", default=None)
        discount_reason = self._value(order, "discount_reason", "discountReason", default="")
        
        if discount_amount > 0:
            discount_label = "الخصم:"
            if discount_percent is not None:
                discount_label = f"الخصم ({self._number(discount_percent):g}٪):"
            elif discount_reason:
                discount_label = f"الخصم ({discount_reason}):"
            draw_right(discount_label, y, fonts["small"])
            draw_text(f"- {discount_amount:.2f}", margin, y, fonts["small"])
            y += u(34)

        shipping_cost = self._number(self._value(order, "shipping_cost", default=0))
        if source == "Delivery":
            draw_right("رسوم التوصيل:", y, fonts["small"])
            draw_text(f"{shipping_cost:.2f}", margin, y, fonts["small"])
            y += u(34)

        tax_amount = self._number(self._value(order, "tax_amount", default=0))
        if tax_amount > 0:
            draw_right("ضريبة ضمن السعر:", y, fonts["small"])
            draw_text(f"{tax_amount:.2f}", margin, y, fonts["small"])
            y += u(34)

        wallet_fee = self._number(self._value(order, "wallet_fee_amount", default=0))
        if wallet_fee > 0:
            draw_right("ضريبة المحفظة (١٪):", y, fonts["small"])
            draw_text(f"+ {wallet_fee:.2f}", margin, y, fonts["small"])
            y += u(34)

        y += u(2)
        line(y, dash=True)
        y += u(12)
        draw_right("الإجمالي النهائي:", y, fonts["grand"])
        draw_text(f"{grand_total:.2f} ج.م", margin, y, fonts["grand"])
        y += u(50)

        if payment_method:
            received_default = 0 if payment_method == "Deferred Payment" else grand_total
            received = self._number(self._value(order, "amount_received", default=received_default))
            remaining = self._number(self._value(order, "remaining_amount", default=grand_total - received))
            draw_right(f"المستلم: {received:.2f} ج.م", y, fonts["small"])
            y += u(34)
            draw_right(f"المتبقي: {remaining:.2f} ج.م", y, fonts["small"])
            y += u(34)

        line(y, dash=True)
        y += u(16)
        draw_center("شكرًا لزيارتكم", y, fonts["footer"])
        y += u(34)
        y = self._document_barcode(image, y + u(18), order_number, scale, large=True, show_text=False)
        draw_center("امسح الباركود للبحث عن الفاتورة", y, fonts["tiny"])
        y += u(35)
        line(y, dash=True)
        y += u(14)
        draw_center("مكتبة سعود الشافعي", y, fonts["small"])
        y += u(32)
        draw_center("ش المكاتب بجوار مسجد الشافعي - الزقازيق - الشرقية", y, fonts["small"])
        y += u(38)

        whatsapp_number = "01016012012"
        number_width = draw.textbbox((0, 0), whatsapp_number, font=fonts["small"])[2]
        icon_size = u(25)
        gap = u(6)
        icon_x = (width - icon_size - gap - number_width) // 2
        icon_y = y - u(3)
        draw.ellipse((icon_x + u(3), icon_y, icon_x + u(23), icon_y + u(20)), fill="black")
        draw.polygon(((icon_x + u(6), icon_y + u(16)), (icon_x, icon_y + u(25)),
                      (icon_x + u(11), icon_y + u(20))), fill="black")
        draw.line(((icon_x + u(9), icon_y + u(6)), (icon_x + u(11), icon_y + u(11)),
                   (icon_x + u(16), icon_y + u(15)), (icon_x + u(20), icon_y + u(16))),
                  fill="white", width=u(2), joint="curve")
        draw_text(whatsapp_number, icon_x + icon_size + gap, y, fonts["small"])
        y += u(40)

        return image.crop((0, 0, width, y)).convert("L").point(lambda pixel: 0 if pixel < 210 else 255).convert("RGB")

    def _generate_barcode_image(self, product: Dict[str, Any]) -> Image.Image:
        scale = self.RENDER_SCALE
        width = self.PAPER_WIDTH_PX * scale
        height = 320 * scale
        image = Image.new("RGB", (width, height), "white")
        draw = _PrintDraw(image)

        def draw_center(text: Any, y_pos: int, font_size: int) -> int:
            value = str(text)
            direction = "rtl" if is_arabic(value) else "ltr"
            max_width = width - (self.MARGIN * 2 * scale)
            for size in range(font_size, 23, -2):
                font = self._font("arialbd", size * scale)
                bounds = draw.textbbox((0, 0), value, font=font, direction=direction)
                if bounds[2] - bounds[0] <= max_width:
                    break
            draw.text((width // 2, y_pos), value, fill="black", font=font, anchor="ma", direction=direction)
            return size

        y = 4 * scale
        y += (draw_center("مكتبة سعود الشافعي", y, 40) + 2) * scale
        
        name = product.get("name_ar") or product.get("name") or ""
        unit_name = product.get("unit_name") or ""
        y += (draw_center(f"{name} · {unit_name}" if unit_name else name, y, 44) + 2) * scale
        
        barcode_value = str(product.get("barcode") or product.get("sku") or "")
        if not barcode_value or len(barcode_value) > 64 or any(ord(char) < 32 or ord(char) > 126 for char in barcode_value):
            raise ValueError("Barcode must contain 1-64 printable ASCII characters")
        code128 = barcode.get_barcode_class("code128")
        barcode_image = code128(barcode_value, writer=ImageWriter()).render(
            {"write_text": False, "module_height": 7.0, "module_width": 0.25, "quiet_zone": 2.0}
        ).convert("RGB")
        ink = barcode_image.convert("L").point(lambda value: 255 if value < 128 else 0).getbbox()
        if ink:
            barcode_image = barcode_image.crop(
                (0, max(0, ink[1] - 2), barcode_image.width, min(barcode_image.height, ink[3] + 2))
            )
        barcode_width = width - (self.MARGIN * 2 * scale)
        if barcode_image.width > barcode_width:
            raise ValueError("Barcode is too wide for the label; use a shorter code")
        barcode_image = barcode_image.resize(
            (barcode_width, 75 * scale), Image.Resampling.NEAREST
        )
        image.paste(barcode_image, ((width - barcode_image.width) // 2, y))
        y += barcode_image.height + (2 * scale)
        y += (draw_center(barcode_value, y, 38) + 2) * scale
        price = product.get("sell_price") or product.get("price") or 0
        y += (draw_center(f"السعر: {price} ج.م", y, 44) + 2) * scale
        return image.crop((0, 0, width, y + 30 * scale))

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

    def _target_printers(self, selected: List[str]) -> List[str]:
        available = set(self.get_printers())
        return [name for name in selected if name in available]

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

    def _print_native_gdi(self, image: Image.Image, printer_name: str, document_name: str, fit_page: bool = False) -> bool:
        hdc = None
        try:
            hdc = win32ui.CreateDC()
            hdc.CreatePrinterDC(printer_name)
            printable_width = hdc.GetDeviceCaps(win32con.HORZRES)
            printable_height = hdc.GetDeviceCaps(win32con.VERTRES)

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
                if fit_page:
                    padding = max(2, min(printable_width, printable_height) // 50)
                    ratio = min(
                        (printable_width - 2 * padding) / image.width,
                        (printable_height - 2 * padding) / image.height,
                    )
                    target_width = max(1, int(image.width * ratio))
                    target_height = max(1, int(image.height * ratio * 0.96))
                    left = (printable_width - target_width) // 2
                    top = 0
                    bounds = (left, top, left + target_width, top + target_height)
                else:
                    scaled_height = int(image.height * (printable_width / image.width))
                    bounds = (0, 0, printable_width, min(scaled_height, printable_height))
                dib.draw(hdc.GetHandleOutput(), bounds)

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
                copies = 1
                if receipt_type == "barcode":
                    image = self._generate_barcode_image(order)
                    copies = int(order.get("quantity") or order.get("qty") or 1)
                elif receipt_type == "stock_receipt":
                    image = self._generate_stock_receipt_image(order)
                elif receipt_type == "purchase_document":
                    image = self._generate_purchase_document_image(order)
                    copies = 1
                elif receipt_type == "sales_return":
                    image = self._generate_sales_return_image(order)
                    copies = 1
                else:
                    image = self._generate_receipt_image(order, receipt_type)
                    copies = 1

                printers = self._target_printers(job.get("printer_names", []))
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
                            if self._print_native_gdi(image, printer_name, job.get("document_name", "Saud El Shafie Receipt"), fit_page=receipt_type == "barcode"):
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
