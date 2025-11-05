"""
Generate theme-aware tray icons for Owlette.
Creates dark brown icons for light theme and white icons for dark theme.
"""
from PIL import Image, ImageDraw
import os

def create_hal_icon(circle_color, dot_color, size=64, output_path='icon.png'):
    """
    Create HAL 9000-style eye icon.

    Args:
        circle_color: RGB tuple for outer circle
        dot_color: RGB tuple for center dot
        size: Icon size in pixels
        output_path: Where to save the icon
    """
    # Create transparent image
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Calculate dimensions
    center = size // 2
    outer_radius = size // 2 - 2  # Leave small margin
    inner_radius = size // 8  # Center dot (much smaller)

    # Grey fill color for the background circle
    grey_fill = (60, 60, 60)  # Dark grey

    # Draw grey filled circle (background)
    draw.ellipse(
        [(center - outer_radius, center - outer_radius),
         (center + outer_radius, center + outer_radius)],
        fill=grey_fill + (255,)  # Add alpha
    )

    # Draw outer circle (ring) with thicker stroke on top of grey fill
    draw.ellipse(
        [(center - outer_radius, center - outer_radius),
         (center + outer_radius, center + outer_radius)],
        outline=circle_color + (255,),  # Add alpha
        width=4  # Increased from 3 to 4 for thicker stroke
    )

    # Draw center dot (pupil)
    draw.ellipse(
        [(center - inner_radius, center - inner_radius),
         (center + inner_radius, center + inner_radius)],
        fill=dot_color + (255,)  # Add alpha
    )

    # Save with transparency
    img.save(output_path, 'PNG')
    print(f"Created: {output_path}")

def create_ico_file(png_path, ico_path):
    """
    Convert PNG to ICO format with multiple sizes for Windows.
    ICO files support multiple resolutions in a single file.
    """
    img = Image.open(png_path)

    # Create ICO with multiple sizes (16x16, 32x32, 48x48, 64x64, 256x256)
    sizes = [(16, 16), (32, 32), (48, 48), (64, 64), (256, 256)]

    # Resize to all sizes
    icons = []
    for size in sizes:
        resized = img.resize(size, Image.Resampling.LANCZOS)
        icons.append(resized)

    # Save as ICO
    icons[0].save(ico_path, format='ICO', sizes=[(img.width, img.height) for img in icons], append_images=icons[1:])
    print(f"Created: {ico_path}")

def main():
    # Define colors
    WHITE = (255, 255, 255)         # Pure white for connected status outer circle
    ORANGE = (255, 153, 0)          # Warning color
    RED = (232, 65, 24)             # Error color

    # Create icon directory
    base_dir = os.path.dirname(__file__)
    icons_dir = os.path.join(base_dir, 'icons')

    os.makedirs(icons_dir, exist_ok=True)

    print("Generating universal tray icons...")
    print()

    # Universal icons (white outer circle with white center for normal, colored for errors)
    print("Creating universal icons:")
    create_hal_icon(WHITE, WHITE, output_path=os.path.join(icons_dir, 'normal.png'))
    create_hal_icon(WHITE, ORANGE, output_path=os.path.join(icons_dir, 'warning.png'))
    create_hal_icon(WHITE, RED, output_path=os.path.join(icons_dir, 'error.png'))
    print()

    print(f"Done! Icons created in: {icons_dir}")
    print()

    # Create ICO file for Inno Setup installer
    print("Creating ICO file for installer:")
    ico_path = os.path.join(icons_dir, 'normal.ico')
    create_ico_file(os.path.join(icons_dir, 'normal.png'), ico_path)
    print()
    print(f"Installer icon: {ico_path}")

if __name__ == '__main__':
    main()
