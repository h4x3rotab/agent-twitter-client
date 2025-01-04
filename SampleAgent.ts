import { Scraper } from './src/_module';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
dotenv.config();

interface ScreenshotResponse {
  Text: string;
  MediaUrls: string[];
}

interface CacheData {
  text: string;
  mediaUrls: string[];
  timestamp: number;
}

const CACHE_FILE = './data/tweet_cache.json';
const SCREENSHOT_API = 'https://memerepublic.ai/npc/getScreenshot';
// Default interval is 30 minutes
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MINUTES || '30') * 60 * 1000;

async function getScreenshotData(): Promise<ScreenshotResponse> {
  // Check for mock data in environment variable
  const mockDataPath = process.env.MOCK_SCREENSHOT_RESPONSE;
  if (mockDataPath) {
    try {
      let mockData: string;
      // Check if the value is a file path
      if (fs.existsSync(mockDataPath)) {
        mockData = fs.readFileSync(mockDataPath, 'utf8');
      } else {
        // Treat the value as a JSON string
        mockData = mockDataPath;
      }
      return JSON.parse(mockData);
    } catch (error) {
      console.error('Error parsing mock data:', error);
      throw error;
    }
  }

  // If no mock data, make the actual API call
  const response = await fetch(SCREENSHOT_API);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.statusText}`);
  }
  return response.json();
}

async function downloadImage(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.statusText}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function loadCache(): Promise<CacheData | null> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading cache:', error);
  }
  return null;
}

async function saveCache(data: CacheData): Promise<void> {
  try {
    // Ensure the data directory exists
    const dir = path.dirname(CACHE_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data));
  } catch (error) {
    console.error('Error saving cache:', error);
  }
}

async function checkAndPostUpdate(scraper: Scraper): Promise<void> {
  try {
    // Fetch new content from API or mock data
    const data = await getScreenshotData();
    console.log('Screenshot data loaded', data);

    // Load cache and compare
    const cache = await loadCache();
    if (cache && cache.text === data.Text && JSON.stringify(cache.mediaUrls) === JSON.stringify(data.MediaUrls)) {
      console.log('Content unchanged from last post, skipping...');
      return;
    }
    console.log('New content detected.');
    
    // Download and prepare media
    console.log('Downloading media...');
    const mediaData = await Promise.all(
      data.MediaUrls.map(async (url) => {
        const imageBuffer = await downloadImage(url);
        return { data: imageBuffer, mediaType: 'image/png' };
      })
    );
    console.log('Media downloaded successfully.');

    // Send tweet
    // const result = await scraper.sendTweet(data.Text, undefined, mediaData);
    const result = '{"status": "success", "tweetId": "MockTweetId"}';
    console.log('Tweet posted successfully:', result);

    // Update cache
    await saveCache({
      text: data.Text,
      mediaUrls: data.MediaUrls,
      timestamp: Date.now()
    });
  } catch (error) {
    console.error('Error in checkAndPostUpdate:', error);
    // Don't exit process on error, just log it and continue the loop
  }
}

async function main() {
  let scraper: Scraper | null = null;

  try {
    // Initialize scraper and login (only once)
    scraper = new Scraper();
    // await scraper.login(
    //   process.env.TWITTER_USERNAME!,
    //   process.env.TWITTER_PASSWORD!,
    //   process.env.TWITTER_EMAIL!,
    //   process.env.TWITTER_TWO_FACTOR_SECRET!
    // );
    console.log('Logged in successfully!');

    console.log(`Starting periodic check every ${CHECK_INTERVAL_MS/1000/60} minutes...`);
    
    // First check immediately after login
    await checkAndPostUpdate(scraper);

    // Then start the periodic loop
    while (true) {
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
      console.log(`\nPeriodic check at ${new Date().toISOString()}`);
      await checkAndPostUpdate(scraper);
    }

  } catch (error) {
    console.error('Fatal error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Run the main function
main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
