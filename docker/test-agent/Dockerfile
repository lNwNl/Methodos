FROM node:24-alpine
RUN mkdir -p /home/kali/workspace
WORKDIR /home/kali/workspace
COPY mock-opencode.js /usr/local/bin/opencode
RUN chmod +x /usr/local/bin/opencode
COPY validate-json.js /usr/local/bin/validate-json
RUN chmod +x /usr/local/bin/validate-json
