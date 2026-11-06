# ---------- Etapa 1: build de frontend y backend ----------
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: no se ejecutan scripts de instalación de terceros (cadena de suministro)
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build

# ---------- Etapa 2: imagen final mínima ----------
# El servidor se empaqueta con esbuild en un único fichero (dist/server.cjs),
# así que la imagen final no necesita node_modules.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1
CMD ["node", "dist/server.cjs"]
