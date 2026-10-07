FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json server/
COPY server/vendor server/vendor
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY index.html auth-store.cjs zone-store.cjs zone-validate.cjs ./
COPY src src
COPY config config
COPY data data
COPY server server

USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.mjs"]
