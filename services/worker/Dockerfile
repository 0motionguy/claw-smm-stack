FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy source
COPY src ./src

# Build
RUN npm run build

# Production dependencies only
RUN npm prune --production

EXPOSE 3001

CMD ["node", "dist/index.js"]
