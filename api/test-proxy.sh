#!/bin/bash
# Quick test script for proxy server

echo "🧪 Testing AI Enhancement Proxy"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROXY_URL="${1:-http://localhost:3000}"

echo "📍 Testing proxy at: $PROXY_URL"
echo ""

# Test 1: Health Check
echo "Test 1: Health Check"
echo "--------------------"
HEALTH_RESPONSE=$(curl -s -w "\n%{http_code}" "$PROXY_URL/health")
HEALTH_CODE=$(echo "$HEALTH_RESPONSE" | tail -n1)
HEALTH_BODY=$(echo "$HEALTH_RESPONSE" | head -n-1)

if [ "$HEALTH_CODE" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Health check returned 200"
    echo "Response: $HEALTH_BODY"
else
    echo -e "${RED}✗ FAIL${NC} - Health check returned $HEALTH_CODE"
    echo "Response: $HEALTH_BODY"
fi
echo ""

# Test 2: Enhancement Endpoint (minimal test)
echo "Test 2: Enhancement Endpoint"
echo "----------------------------"
ENHANCE_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PROXY_URL/api/enhance-description" \
  -H "Content-Type: application/json" \
  -d '{
    "description": "Short test description for validation.",
    "systemPrompt": "Return only: {\"sections\": [{\"title\": \"Test\", \"type\": \"paragraph\", \"content\": \"Test\"}]}",
    "model": "claude-sonnet-4-5-20250929",
    "maxTokens": 256
  }')

ENHANCE_CODE=$(echo "$ENHANCE_RESPONSE" | tail -n1)
ENHANCE_BODY=$(echo "$ENHANCE_RESPONSE" | head -n-1)

if [ "$ENHANCE_CODE" = "200" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Enhancement endpoint returned 200"
    echo "Response (truncated): $(echo "$ENHANCE_BODY" | head -c 200)..."
else
    echo -e "${RED}✗ FAIL${NC} - Enhancement endpoint returned $ENHANCE_CODE"
    echo "Response: $ENHANCE_BODY"

    if [ "$ENHANCE_CODE" = "500" ] && [[ "$ENHANCE_BODY" == *"API key"* ]]; then
        echo -e "${YELLOW}⚠ Hint: Set ANTHROPIC_API_KEY environment variable${NC}"
    fi
fi
echo ""

# Test 3: Invalid Request (should return 400)
echo "Test 3: Error Handling"
echo "----------------------"
ERROR_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$PROXY_URL/api/enhance-description" \
  -H "Content-Type: application/json" \
  -d '{"invalid": "data"}')

ERROR_CODE=$(echo "$ERROR_RESPONSE" | tail -n1)

if [ "$ERROR_CODE" = "400" ]; then
    echo -e "${GREEN}✓ PASS${NC} - Invalid request correctly rejected with 400"
else
    echo -e "${YELLOW}⚠ WARN${NC} - Expected 400 for invalid request, got $ERROR_CODE"
fi
echo ""

# Summary
echo "================================"
echo "Summary"
echo "================================"
if [ "$HEALTH_CODE" = "200" ] && [ "$ENHANCE_CODE" = "200" ] && [ "$ERROR_CODE" = "400" ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo ""
    echo "Your proxy is ready to use."
    echo "Set VITE_AI_PROXY_URL=$PROXY_URL in frontend .env"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    echo ""
    echo "Check the logs above for details."
    echo "Common issues:"
    echo "  - ANTHROPIC_API_KEY not set"
    echo "  - Proxy not running"
    echo "  - CORS configuration"
    exit 1
fi
