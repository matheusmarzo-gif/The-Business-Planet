FROM node:22-bookworm-slim
  WORKDIR /app
  COPY package.json package-lock.json ./
  RUN npm ci
  COPY . .
  ARG NEON_AUTH_BASE_URL
  ENV NEON_AUTH_BASE_URL=$NEON_AUTH_BASE_URL
  RUN npm run build
  EXPOSE 3001
  CMD ["npm", "start"]