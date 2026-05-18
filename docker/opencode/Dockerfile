FROM --platform=amd64 kalilinux/kali-rolling:latest

# Single layer: apt packages + Node.js + opencode + sudo config
RUN apt update && \
    apt install -y --no-install-recommends \
        kali-tools-exploitation \
        kali-tools-post-exploitation \
        kali-tools-web \
        kali-tools-information-gathering \
        kali-tools-vulnerability \
        kali-tools-passwords \
        kali-tools-sniffing-spoofing \
        kali-tools-reverse-engineering \
        kali-tools-crypto-stego \
        kali-tools-windows-resources \
        kali-tools-database \
        kali-tools-fuzzing \
        bsdextrautils \
        jq \
        iputils-ping \
        sshpass \
        ncat \
        rlwrap \
        ca-certificates \
        curl \
        gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource_setup.sh && \
    bash /tmp/nodesource_setup.sh && \
    rm /tmp/nodesource_setup.sh && \
    apt install -y nodejs && \
    npm install -g opencode-ai@1.15.3 && \
    npm cache clean --force && \
    echo 'root ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/nopasswd && \
    chmod 440 /etc/sudoers.d/nopasswd && \
    apt clean && \
    rm -rf /var/lib/apt/lists/*

# Scripts + configs + skills (ordered by change frequency, least-frequent first)
COPY validate-json.js /usr/local/bin/validate-json
COPY opencode.json /root/.config/opencode/opencode.json
COPY skills/ /root/.agents/skills/
COPY AGENTS.md /root/workspace/AGENTS.md

# Workspace setup
RUN mkdir -p /root/workspace/.opencode && \
    echo '{"permission":{"*":{"*":"allow"}}}' > /root/workspace/.opencode/opencode.json

WORKDIR /root/workspace
CMD ["sleep", "infinity"]
