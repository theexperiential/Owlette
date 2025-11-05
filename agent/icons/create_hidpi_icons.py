"""
Create high-resolution system tray icons for HiDPI displays.
Generates multi-resolution .ico files for Windows system tray.
"""
from PIL import Image, ImageDraw

def create_tray_icon_image(center_color, size=256):
    """
    Create a universal tray icon with dark grey ring and colored center dot.

    Args:
        center_color: RGB tuple for the center dot (e.g., (255, 255, 255) for white)
        size: Icon size in pixels (default 256 for HiDPI support)

    Returns:
        PIL Image object
    """
    # Create transparent image
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Calculate dimensions
    center = size // 2

    # Outer ring (dark grey circle) - matches current design
    outer_radius = int(size * 0.45)  # 45% of image size
    ring_width = int(size * 0.12)    # 12% ring thickness
    inner_radius = outer_radius - ring_width

    # Draw outer dark grey ring
    ring_color = (60, 60, 60, 255)  # Dark grey
    draw.ellipse(
        [(center - outer_radius, center - outer_radius),
         (center + outer_radius, center + outer_radius)],
        fill=ring_color
    )

    # Cut out inner circle (creates ring effect)
    draw.ellipse(
        [(center - inner_radius, center - inner_radius),
         (center + inner_radius, center + inner_radius)],
        fill=(0, 0, 0, 0)
    )

    # Center dot
    dot_radius = int(size * 0.15)  # 15% of image size for center dot
    draw.ellipse(
        [(center - dot_radius, center - dot_radius),
         (center + dot_radius, center + dot_radius)],
        fill=center_color + (255,)  # Add alpha channel
    )

    return img

def create_multi_resolution_ico(output_path, center_color):
    """
    Create a multi-resolution .ico file for Windows system tray.
    Includes sizes: 16x16, 20x20, 24x24, 32x32, 40x40, 48x48, 64x64, 96x96, 128x128, 256x256

    Args:
        output_path: Path to save the .ico file
        center_color: RGB tuple for the center dot
    """
    # Generate all common Windows icon sizes
    sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

    # Create images at each resolution
    images = []
    for size in sizes:
        img = create_tray_icon_image(center_color, size)
        images.append(img)

    # Save as multi-resolution .ico file
    # The first image is the "main" image, others are additional sizes
    images[0].save(
        output_path,
        format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:]
    )

    print(f"Created multi-resolution .ico with sizes: {sizes}")
    print(f"Saved to: {output_path}")

def create_png_icon(output_path, center_color, size=256):
    """
    Create a high-resolution PNG icon.

    Args:
        output_path: Path to save the PNG file
        center_color: RGB tuple for the center dot
        size: Icon size in pixels
    """
    img = create_tray_icon_image(center_color, size)
    img.save(output_path, 'PNG', optimize=True)
    print(f"Created {size}x{size} PNG: {output_path}")

if __name__ == '__main__':
    import os

    # Icon directory
    icon_dir = os.path.dirname(__file__)

    print("Creating high-resolution icons for Windows system tray...\n")

    # Normal status (white dot) - everything OK
    print("1. Normal status (white dot):")
    create_multi_resolution_ico(
        os.path.join(icon_dir, 'normal.ico'),
        center_color=(255, 255, 255)
    )
    create_png_icon(
        os.path.join(icon_dir, 'normal.png'),
        center_color=(255, 255, 255),
        size=256
    )
    print()

    # Warning status (orange dot) - Firebase issues
    print("2. Warning status (orange dot):")
    create_multi_resolution_ico(
        os.path.join(icon_dir, 'warning.ico'),
        center_color=(255, 165, 0)
    )
    create_png_icon(
        os.path.join(icon_dir, 'warning.png'),
        center_color=(255, 165, 0),
        size=256
    )
    print()

    # Error status (red dot) - service stopped
    print("3. Error status (red dot):")
    create_multi_resolution_ico(
        os.path.join(icon_dir, 'error.ico'),
        center_color=(220, 50, 50)
    )
    create_png_icon(
        os.path.join(icon_dir, 'error.png'),
        center_color=(220, 50, 50),
        size=256
    )
    print()

    print("✓ All HiDPI icons created successfully!")
    print("✓ Multi-resolution .ico files will automatically scale for any DPI setting")
    print("✓ Rebuild the installer to bundle the new icons")
