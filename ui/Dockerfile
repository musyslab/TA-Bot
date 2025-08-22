# ui/Dockerfile.dev
FROM node:20.11.1

# if you still need legacy OpenSSL…
ENV NODE_OPTIONS=--openssl-legacy-provider
# file‐watch polling in Docker
ENV CHOKIDAR_USEPOLLING=true

WORKDIR /app

# leverage cache
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

# copy all your source
COPY . .

# expose the port you configured in vite.config.js
EXPOSE 3000

# run Vite in host mode so it's accessible outside Docker
CMD ["yarn", "dev", "--host", "0.0.0.0"]