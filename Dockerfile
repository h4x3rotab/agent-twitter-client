FROM ubuntu:24.04

# Set environment variables to avoid interactive prompts during installation
ENV DEBIAN_FRONTEND=noninteractive

# Update the package list and install prerequisites
RUN apt-get update && apt-get install -y \
    curl \
    software-properties-common \
    gnupg \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js v22.x
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get update && apt-get install -y nodejs && \
    node --version | grep v22. || (echo "Node.js version mismatch" && exit 1)

# Install FFmpeg
RUN apt-get update && apt-get install -y ffmpeg && \
    ffmpeg -version

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json (if available)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Start the application
CMD ["npm", "run", "run"]
