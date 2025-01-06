import { Scraper } from './src/_module';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import fetch from 'node-fetch';
import winston from 'winston';
dotenv.config();

// Constants
const DATA_DIR = './data';
const CACHE_FILE = path.join(DATA_DIR, 'tweet_cache.json');
const QUEUE_FILE = path.join(DATA_DIR, 'tweet_queue.json');
const LAST_TWEET_FILE = path.join(DATA_DIR, 'last_tweet.json');
const MEDIA_CACHE_DIR = path.join(DATA_DIR, 'media_cache');
const SCREENSHOT_API = 'https://memerepublic.ai/npc/getScreenshotList';
const LOG_DIR = process.env.LOG_DIR || './data/logs';
// Tweet interval is fixed at 2 hours
const TWEET_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
// Check interval can be configured but won't affect tweet frequency
const CHECK_INTERVAL_MS = parseInt(process.env.CHECK_INTERVAL_MINUTES || '30') * 60 * 1000;
const MIN_QUEUE_SIZE = 10;

function serializeError(info: any) {
  if (info instanceof Error) {
    return Object.assign({
      message: info.message,
      stack: info.stack
    }, info);
  }
};

// Configure logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'twitter-agent' },
  transports: [
    new winston.transports.File({ 
      filename: path.join(LOG_DIR, 'error.log'), 
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.File({ 
      filename: path.join(LOG_DIR, 'combined.log'),
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.printf(({ level, message, timestamp, service, ...metadata }) => {
          let msg = `${timestamp} [${level}] : ${message}`;
          // Only include metadata if it contains more than just the service field
          if (Object.keys(metadata).length > 0) {
            msg += ` ${JSON.stringify(metadata)}`;
          }
          return msg;
        })
      )
    })
  ]
});

// Ensure required directories exist
[LOG_DIR, MEDIA_CACHE_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

interface TweetContent {
  Text: string;
  MediaUrls: string[];
}

interface QueuedTweet extends TweetContent {
  id: string;  // unique identifier for deduplication
  cachedMediaPaths: string[];  // paths to locally cached media files
  addedAt: number;  // timestamp when added to queue
}

interface TweetQueue {
  tweets: QueuedTweet[];
  lastUpdated: number;
}

interface LastTweet {
  timestamp: number;
}

interface TweetCache {
  postedTweets: { [id: string]: number }; // id -> timestamp when posted
}

function generateId(content: TweetContent): string {
  return Buffer.from(content.Text + content.MediaUrls.join()).toString('base64');
}

async function loadQueue(): Promise<TweetQueue> {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      const data = fs.readFileSync(QUEUE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Error loading queue:', { error: serializeError(error) });
  }
  return { tweets: [], lastUpdated: 0 };
}

async function saveQueue(queue: TweetQueue): Promise<void> {
  try {
    fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
  } catch (error) {
    logger.error('Error saving queue:', { error: serializeError(error) });
  }
}

// Check if ffmpeg is available
async function checkFfmpeg(): Promise<boolean> {
  try {
    await new Promise((resolve, reject) => {
      const { exec } = require('child_process');
      exec('ffmpeg -version', (error: any) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
    return true;
  } catch (error) {
    logger.error('ffmpeg is not installed or not accessible');
    throw new Error('ffmpeg is required but not installed or not accessible');
  }
}

async function convertVideo(inputPath: string): Promise<string> {
  const outputPath = inputPath.replace('.mp4', '_converted.mp4');
  
  // Skip if already converted
  if (fs.existsSync(outputPath)) {
    return outputPath;
  }

  return new Promise((resolve, reject) => {
    const { exec } = require('child_process');
    const command = `ffmpeg -i ${inputPath} -c:v libx264 -crf 20 -preset slow -vf format=yuv420p -c:a aac -movflags +faststart ${outputPath}`;
    
    exec(command, (error: any) => {
      if (error) {
        logger.error('Error converting video:', { error: serializeError(error) });
        reject(error);
      } else {
        resolve(outputPath);
      }
    });
  });
}

async function cacheMedia(url: string): Promise<string> {
  const extension = path.extname(url) || '.bin';
  const filename = `${Date.now()}-${Math.random().toString(36).substring(7)}${extension}`;
  const filePath = path.join(MEDIA_CACHE_DIR, filename);

  try {
    const buffer = await downloadImage(url);
    fs.writeFileSync(filePath, buffer);

    // If it's an MP4 file, convert it
    if (extension.toLowerCase() === '.mp4') {
      await checkFfmpeg(); // Ensure ffmpeg is available
      const convertedPath = await convertVideo(filePath);
      return convertedPath;
    }

    return filePath;
  } catch (error) {
    logger.error('Error caching media:', { error: serializeError(error), url });
    throw error;
  }
}

async function getScreenshotData(): Promise<TweetContent[]> {
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
      logger.error('Error parsing mock data:', { error: serializeError(error) });
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

async function loadCache(): Promise<TweetCache> {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const data = fs.readFileSync(CACHE_FILE, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    logger.error('Error loading tweet cache:', { error: serializeError(error) });
  }
  return { postedTweets: {} };
}

async function saveCache(cache: TweetCache): Promise<void> {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (error) {
    logger.error('Error saving tweet cache:', { error: serializeError(error) });
  }
}

async function addToCache(tweetId: string): Promise<void> {
  const cache = await loadCache();
  cache.postedTweets[tweetId] = Date.now();
  await saveCache(cache);
}

async function isInCache(tweetId: string): Promise<boolean> {
  const cache = await loadCache();
  return tweetId in cache.postedTweets;
}

async function refreshQueue(): Promise<void> {
  const queue = await loadQueue();
  
  if (queue.tweets.length >= MIN_QUEUE_SIZE) {
    logger.debug('Queue has sufficient tweets', { queueSize: queue.tweets.length });
    return;
  }

  try {
    logger.info('Fetching new tweets from API');
    const newTweets = await getScreenshotData();
    
    // Process each new tweet
    for (const tweet of newTweets) {
      const id = generateId(tweet);
      
      // Skip if tweet is already in queue or has been posted before
      if (queue.tweets.some(t => t.id === id) || await isInCache(id)) {
        logger.debug('Skipping duplicate or previously posted tweet', { id });
        continue;
      }

      try {
        // Cache all media files
        logger.debug('Caching media files', { urls: tweet.MediaUrls });
        const cachedPaths = await Promise.all(tweet.MediaUrls.map(url => cacheMedia(url)));

        // Add to queue
        queue.tweets.push({
          ...tweet,
          id,
          cachedMediaPaths: cachedPaths,
          addedAt: Date.now()
        });
      } catch (error) {
        // If media caching fails, log the error and skip this tweet
        logger.warn('Failed to cache media for tweet, skipping', { 
          error: serializeError(error), 
          tweetId: id,
          mediaUrls: tweet.MediaUrls 
        });
        continue;
      }
    }

    queue.lastUpdated = Date.now();
    await saveQueue(queue);
    logger.info('Queue refreshed successfully', { newQueueSize: queue.tweets.length });
  } catch (error) {
    logger.error('Error refreshing queue:', { error: serializeError(error) });
    throw error;
  }
}

async function getNextTweet(): Promise<QueuedTweet | null> {
  const queue = await loadQueue();
  if (queue.tweets.length === 0) {
    return null;
  }

  // Get the oldest tweet
  const tweet = queue.tweets.shift();
  await saveQueue(queue);
  return tweet || null;
}

async function loadLastTweetTime(): Promise<number> {
  try {
    if (fs.existsSync(LAST_TWEET_FILE)) {
      const data = fs.readFileSync(LAST_TWEET_FILE, 'utf8');
      const lastTweet: LastTweet = JSON.parse(data);
      return lastTweet.timestamp;
    }
  } catch (error) {
    logger.error('Error loading last tweet time:', { error: serializeError(error) });
  }
  return 0;
}

async function saveLastTweetTime(timestamp: number): Promise<void> {
  try {
    fs.writeFileSync(LAST_TWEET_FILE, JSON.stringify({ timestamp }));
  } catch (error) {
    logger.error('Error saving last tweet time:', { error: serializeError(error) });
  }
}

async function shouldSendTweet(): Promise<boolean> {
  const lastTweetTime = await loadLastTweetTime();
  const timeSinceLastTweet = Date.now() - lastTweetTime;
  const shouldTweet = timeSinceLastTweet >= TWEET_INTERVAL_MS;
  
  if (!shouldTweet) {
    const nextTweetIn = Math.ceil((TWEET_INTERVAL_MS - timeSinceLastTweet) / 1000 / 60);
    logger.info(`Too soon to tweet. Next tweet will be allowed in ${nextTweetIn} minutes`);
  }
  
  return shouldTweet;
}

async function checkAndPostUpdate(scraper: Scraper): Promise<void> {
  try {
    // Check if enough time has passed since last tweet
    if (!await shouldSendTweet()) {
      return;
    }

    // Ensure queue has enough tweets
    await refreshQueue();

    // Get next tweet to post
    const tweet = await getNextTweet();
    if (!tweet) {
      logger.info('No tweets available in queue');
      return;
    }

    // Prepare media data from cached files
    logger.debug('Preparing media from cache');
    const mediaData = tweet.cachedMediaPaths.map(filePath => {
      const buffer = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mediaType = ext === '.mp4' ? 'video/mp4' : 'image/png';
      return { data: buffer, mediaType };
    });

    // Send tweet
    logger.info('Posting tweet', { text: tweet.Text });
    const result = await scraper.sendTweet(tweet.Text, undefined, mediaData);
    // const result = '{"status": "success", "tweetId": "MockTweetId"}';
    logger.info('Tweet posted successfully', { result });

    // Add to cache and update last tweet timestamp
    await addToCache(tweet.id);
    await saveLastTweetTime(Date.now());
  } catch (error) {
    console.error(error);
    logger.error('Error in checkAndPostUpdate:', { error: serializeError(error) });
  }
}

async function main() {
  let scraper: Scraper | null = null;

  try {
    // Initialize scraper and login (only once)
    scraper = new Scraper();
    await scraper.login(
      process.env.TWITTER_USERNAME!,
      process.env.TWITTER_PASSWORD!,
      process.env.TWITTER_EMAIL!,
      process.env.TWITTER_TWO_FACTOR_SECRET!
    );
    logger.info('Logged in successfully');

    logger.info('Starting periodic check', { intervalMinutes: CHECK_INTERVAL_MS/1000/60 });
    
    // First check immediately after login
    await checkAndPostUpdate(scraper);

    // Then start the periodic loop
    while (true) {
      await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL_MS));
      logger.info('Running periodic check', { timestamp: new Date().toISOString() });
      await checkAndPostUpdate(scraper);
    }

  } catch (error) {
    logger.error('Fatal error:', { error: serializeError(error) });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Run the main function
main().catch((error) => {
  logger.error('Unhandled error:', { error: serializeError(error) });
  process.exit(1);
});

