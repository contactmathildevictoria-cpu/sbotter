FROM apify/actor-node:20

COPY package*.json ./

RUN npm install --omit=dev --no-audit --no-fund \
    && echo "Installed npm dependencies"

COPY . ./

RUN npx --no-install tsc

CMD ["npm", "start", "--silent"]
