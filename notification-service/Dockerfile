FROM node:24-alpine
WORKDIR /app/notification-service
COPY notification-service/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node shared /app/shared
COPY --chown=node:node notification-service /app/notification-service
ENV NODE_ENV=production
USER node
EXPOSE 5005
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 CMD node -e "fetch('http://127.0.0.1:5005/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
