import os
import json
from datetime import datetime, timedelta

# Get the file path from environment variable or use default
LAST_TWEET_FILE_PATH = os.getenv("LAST_TWEET_FILE_PATH", "/app/data/last_tweet.json")
HOURS_THRESHOLD = int(os.getenv("HOURS_THRESHOLD") or "3")


# Function to check the file and timestamp
def check_last_tweet():
    # Check if the file exists
    if not os.path.exists(LAST_TWEET_FILE_PATH):
        raise FileNotFoundError(f"Error: File '{LAST_TWEET_FILE_PATH}' does not exist.")

    # Read the file content
    try:
        with open(LAST_TWEET_FILE_PATH, "r") as file:
            data = json.load(file)
    except json.JSONDecodeError:
        raise ValueError(f"Error: File '{LAST_TWEET_FILE_PATH}' contains invalid JSON.")

    # Ensure the timestamp key exists
    if "timestamp" not in data:
        raise KeyError(
            f"Error: File '{LAST_TWEET_FILE_PATH}' does not contain a 'timestamp' key."
        )

    # Get the current time and calculate the threshold time (3 hours ago)
    current_time = datetime.now()
    threshold_time = current_time - timedelta(hours=HOURS_THRESHOLD)

    # Convert the timestamp to a datetime object
    try:
        file_timestamp = datetime.fromtimestamp(
            data["timestamp"] / 1000
        )  # Convert from milliseconds to seconds
    except (TypeError, ValueError):
        raise ValueError(f"Error: Invalid timestamp value in '{LAST_TWEET_FILE_PATH}'.")

    # Check if the timestamp is older than 3 hours
    if file_timestamp < threshold_time:
        raise ValueError(
            f"Error: The timestamp in '{LAST_TWEET_FILE_PATH}' is older than {HOURS_THRESHOLD} hours."
        )

    print("File and timestamp are valid.")


# Run the check
if __name__ == "__main__":
    try:
        check_last_tweet()
    except Exception as e:
        print(e)
