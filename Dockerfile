FROM node:22-alpine

WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --chown=app:app . /app

USER app

EXPOSE 4173

CMD ["npm", "start"]
