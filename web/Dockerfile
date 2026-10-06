# ============================================================
# 通用媒体下载器 - Docker 部署
# ============================================================
# 构建:
#   docker build -t media-downloader .
# 运行:
#   docker run -d -p 5000:5000 -v downloads:/app/downloads media-downloader
# ============================================================

FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (ffmpeg for yt-dlp merging)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (better layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy app code
COPY app.py .
COPY templates/ templates/

# Create directories
RUN mkdir -p downloads thumbnails

# Expose port
EXPOSE 5000

# Run
CMD ["python", "app.py"]
