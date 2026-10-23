FROM node:22-bookworm-slim

ENV NODE_ENV=production PORT=3000
WORKDIR /app

COPY --chown=node:node server.mjs ./
COPY --chown=node:node db ./db
COPY --chown=node:node public ./public

RUN mkdir -p /app/data /app/private-files \
  && chown -R node:node /app/data /app/private-files \
  && chmod 700 /app/data /app/private-files

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.mjs"]
