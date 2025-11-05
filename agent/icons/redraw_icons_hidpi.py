"""
REDRAW the original icon design at high resolution.
NO upscaling - fresh vector-like drawing at 256x256.
"""
from PIL import Image, ImageDraw

def draw_icon_from_scratch(center_color, size=256):
    """
    Redraw the original icon design at high resolution.

    Original design (from 64x64):
    - White ring (outer border)
    - Dark grey filled circle (inside the white ring)
    - Colored dot in center
    """
    # Create image with transparency
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    center = size // 2

    # White outer ring
    outer_radius = int(size * 0.45)
    draw.ellipse(
        [(center - outer_radius, center - outer_radius),
         (center + outer_radius, center + outer_radius)],
        fill=(255, 255, 255, 255)  # White
    )

    # Dark grey inner circle
    inner_radius = int(size * 0.38)
    draw.ellipse(
        [(center - inner_radius, center - inner_radius),
         (center + inner_radius, center + inner_radius)],
        fill=(60, 60, 60, 255)  # Dark grey
    )

    # Center dot - colored
    dot_radius = int(size * 0.10)
    draw.ellipse(
        [(center - dot_radius, center - dot_radius),
         (center + dot_radius, center + dot_radius)],
        fill=center_color + (255,)
    )

    return img

def create_multi_resolution_ico(center_color, output_path):
    """Create .ico with multiple resolutions."""
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    images = [draw_icon_from_scratch(center_color, s) for s in sizes]

    images[0].save(
        output_path,
        format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:]
    )
    print(f"Created {output_path}")

if __name__ == '__main__':
    import os
    icon_dir = os.path.dirname(__file__)

    print("Redrawing icons at high resolution...")

    # Normal - white dot
    img = draw_icon_from_scratch((255, 255, 255), 256)
    img.save(os.path.join(icon_dir, 'normal.png'), 'PNG')
    create_multi_resolution_ico((255, 255, 255), os.path.join(icon_dir, 'normal.ico'))
    print("Created normal icon")

    # Warning - orange dot
    img = draw_icon_from_scratch((255, 165, 0), 256)
    img.save(os.path.join(icon_dir, 'warning.png'), 'PNG')
    create_multi_resolution_ico((255, 165, 0), os.path.join(icon_dir, 'warning.ico'))
    print("Created warning icon")

    # Error - red dot
    img = draw_icon_from_scratch((220, 50, 50), 256)
    img.save(os.path.join(icon_dir, 'error.png'), 'PNG')
    create_multi_resolution_ico((220, 50, 50), os.path.join(icon_dir, 'error.ico'))
    print("Created error icon")

    print("\nDone - icons redrawn at high resolution")
