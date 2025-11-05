"""
Create ICO files with pixel-perfect rendering at small sizes.
At small sizes (16x16, 32x32), anti-aliasing makes circles look blurry.
We need sharp, crisp rendering for small icons.
"""
from PIL import Image, ImageDraw

def draw_icon_sharp(center_color, size):
    """
    Draw icon with anti-aliasing at native resolution.
    PIL's ImageDraw.ellipse provides automatic anti-aliasing.
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    center = size / 2.0  # Use float for better anti-aliasing

    # White ring
    outer = size * 0.45
    draw.ellipse(
        [(center - outer, center - outer), (center + outer, center + outer)],
        fill=(255, 255, 255, 255)
    )

    # Dark grey inner circle
    inner = size * 0.38
    draw.ellipse(
        [(center - inner, center - inner), (center + inner, center + inner)],
        fill=(60, 60, 60, 255)
    )

    # Colored center dot
    dot = size * 0.10
    draw.ellipse(
        [(center - dot, center - dot), (center + dot, center + dot)],
        fill=center_color + (255,)
    )

    return img

def create_ico(center_color, output_path):
    """
    Create multi-resolution ICO by downsampling from high-res.
    This preserves anti-aliasing much better than drawing at each size.
    """
    # Create ONE high-res image with good anti-aliasing
    master = draw_icon_sharp(center_color, 256)

    # Downsample to all required sizes using LANCZOS (best quality)
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
    images = []
    for size in sizes:
        if size == 256:
            images.append(master)
        else:
            # Downsample from master - this preserves anti-aliasing
            downsampled = master.resize((size, size), Image.Resampling.LANCZOS)
            images.append(downsampled)

    # Save as ICO with all sizes
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

    print("Creating sharp ICO files...")

    # Normal
    create_ico((255, 255, 255), os.path.join(icon_dir, 'normal.ico'))

    # Warning
    create_ico((255, 165, 0), os.path.join(icon_dir, 'warning.ico'))

    # Error
    create_ico((220, 50, 50), os.path.join(icon_dir, 'error.ico'))

    print("Done - ICO files optimized for all sizes")
