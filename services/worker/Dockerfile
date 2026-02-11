FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
RUN npm install --production
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1
CMD ["node", "dist/index.js"]
