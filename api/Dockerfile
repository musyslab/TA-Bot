FROM python:3.10-slim-bookworm

# Set working directory
WORKDIR /app

# Set timezone
ENV TZ=America/Chicago

# Copy the requirements file into the image
COPY ./requirements.txt /app/requirements.txt

# Upgrade pip to the latest version and install Python dependencies
RUN pip install --no-cache-dir --upgrade pip && \
    pip install -r requirements.txt

# Copy the entire content from the local directory to the image
COPY . /app

# Set Flask environment variables
ENV FLASK_APP=app.py
ENV FLASK_DEBUG=1

# Expose port 5001
EXPOSE 5001

# Start the Flask server
CMD ["flask", "run", "-h", "0.0.0.0", "-p", "5001"]
