FROM node:22-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS dev

COPY tsconfig.json drizzle.config.ts ./
COPY drizzle ./drizzle
# src/ and test/ arrive via Nas's bind mount, not COPY.
CMD ["npm", "run", "db:migrate"]
