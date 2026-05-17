FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
# Declare build-time arg so Next.js compiler keeps process.env.INTERNAL_API_URL
# instead of treating it as undefined and dead-code-eliminating it.
ARG INTERNAL_API_URL=http://go-core:8080
ENV INTERNAL_API_URL=${INTERNAL_API_URL}
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV production
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
ENV PORT 3000
CMD ["node", "server.js"]