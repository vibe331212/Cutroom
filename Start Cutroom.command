#!/bin/bash
# Double-click this file to open Cutroom in your browser.
cd "$(dirname "$0")"
PORT=5180
# stop an older copy of Cutroom that may still be running, so the newest version starts
OLD=$(lsof -ti tcp:$PORT -sTCP:LISTEN 2>/dev/null)
if [ -n "$OLD" ]; then kill $OLD 2>/dev/null; sleep 1; fi
python3 server.py $PORT &
sleep 1
open "http://localhost:$PORT"
echo "Cutroom is running at http://localhost:$PORT. Close this window to stop it."
wait
