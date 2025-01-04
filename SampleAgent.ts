import { Scraper } from './src/_module';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
dotenv.config();

async function main() {
  const scraper = new Scraper();
  await scraper.login(
    process.env.TWITTER_USERNAME!,
    process.env.TWITTER_PASSWORD!,
    process.env.TWITTER_EMAIL!,
    process.env.TWITTER_TWO_FACTOR_SECRET!
  );
  console.log('Logged in successfully!');


  // Read test image and video files from the test-assets directory
  const imageBuffer = fs.readFileSync(
    path.join(__dirname, 'test-assets/test-image.png')
  );

  // Prepare media data array with both image and video
  const mediaData = [
    { data: imageBuffer, mediaType: 'image/png' },
  ];

  // Send a tweet with image attachments
  const draftText = 'Test tweet with image ' + Date.now().toString();
  const result = await scraper.sendTweet(draftText, undefined, mediaData);

  console.log('tweets', result);
}

main();
