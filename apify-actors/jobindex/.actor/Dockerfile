# Jobindex is largely server-rendered HTML — no browser needed; we scrape with
# Cheerio over plain HTTP, which is far cheaper/faster than Playwright. (Fall
# back to the playwright-chrome base image if recon shows the site is JS-gated.)
FROM apify/actor-node:20

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
