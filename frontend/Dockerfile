# Build stage: compile the Astro static site to dist/
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY astro.config.mjs tsconfig.json ./
COPY public ./public
COPY src ./src

# PUBLIC_API_BASE_URL is baked into the static bundle at build time.
# Leave empty for a same-origin deployment behind nginx (relative /api calls).
ARG PUBLIC_API_BASE_URL=""
ENV PUBLIC_API_BASE_URL=$PUBLIC_API_BASE_URL
RUN npm run build

# Runtime stage: serve static assets behind nginx, proxying /api to the backend.
FROM nginx:1.27-alpine AS runtime
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]