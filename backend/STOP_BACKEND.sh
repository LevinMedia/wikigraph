#!/bin/bash
# Stop the backend server
echo "Stopping backend server on port 8000..."
lsof -ti:8000 2>/dev/null | xargs kill -9 2>/dev/null
ps aux | grep "uvicorn app.main:app" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null
echo "Backend stopped"


