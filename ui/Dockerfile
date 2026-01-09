# ui/Dockerfile.dev
FROM node:24.12.0

WORKDIR /app

# leverage cache
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# copy all your source
COPY . .

# expose the port you configured in vite.config.js
EXPOSE 3000

# run Vite in host mode so it's accessible outside Docker
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
