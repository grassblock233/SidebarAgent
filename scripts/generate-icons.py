"""Generate deterministic Chrome icon sizes from the canonical SidebarAgent logo."""

from pathlib import Path

from PIL import Image


SIZES = (16, 32, 48, 128)
ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
PUBLIC_ASSETS = ROOT / "public" / "assets"
SOURCE = ASSETS / "logo-source.png"

# The full illustration reads well at larger sizes. Browser toolbar icons need a
# tighter composition so the robot face and magnifying glass remain legible.
SMALL_ICON_CROPS = {
    16: (0.40, 0.29, 0.75, 0.64),
    32: (0.37, 0.27, 0.78, 0.68),
}


def square_crop_with_padding(image: Image.Image, padding_ratio: float = 0.10) -> Image.Image:
    """Crop transparent margins into a centered square with proportional padding."""
    rgba = image.convert("RGBA")
    bounds = rgba.getbbox()
    if not bounds:
        raise ValueError("Logo source is fully transparent")

    left, top, right, bottom = bounds
    content_size = max(right - left, bottom - top)
    side = round(content_size * (1 + padding_ratio * 2))
    center_x = (left + right) / 2
    center_y = (top + bottom) / 2
    crop_left = round(center_x - side / 2)
    crop_top = round(center_y - side / 2)
    crop_left = min(max(crop_left, 0), rgba.width - side)
    crop_top = min(max(crop_top, 0), rgba.height - side)
    return rgba.crop((crop_left, crop_top, crop_left + side, crop_top + side))


def normalized_crop(image: Image.Image, bounds: tuple[float, float, float, float]) -> Image.Image:
    """Convert resolution-independent crop coordinates into source pixels."""
    left, top, right, bottom = bounds
    return image.crop(
        (
            round(image.width * left),
            round(image.height * top),
            round(image.width * right),
            round(image.height * bottom),
        )
    )


def main() -> None:
    """Generate every manifest icon from the checked-in source image."""
    if not SOURCE.exists():
        raise FileNotFoundError(f"Missing source logo: {SOURCE}")

    source = Image.open(SOURCE).convert("RGBA")
    full_logo = square_crop_with_padding(source)
    PUBLIC_ASSETS.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        crop = normalized_crop(source, SMALL_ICON_CROPS[size]) if size in SMALL_ICON_CROPS else full_logo
        icon = crop.resize((size, size), Image.Resampling.LANCZOS)
        for output_dir in (ASSETS, PUBLIC_ASSETS):
            icon.save(output_dir / f"icon-{size}.png", optimize=True)
    print(f"Generated {len(SIZES)} icons from {SOURCE.name}")


if __name__ == "__main__":
    main()
