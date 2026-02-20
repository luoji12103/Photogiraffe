import time
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def main():
    logger.info("Python Worker started. Waiting for tasks...")
    while True:
        # Placeholder for Redis Stream listening
        time.sleep(10)

if __name__ == "__main__":
    main()