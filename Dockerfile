FROM nikolaik/python-nodejs:python3.9-nodejs20 AS base

# pnpm, not npm. This repo is pnpm-managed — `pnpm-lock.yaml` plus a
# `pnpm-workspace.yaml` carrying deliberate `allowBuilds` answers — and
# `npm install` cannot resolve the tree at all:
#
#   root                                    @solana/kit@^7.1.1
#   @solana-program/compute-budget@0.18.0   peer @solana/kit@^8.0.0
#   -> npm ERESOLVE, exit 1
#
# npm treats that peer conflict as fatal; pnpm does not, and the committed
# lockfile already pins a resolution that works.
#
# The version is pinned explicitly to match package.json's `packageManager`.
FROM base AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --frozen-lockfile fails the build when package.json and the lockfile disagree,
# instead of quietly resolving something that was never tested.
RUN pnpm install --frozen-lockfile

FROM base AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.34.5 --activate
COPY --from=deps /app/node_modules /app/node_modules
COPY . .
# NEXT_PUBLIC_* values are inlined into the bundle at build time and cannot be
# changed at runtime, so pass them as build arguments, e.g.
#   docker build --build-arg NEXT_PUBLIC_PRIVY_APP_ID=... --build-arg ... .
# `.env*` files are excluded from the build context by .dockerignore.
ARG NEXT_PUBLIC_BASE_URL
ARG NEXT_PUBLIC_API_BASE_URL
ARG NEXT_PUBLIC_PRIVY_APP_ID
ARG NEXT_PUBLIC_DEMO_CHAINS
ENV NEXT_PUBLIC_BASE_URL=$NEXT_PUBLIC_BASE_URL \
    NEXT_PUBLIC_API_BASE_URL=$NEXT_PUBLIC_API_BASE_URL \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    NEXT_PUBLIC_DEMO_CHAINS=$NEXT_PUBLIC_DEMO_CHAINS
ENV NODE_ENV=production
ENV SSR_MODE=1
ENV NODE_OPTIONS=--max-old-space-size=2048
RUN pnpm run build

FROM base AS runner
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
# `next start` writes its image/fetch cache under .next/cache, so that tree is
# the one path the unprivileged user below must own.
COPY --from=builder --chown=pn:pn /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.js ./
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
ENV SSR_MODE=1
ENV NODE_OPTIONS=--max-old-space-size=2048
# Drop root before serving. `pn` (uid 1000) is the unprivileged user the base
# image ships; everything else under /app only needs to be readable.
USER pn
# The image serves on 3000 (the `next start` default). NEXT_PUBLIC_BASE_URL is
# inlined at build time and must match the published URL, port included.
EXPOSE 3000
# `npm start` runs the "start" script, which resolves `next` from
# node_modules/.bin regardless of which package manager populated it. The whole
# node_modules is copied from the builder rather than reinstalled, so pnpm's
# symlink layout stays intact.
CMD ["npm", "start"]
