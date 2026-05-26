# Playwright + Chromium base image (Krak.dk returns 403 to plain HTTP — a real
# browser is required).
FROM apify/actor-node-playwright-chrome:20

COPY --chown=myuser package*.json ./

# Install ALL deps including devDependencies (typescript) so we can compile.
# The base image sets NODE_ENV=production, which would otherwise make npm skip
# devDependencies — hence the explicit --include=dev.
RUN npm install --include=dev --no-audit --no-fund \
    && echo "Installed npm dependencies"

COPY --chown=myuser . ./

# Compile TypeScript → dist/ (tsc is now on the PATH via node_modules/.bin).
RUN npm run build

# Slim the runtime image by dropping devDependencies after the build.
RUN npm prune --omit=dev

CMD ["npm", "start", "--silent"]
