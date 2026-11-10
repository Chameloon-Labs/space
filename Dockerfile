# Self-host your spaces: docker build -t chameloon-spaces sdk && docker run -p 8787:8787 -v $PWD/my-spaces:/spaces chameloon-spaces
FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json ./
RUN bun install --production
COPY src ./src
COPY bin ./bin
ENV PORT=8787 SPACES=/spaces
EXPOSE 8787
VOLUME /spaces
CMD ["bun", "bin/serve.ts"]
