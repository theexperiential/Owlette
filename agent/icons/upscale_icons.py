"""
Upscale existing icon files to higher resolution WITHOUT changing the design.
Takes the original 64x64 icons and scales them up to 256x256 for HiDPI displays.
"""
from PIL import Image
import os

def upscale_to_hidpi(input_path, output_path, target_size=256):
    """
    Upscale an existing icon to higher resolution using high-quality resampling.
    Preserves the EXACT design, just at higher resolution.
    """
    img = Image.open(input_path)

    # Use LANCZOS resampling for best quality upscaling
    upscaled = img.resize((target_size, target_size), Image.Resampling.LANCZOS)

    # Save as PNG
    upscaled.save(output_path, 'PNG', optimize=True)
    print(f"Upscaled {input_path} -> {output_path} ({target_size}x{target_size})")

    return upscaled

def create_multi_res_ico(images_dict, output_path):
    """
    Create multi-resolution .ico file from a dict of {size: Image} pairs.
    """
    sizes = sorted(images_dict.keys())
    images = [images_dict[s] for s in sizes]

    # Save as .ico with multiple resolutions
    images[0].save(
        output_path,
        format='ICO',
        sizes=[(img.width, img.height) for img in images],
        append_images=images[1:]
    )
    print(f"Created multi-res .ico: {output_path}")

if __name__ == '__main__':
    icon_dir = os.path.dirname(__file__)

    # Backup originals first
    for name in ['normal', 'warning', 'error']:
        png_file = os.path.join(icon_dir, f'{name}.png')
        if os.path.exists(png_file):
            backup_file = os.path.join(icon_dir, f'{name}_64x64_original.png')
            if not os.path.exists(backup_file):
                img = Image.open(png_file)
                img.save(backup_file)
                print(f"Backed up original: {backup_file}")

    print("\nUpscaling icons to HiDPI resolution...")

    # Process each icon
    for name in ['normal', 'warning', 'error']:
        print(f"\n{name}:")

        # Read original 64x64
        original_path = os.path.join(icon_dir, f'{name}_64x64_original.png')
        if not os.path.exists(original_path):
            original_path = os.path.join(icon_dir, f'{name}.png')

        original = Image.open(original_path)

        # Create upscaled versions
        images = {
            16: original.resize((16, 16), Image.Resampling.LANCZOS),
            20: original.resize((20, 20), Image.Resampling.LANCZOS),
            24: original.resize((24, 24), Image.Resampling.LANCZOS),
            32: original.resize((32, 32), Image.Resampling.LANCZOS),
            40: original.resize((40, 40), Image.Resampling.LANCZOS),
            48: original.resize((48, 48), Image.Resampling.LANCZOS),
            64: original,
            96: original.resize((96, 96), Image.Resampling.LANCZOS),
            128: original.resize((128, 128), Image.Resampling.LANCZOS),
            256: original.resize((256, 256), Image.Resampling.LANCZOS),
        }

        # Save 256x256 PNG
        png_output = os.path.join(icon_dir, f'{name}.png')
        images[256].save(png_output, 'PNG', optimize=True)
        print(f"  Created 256x256 PNG: {png_output}")

        # Create multi-resolution .ico
        ico_output = os.path.join(icon_dir, f'{name}.ico')
        create_multi_res_ico(images, ico_output)

    print("\nDone! Original design preserved at higher resolution.")
