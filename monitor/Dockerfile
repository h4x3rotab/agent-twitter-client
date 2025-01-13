FROM python:3.12-slim

# Set environment variables to ensure Python runs in an optimized and predictable way
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    POETRY_VERSION=2.0.0

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Poetry
RUN curl -sSL https://install.python-poetry.org | python3 -

# Make sure Poetry is available in PATH
ENV PATH="/root/.local/bin:$PATH"

# Set the working directory inside the container
WORKDIR /app

# Copy the project files to the container
COPY pyproject.toml poetry.lock /app/

# Install project dependencies using Poetry
RUN poetry install --no-root --only main

# Copy the remaining application code
COPY . /app

EXPOSE 8000

ENTRYPOINT ["./entrypoint.sh"]
