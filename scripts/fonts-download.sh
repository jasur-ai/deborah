#!/usr/bin/env bash
# STEP 08 — Font downloader (curl asosida, Node fetch proxy'da ETIMEDOUT bergani uchun)
# Google Fonts CSS2 API -> woff2 subset fayllar -> public/fonts/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p public/fonts

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

dl_family() {
  local name="$1" spec="$2"
  local css
  css="$(curl -s --max-time 30 -A "$UA" "https://fonts.googleapis.com/css2?family=${spec}&display=swap")"
  # @font-face bloklarini ajratamiz; har birida subset commenti va url bor
  echo "$css" | awk -v name="$name" '
    /@font-face/ { inblock=1; subset="latin"; url=""; weight="400"; }
    inblock && /\/\* latin/ { subset="latin"; }
    inblock && /\/\* latin-ext/ { subset="latinext"; }
    inblock && /\/\* cyrillic/ { subset="cyrillic"; }
    inblock && /\/\* cyrillic-ext/ { subset="cyrillicext"; }
    inblock && /\/\* vietnamese/ { subset="vietnamese"; }
    inblock && /\/\* greek/ { subset="greek"; }
    inblock && /font-weight:/ { w=$0; sub(/.*font-weight:\s*/,"",w); sub(/;.*/,"",w); weight=w; }
    inblock && /url\(/ { url=$0; sub(/.*url\(/,"",url); sub(/\).*/,"",url); }
    inblock && /}/ {
      if (url != "") print name "|" subset "|" weight "|" url;
      inblock=0; url="";
    }
  ' | while IFS='|' read -r fname subset weight url; do
    local out="public/fonts/${fname}-${subset}-${weight}.woff2"
    if [ ! -s "$out" ]; then
      curl -s --max-time 40 -A "$UA" -o "$out" "$url"
    fi
    printf 'OK %s (%sKB)\n' "$out" "$(( $(stat -c%s "$out") / 1024 ))"
  done
  echo "--- $name done"
}

dl_family source-sans-3 'Source+Sans+3:wght@200..900'
dl_family manrope 'Manrope:wght@200..800'
dl_family ibm-plex-mono 'IBM+Plex+Mono:wght@400;500;600;700'
echo 'ALL DONE'
