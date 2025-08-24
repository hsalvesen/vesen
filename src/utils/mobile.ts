/**
 * Mobile detection utilities for responsive terminal layouts
 */

/**
 * Detects if the current device is likely a mobile device based on screen width
 * Uses a breakpoint of 768px which is commonly used for mobile/tablet distinction
 */
export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.innerWidth <= 768;
};

/**
 * Detects if the current device is in portrait mode
 */
export const isPortraitMode = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return window.innerHeight > window.innerWidth;
};

/**
 * Detects if the device is mobile AND in portrait mode
 * This is the most restrictive case where horizontal space is very limited
 */
export const isMobilePortrait = (): boolean => {
  return isMobileDevice() && isPortraitMode();
};

/**
 * Gets the available width for content, accounting for padding/margins
 * Returns a conservative estimate for mobile layouts
 */
export const getAvailableWidth = (): number => {
  if (typeof window === 'undefined') {
    return 800; // Default fallback
  }
  
  const screenWidth = window.innerWidth;
  
  if (isMobileDevice()) {
    // Account for mobile padding/margins (typically 16-32px on each side)
    return Math.max(screenWidth - 64, 280); // Minimum 280px width
  }
  
  return screenWidth - 100; // Desktop padding
};

/**
 * Determines if content should use a stacked (vertical) layout instead of horizontal
 * Based on available width and content requirements
 */
export const shouldUseStackedLayout = (minHorizontalWidth: number = 600): boolean => {
  return getAvailableWidth() < minHorizontalWidth;
};