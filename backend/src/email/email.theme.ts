/**
 * Shared email theme aligned with frontend design tokens (frontend/src/index.css).
 *
 * Color values are duplicated here because emails are rendered server-side
 * and cannot reference CSS custom properties. Keep in sync with index.css.
 */

// Primitive palette (matches frontend/src/index.css :root)
const blue600 = '#2563eb';
const red600 = '#dc2626';
const gray800 = '#1f2937';
const gray500 = '#6b7280';
const gray100 = '#f3f4f6';

/** Default theme — brand blue, used for most emails */
export const defaultTheme = {
  brandColor: blue600,
  headingColor: gray800,
  bodyColor: gray500,
  backgroundColor: gray100,
  contentColor: '#ffffff',
  buttonColor: blue600,
  buttonTextColor: '#ffffff',
  dangerColor: red600,
  dangerTextColor: '#ffffff',
  fontFamily:
    "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  fontSize: '16px',
  lineHeight: '1.6',
  contentWidth: '600px',
};

/** Danger theme — red, used for merge warnings and destructive actions */
export const dangerTheme = {
  ...defaultTheme,
  brandColor: red600,
  buttonColor: red600,
};
