/**
 * Universal text wrapping utilities for terminal command outputs
 * Handles long text lines to prevent horizontal scrolling on mobile devices
 */

import { getAvailableWidth, isMobileDevice } from './mobile';

/**
 * Wraps long text content to prevent horizontal overflow
 * @param content - The HTML content to wrap
 * @param maxWidth - Optional maximum width override
 * @returns Wrapped content with proper line breaks
 */
export const wrapCommandOutput = (content: string, maxWidth?: number): string => {
  if (!content || typeof content !== 'string') {
    return content;
  }

  // Calculate available width for text
  const availableWidth = maxWidth || getAvailableWidth();
  const charWidth = isMobileDevice() ? 8 : 10; // Approximate character width in pixels
  const maxCharsPerLine = Math.floor(availableWidth / charWidth);
  
  // Minimum characters per line to prevent overly narrow text
  const minCharsPerLine = 30;
  const effectiveMaxChars = Math.max(minCharsPerLine, maxCharsPerLine);

  // Apply CSS-based text wrapping that works with HTML content
  return `<div class="command-output-wrapper" style="
    max-width: ${availableWidth}px;
    word-wrap: break-word;
    word-break: break-word;
    overflow-wrap: break-word;
    white-space: pre-wrap;
    overflow-x: hidden;
    line-height: 1.4;
  ">${content}</div>`;
};

/**
 * Wraps plain text content by inserting line breaks
 * @param text - Plain text to wrap
 * @param maxCharsPerLine - Maximum characters per line
 * @returns Text with line breaks inserted
 */
export const wrapPlainText = (text: string, maxCharsPerLine?: number): string => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  const availableWidth = getAvailableWidth();
  const charWidth = isMobileDevice() ? 8 : 10;
  const defaultMaxChars = Math.max(30, Math.floor(availableWidth / charWidth));
  const maxChars = maxCharsPerLine || defaultMaxChars;

  // Split text into lines and wrap each line
  const lines = text.split('\n');
  const wrappedLines: string[] = [];

  lines.forEach(line => {
    if (line.length <= maxChars) {
      wrappedLines.push(line);
    } else {
      // Break long lines at word boundaries when possible
      const words = line.split(' ');
      let currentLine = '';
      
      words.forEach(word => {
        if ((currentLine + ' ' + word).length <= maxChars) {
          currentLine = currentLine ? currentLine + ' ' + word : word;
        } else {
          if (currentLine) {
            wrappedLines.push(currentLine);
          }
          
          // Handle very long words that exceed maxChars
          if (word.length > maxChars) {
            for (let i = 0; i < word.length; i += maxChars) {
              wrappedLines.push(word.substring(i, i + maxChars));
            }
            currentLine = '';
          } else {
            currentLine = word;
          }
        }
      });
      
      if (currentLine) {
        wrappedLines.push(currentLine);
      }
    }
  });

  return wrappedLines.join('\n');
};

/**
 * Creates responsive CSS for command outputs
 * @returns CSS string for responsive text handling
 */
export const getResponsiveTextCSS = (): string => {
  return `
    .command-output-wrapper {
      max-width: 100%;
      word-wrap: break-word;
      word-break: break-word;
      overflow-wrap: break-word;
      white-space: pre-wrap;
      overflow-x: hidden;
      line-height: 1.4;
    }
    
    @media (max-width: 768px) {
      .command-output-wrapper {
        font-size: 0.75rem;
        line-height: 1.3;
      }
    }
    
    @media (max-width: 480px) {
      .command-output-wrapper {
        font-size: 0.7rem;
        line-height: 1.2;
        max-width: calc(100vw - 32px);
      }
    }
  `;
};

/**
 * Applies text wrapping to command output based on device type
 * @param content - The command output content
 * @returns Wrapped content optimized for the current device
 */
export const applyResponsiveWrapping = (content: string): string => {
  if (!content) return content;
  
  // Only apply wrapping on mobile devices
  const shouldWrap = isMobileDevice();
  
  if (shouldWrap) {
    return wrapCommandOutput(content);
  }
  
  return content;
};