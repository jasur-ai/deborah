#!/bin/bash
# Cast E2E smoke test v2 — natija faylga yoziladi
cd /mnt/d/StartUp/deborah
OUT=/tmp/cast-e2e-out.txt
: > "$OUT"

export PORT=4007
LOG=/tmp/cast-e2e5.log
pkill -f 'node server.js' 2>/dev/null
sleep 2
node server.js > "$LOG" 2>&1 &
SPID=$!

for i in $(seq 1 20); do
  sleep 3
  C=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:4007/health 2>/dev/null)
  if [ "$C" = "200" ]; then
    echo "tayyor ${i}x3s" >> "$OUT"
    break
  fi
done

J='Content-Type: application/json'

# 1) User login (teacher)
curl -s -c /tmp/cu5.txt http://localhost:4007/user/login -o /tmp/cu5p.html
CSRF1=$(grep -oE 'name="_csrf" value="[^"]+"' /tmp/cu5p.html | head -1 | sed 's/.*value="//;s/"$//')
LCODE=$(curl -s -b /tmp/cu5.txt -c /tmp/cu5.txt -o /dev/null -w '%{http_code}' -X POST http://localhost:4007/user/login --data-urlencode 'username=teacher' --data-urlencode 'password=teacher34' --data-urlencode "_csrf=$CSRF1")
echo "LOGIN: $LCODE" >> "$OUT"

# 2) Panel'dan yangi CSRF
curl -s -b /tmp/cu5.txt http://localhost:4007/user/panel -o /tmp/cu5panel.html
CSRF=$(grep -oE '[a-f0-9]{64}' /tmp/cu5panel.html | head -1)
echo "CSRF: ${#CSRF} belgi" >> "$OUT"

# 3) Preflight
PF=$(curl -s -b /tmp/cu5.txt -X POST http://localhost:4007/api/cast/preflight -H "$J" -H "x-csrf-token: $CSRF" -d '{"source":{"type":"mock","key":"fizika_mexanika"}}')
echo "PREFLIGHT: $(echo "$PF" | head -c 200)" >> "$OUT"

# 4) Session create
PFID=$(echo "$PF" | grep -oE '"preflightId":"[^"]+"' | sed 's/.*":"//;s/"//')
echo "PFID: $PFID" >> "$OUT"
SESS=$(curl -s -b /tmp/cu5.txt -X POST http://localhost:4007/api/cast/sessions -H "$J" -H "x-csrf-token: $CSRF" -d "{\"preflightId\":\"$PFID\",\"source\":{\"type\":\"mock\",\"key\":\"fizika_mexanika\"},\"presetId\":\"responsive_accuracy\",\"overrides\":{}}")
echo "SESSION: $(echo "$SESS" | head -c 300)" >> "$OUT"

SID=$(echo "$SESS" | grep -oE '"sessionId":"[^"]+"' | sed 's/.*":"//;s/"//')
echo "SID: $SID" >> "$OUT"

# 5) Director sahifa
if [ -n "$SID" ]; then
  DCODE=$(curl -s -b /tmp/cu5.txt -o /tmp/cu5dir.html -w '%{http_code}' http://localhost:4007/cast/$SID/director)
  echo "DIRECTOR: $DCODE | director css: $(grep -c 'cast-director' /tmp/cu5dir.html 2>/dev/null)" >> "$OUT"
fi

echo "=== SERVER ERRORS ===" >> "$OUT"
grep -iE 'error|cast' "$LOG" | tail -8 >> "$OUT"

kill $SPID 2>/dev/null
wait $SPID 2>/dev/null
echo "DONE" >> "$OUT"
