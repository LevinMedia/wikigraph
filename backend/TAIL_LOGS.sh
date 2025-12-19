#!/bin/bash
# Tail the backend server logs
cd "$(dirname "$0")"
if [ -f logs/backend.log ]; then
  tail -f logs/backend.log
else
  echo "Log file not found. The server needs to be restarted with START_BACKEND.sh to enable file logging."
  echo ""
  echo "If the server is running in another terminal, check that terminal for logs."
  echo "Or restart the server with: ./STOP_BACKEND.sh && ./START_BACKEND.sh"
fi

