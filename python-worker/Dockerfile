FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    fonts-liberation libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
# Install PyTorch CPU-only first (smaller, avoids CUDA dependencies)
RUN pip install --no-cache-dir torch torchvision \
    --index-url https://download.pytorch.org/whl/cpu
# Install open-clip and remaining requirements
RUN pip install --no-cache-dir open-clip-torch
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["python", "main.py"]