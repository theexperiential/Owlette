/**
 * Usage-based color utility functions
 *
 * Maps resource usage percentage to a color spectrum:
 * - Low usage (0-30%): Cool colors (green -> cyan)
 * - Medium usage (30-60%): Neutral colors (cyan -> blue)
 * - High usage (60-80%): Warm colors (yellow -> orange)
 * - Critical usage (80-100%): Hot colors (orange -> red)
 */

/**
 * Get the accent bar color based on usage percentage
 * Returns a Tailwind CSS background color class
 *
 * @param percent - Usage percentage (0-100)
 * @returns Tailwind CSS background color class
 */
export function getUsageColorClass(percent: number): string {
  if (percent < 30) {
    return 'bg-emerald-500';
  } else if (percent < 50) {
    return 'bg-cyan-500';
  } else if (percent < 70) {
    return 'bg-blue-500';
  } else if (percent < 85) {
    return 'bg-amber-500';
  } else {
    return 'bg-red-500';
  }
}

/**
 * Get the accent bar color as a raw CSS color value
 * For use in inline styles
 *
 * @param percent - Usage percentage (0-100)
 * @returns CSS color string (rgb format)
 */
export function getUsageColor(percent: number): string {
  if (percent < 30) {
    return 'rgb(16, 185, 129)';   // emerald-500
  } else if (percent < 50) {
    return 'rgb(6, 182, 212)';    // cyan-500
  } else if (percent < 70) {
    return 'rgb(59, 130, 246)';   // blue-500
  } else if (percent < 85) {
    return 'rgb(245, 158, 11)';   // amber-500
  } else {
    return 'rgb(239, 68, 68)';    // red-500
  }
}

/**
 * Get the ring/hover color class based on usage percentage
 * For use in hover states
 *
 * @param percent - Usage percentage (0-100)
 * @returns Tailwind CSS ring color class
 */
export function getUsageRingClass(percent: number): string {
  if (percent < 30) {
    return 'hover:ring-emerald-500/30';
  } else if (percent < 50) {
    return 'hover:ring-cyan-500/30';
  } else if (percent < 70) {
    return 'hover:ring-blue-500/30';
  } else if (percent < 85) {
    return 'hover:ring-amber-500/30';
  } else {
    return 'hover:ring-red-500/30';
  }
}
