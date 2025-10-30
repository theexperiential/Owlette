import cairosvg
import os

def convert_svg_to_png():
    # Ensure icons directory exists
    os.makedirs('icons', exist_ok=True)
    
    # Convert SVG to PNG
    cairosvg.svg2png(
        url='owlette.svg',
        write_to='owlette.png',
        output_width=256,
        output_height=256
    )
    
    print("PNG file created successfully!")

if __name__ == "__main__":
    convert_svg_to_png()