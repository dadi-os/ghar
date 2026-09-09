FROM node:24-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build

COPY tsconfig.json drizzle.config.ts config.toml ./
COPY src ./src
COPY drizzle ./drizzle
RUN npm run build

FROM deps AS dev

COPY tsconfig.json drizzle.config.ts config.toml ./
COPY drizzle ./drizzle
# src/ and test/ arrive via Nas's bind mount, not COPY.
EXPOSE 8080
CMD ["npm", "run", "dev"]

FROM node:24-slim AS production

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY config.toml ./
COPY drizzle ./drizzle
EXPOSE 8080
CMD ["node", "dist/index.js"]
