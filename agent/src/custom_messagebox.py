"""
Custom messagebox wrapper that fixes layout issues with CTkMessagebox
"""

from CTkMessagebox import CTkMessagebox
import shared_utils


class OwletteMessagebox(CTkMessagebox):
    """
    Custom messagebox with improved text wrapping, compact layout, and app theme colors.

    Fixes:
    - Text wraps at 92% of dialog width instead of 50%
    - Shorter button height (24px instead of 28px)
    - Narrower buttons for better proportions
    - Reduced header/footer padding for compact appearance
    - Matches Owlette app color scheme (dark slate theme)
    """

    def __init__(self, *args, **kwargs):
        # Set default button_height to 24 if not specified
        if 'button_height' not in kwargs:
            kwargs['button_height'] = 24

        # Set default button_width to be narrower if not specified
        # Calculate based on width parameter (default 400)
        width = kwargs.get('width', 400)
        if 'button_width' not in kwargs:
            kwargs['button_width'] = int(width / 5)  # Narrower buttons (1/5 instead of 1/4)

        # Set a more compact default height if not specified
        if 'height' not in kwargs:
            kwargs['height'] = 180  # Reduced from default 200

        # Apply Owlette color scheme if colors not explicitly set
        if 'fg_color' not in kwargs or kwargs['fg_color'] == 'default':
            kwargs['fg_color'] = shared_utils.FRAME_COLOR  # Main dialog background

        if 'bg_color' not in kwargs or kwargs['bg_color'] == 'default':
            kwargs['bg_color'] = shared_utils.WINDOW_COLOR  # Outer background

        if 'text_color' not in kwargs or kwargs['text_color'] == 'default':
            kwargs['text_color'] = shared_utils.TEXT_COLOR  # White text

        if 'title_color' not in kwargs or kwargs['title_color'] == 'default':
            kwargs['title_color'] = shared_utils.TEXT_COLOR  # White title

        if 'button_color' not in kwargs or kwargs['button_color'] == 'default':
            kwargs['button_color'] = shared_utils.BUTTON_COLOR  # Button background

        if 'button_hover_color' not in kwargs or kwargs['button_hover_color'] == 'default':
            kwargs['button_hover_color'] = shared_utils.BUTTON_HOVER_COLOR  # Button hover

        if 'button_text_color' not in kwargs or kwargs['button_text_color'] == 'default':
            kwargs['button_text_color'] = shared_utils.TEXT_COLOR  # White button text

        if 'border_color' not in kwargs or kwargs['border_color'] == 'default':
            kwargs['border_color'] = '#334155'  # Slate-700 border

        # Call parent constructor
        super().__init__(*args, **kwargs)

        # AFTER parent init completes, override the text wraplength
        # Parent sets it to width/2, we want it to be 92% of width for better readability
        if hasattr(self, 'info') and hasattr(self.info, '_text_label'):
            # Set wraplength to 92% of dialog width (instead of 50%)
            self.info._text_label.configure(wraplength=int(self.width * 0.92))

        # Reduce title padding for more compact header
        if hasattr(self, 'title_label'):
            self.title_label.grid_configure(padx=(10, 30), pady=1)

        # Remove row weights from header and footer to make them compact
        # Only the content row (row 1) should expand
        if hasattr(self, 'frame_top'):
            # Reset all row weights to 0 first
            self.frame_top.grid_rowconfigure(0, weight=0)  # Title row - no expand
            self.frame_top.grid_rowconfigure(1, weight=1)  # Content row - expand to fit text
            self.frame_top.grid_rowconfigure(2, weight=0)  # Button row - no expand
            self.frame_top.grid_rowconfigure(3, weight=0)  # Extra row - no expand

        # Add comfortable padding around buttons
        if hasattr(self, 'button_1'):
            self.button_1.grid_configure(pady=(10, 12))  # Top padding 10, bottom 12

        if hasattr(self, 'button_2'):
            self.button_2.grid_configure(pady=(10, 12))  # Top padding 10, bottom 12

        if hasattr(self, 'button_3'):
            self.button_3.grid_configure(pady=(10, 12))  # Top padding 10, bottom 12
