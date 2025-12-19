#!/bin/bash
# Start the backend server
cd "$(dirname "$0")"
source venv/bin/activate

# Create logs directory if it doesn't exist
mkdir -p logs

# Start uvicorn and log to both stdout and file
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 2>&1 | tee logs/backend.log

