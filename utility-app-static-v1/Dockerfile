# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:18-alpine AS builder

WORKDIR /app

# Accept Supabase public config as build args
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

COPY package.json package-lock.json ./
RUN npm ci --prefer-offline

COPY pages/ ./pages/
COPY lib/   ./lib/
COPY next.config.js ./
COPY .eslintrc.json ./

RUN npm run build

# ── Stage 2: Production runner ────────────────────────────────────────────────
FROM node:18-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/pages ./pages
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/next.config.js ./next.config.js

EXPOSE 3000

CMD ["node_modules/.bin/next", "start", "-p", "3000", "-H", "0.0.0.0"]
