#!/bin/sh
cat > /usr/share/nginx/html/config.js <<EOF
window.__CLEANCENTIVE_CONFIG__ = {
  umamiScriptUrl: "${UMAMI_SCRIPT_URL:-}",
  umamiWebsiteId: "${UMAMI_WEBSITE_ID:-}",
  umamiShareUrl: "${UMAMI_SHARE_URL:-}"
};
EOF
exec nginx -g 'daemon off;'
