FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ARG LOCAL_PROFILE_APPROVAL=0
ARG PLATFORM_SYNTHETIC_DEMO=0
ARG HARBOURLINE_INSTALLATION=core
ARG HARBOURLINE_PEER_PORT=0
RUN PLATFORM_CONTAINER_FRONTEND=1 VITE_API_BASE_URL=/api/v1 npm run build

FROM nginx:stable-alpine
RUN rm /etc/nginx/conf.d/default.conf
COPY nginx.conf.template /etc/nginx/templates/console.conf.template
COPY --from=build /app/dist/ /usr/share/nginx/html/
EXPOSE 8080
