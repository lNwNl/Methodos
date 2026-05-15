FROM kalilinux/kali-rolling:latest

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates sudo && \
    curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

RUN echo 'root ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/nopasswd && chmod 440 /etc/sudoers.d/nopasswd

RUN npm install -g opencode-ai@1.14.50

COPY validate-json.js /usr/local/bin/validate-json
RUN chmod +x /usr/local/bin/validate-json

RUN mkdir -p /home/kali/workspace && \
    mkdir -p /home/kali/workspace/.opencode && \
    echo '{"permission":{"*":{"*":"allow"}}}' > /home/kali/workspace/.opencode/opencode.json

WORKDIR /home/kali/workspace

CMD ["sleep", "infinity"]
