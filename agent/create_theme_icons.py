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
    inner_radius = size // 4  # Center dot

    # Draw outer circle (ring)
    draw.ellipse(
        [(center - outer_radius, center - outer_radius),
         (center + outer_radius, center + outer_radius)],
        outline=circle_color + (255,),  # Add alpha
        width=3
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
    DARK_BROWN = (66, 47, 40)      # Dark brown for light theme (matches Windows 11 icons)
    WHITE = (255, 255, 255)         # White for dark theme
    ORANGE = (255, 153, 0)          # Warning color
    RED = (232, 65, 24)             # Error color

    # Create icon directories
    base_dir = os.path.dirname(__file__)
    light_dir = os.path.join(base_dir, 'icons', 'light')
    dark_dir = os.path.join(base_dir, 'icons', 'dark')

    os.makedirs(light_dir, exist_ok=True)
    os.makedirs(dark_dir, exist_ok=True)

    print("Generating theme-aware tray icons...")
    print()

    # Icons for LIGHT theme (dark brown icons)
    print("Creating icons for LIGHT theme (dark brown):")
    create_hal_icon(DARK_BROWN, DARK_BROWN, output_path=os.path.join(light_dir, 'normal.png'))
    create_hal_icon(DARK_BROWN, ORANGE, output_path=os.path.join(light_dir, 'warning.png'))
    create_hal_icon(DARK_BROWN, RED, output_path=os.path.join(light_dir, 'error.png'))
    print()

    # Icons for DARK theme (white icons)
    print("Creating icons for DARK theme (white):")
    create_hal_icon(WHITE, WHITE, output_path=os.path.join(dark_dir, 'normal.png'))
    create_hal_icon(WHITE, ORANGE, output_path=os.path.join(dark_dir, 'warning.png'))
    create_hal_icon(WHITE, RED, output_path=os.path.join(dark_dir, 'error.png'))
    print()

    print("Done! Icons created in:")
    print(f"  - {light_dir}")
    print(f"  - {dark_dir}")
    print()

    # Create ICO file for Inno Setup installer (use dark brown for installer)
    print("Creating ICO file for installer:")
    ico_path = os.path.join(base_dir, 'icons', 'normal.ico')
    create_ico_file(os.path.join(light_dir, 'normal.png'), ico_path)
    print()
    print(f"Installer icon: {ico_path}")

if __name__ == '__main__':
    main()
