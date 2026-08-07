# No build step needed: this is a static HTML/CSS/JS app served by a
# small Node http server (server-ui.js). Node's only dependency here is
# itself.
FROM node:20-slim
WORKDIR /app
COPY package.json ./
COPY server-ui.js ./
COPY public ./public
ENV PORT=8080
CMD ["node", "server-ui.js"]
