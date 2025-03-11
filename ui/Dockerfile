# Use official Node.js image
FROM node:20.11.1

# Enable polling for file changes in Docker
ENV CHOKIDAR_USEPOLLING=true

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock first (to leverage caching)
COPY package.json yarn.lock .  

# Install dependencies inside the container
RUN yarn install --check-files

# Copy the rest of the application files
COPY . .

# Expose the port the app runs on
EXPOSE 3000

# Start the React app
CMD ["yarn", "start"]
