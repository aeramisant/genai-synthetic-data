## --- Build Stage ---
FROM node:20-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --production=false
COPY . .

## (Placeholder) If you later add a React client build step, run it here
# RUN npm run build

## --- Runtime Stage ---
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --production
EXPOSE 4000
CMD ["node", "src/index.js"]
