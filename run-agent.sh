#!/bin/bash

# Change to the script directory
cd "$(dirname "$0")"

# Example of using mock data (uncomment and modify as needed)
# export MOCK_SCREENSHOT_RESPONSE='{"Text":"This is a test tweet","MediaUrls":["https://example.com/test.png"]}'

# Run the agent using tsx (TypeScript execution)
LOG_LEVEL=debug MOCK_SCREENSHOT_RESPONSE=./data/getScreenshot.json npx tsx SampleAgent.ts 
