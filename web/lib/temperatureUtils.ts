/**
 * Temperature utility functions for converting and formatting temperatures
 *
 * Storage standard: All temperatures are stored in Celsius
 * Display: User can choose Celsius or Fahrenheit via preferences
 */

/**
 * Convert Celsius to Fahrenheit
 */
export function celsiusToFahrenheit(celsius: number): number {
  return (celsius * 9 / 5) + 32;
}

/**
 * Convert temperature from Celsius to the user's preferred unit
 *
 * @param celsius - Temperature in Celsius (storage standard)
 * @param unit - User's preferred unit ('C' or 'F')
 * @returns Temperature in the requested unit
 */
export function convertTemperature(celsius: number, unit: 'C' | 'F'): number {
  if (unit === 'F') {
    return celsiusToFahrenheit(celsius);
  }
  return celsius;
}

/**
 * Format temperature with unit symbol
 *
 * @param celsius - Temperature in Celsius (storage standard)
 * @param unit - User's preferred unit ('C' or 'F')
 * @param decimals - Number of decimal places (default: 1)
 * @returns Formatted temperature string with unit (e.g., "45.0°C" or "113.0°F")
 */
export function formatTemperature(
  celsius: number,
  unit: 'C' | 'F',
  decimals: number = 1
): string {
  const converted = convertTemperature(celsius, unit);
  const rounded = converted.toFixed(decimals);
  return `${rounded}°${unit}`;
}

/**
 * Get temperature status (for color coding)
 *
 * Thresholds based on typical hardware safe operating ranges:
 * - Normal: < 70°C (158°F)
 * - Warning: 70-85°C (158-185°F)
 * - Critical: > 85°C (185°F)
 *
 * @param celsius - Temperature in Celsius (storage standard)
 * @returns Status string: 'normal' | 'warning' | 'critical'
 */
export function getTemperatureStatus(celsius: number): 'normal' | 'warning' | 'critical' {
  if (celsius < 70) {
    return 'normal';
  } else if (celsius < 85) {
    return 'warning';
  } else {
    return 'critical';
  }
}

/**
 * Get Tailwind CSS classes for temperature status
 *
 * @param celsius - Temperature in Celsius (storage standard)
 * @returns Tailwind CSS classes for text color
 */
export function getTemperatureColorClass(celsius: number): string {
  const status = getTemperatureStatus(celsius);

  switch (status) {
    case 'normal':
      return 'text-green-500';
    case 'warning':
      return 'text-yellow-500';
    case 'critical':
      return 'text-red-500';
  }
}
