"""Build the Windows app icon from the bookstore's existing logo."""

from pathlib import Path

from PIL import Image, ImageChops, ImageOps


assets = Path(__file__).resolve().parent / "print_agent" / "assets"
with Image.open(assets / "saud-logo.jpg") as source:
    logo = source.convert("RGB")

# Trim the wide white margins so the logo remains visible at taskbar sizes.
difference = ImageChops.difference(logo, Image.new("RGB", logo.size, "white"))
bounds = ImageOps.grayscale(difference).point(lambda value: 255 if value > 30 else 0).getbbox()
if bounds is None:
    raise ValueError("The bookstore logo contains no visible artwork")
logo = logo.crop(bounds)
logo.thumbnail((448, 448), Image.Resampling.LANCZOS)

icon = Image.new("RGB", (512, 512), "white")
icon.paste(logo, ((512 - logo.width) // 2, (512 - logo.height) // 2))
icon.save(assets / "icon.png")
icon.save(assets / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
