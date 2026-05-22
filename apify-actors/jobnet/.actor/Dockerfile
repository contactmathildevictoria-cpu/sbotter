# Playwright + Chromium base image (Jobnet is a SPA; scrape mode renders it).
FROM apify/actor-node-playwright-chrome:20

COPY --chown=myuser package*.json ./

RUN npm install --omit=dev --no-audit --no-fund \
    && echo "Installed npm dependencies"

COPY --chown=myuser . ./

RUN npx --no-install tsc

CMD ["npm", "start", "--silent"]
