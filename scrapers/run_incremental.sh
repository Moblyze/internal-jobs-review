#!/bin/bash
# Quick incremental scrape runner
# Usage: ./run_incremental.sh [company] [max-pages]

set -e

# Activate virtual environment
source .venv/bin/activate

# Default values
COMPANY="${1:-}"
MAX_PAGES="${2:-5}"

echo "========================================"
echo "INCREMENTAL JOB SCRAPING"
echo "========================================"
echo "Company: ${COMPANY:-All companies}"
echo "Max pages: ${MAX_PAGES}"
echo "========================================"

# Build command
CMD="python incremental_scrape.py --max-pages ${MAX_PAGES}"

if [ -n "$COMPANY" ]; then
    CMD="${CMD} --company ${COMPANY}"
fi

# Run incremental scrape
echo "Starting incremental scrape..."
$CMD

echo ""
echo "✓ Incremental scrape complete!"
echo ""
