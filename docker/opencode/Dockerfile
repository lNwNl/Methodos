FROM --platform=amd64 kalilinux/kali-rolling:latest

# Layer 1: Kali metapackages — all CLI pentesting tools
RUN apt update && \
    apt install -y \
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
        kali-tools-fuzzing && \
    apt clean && \
    rm -rf /var/lib/apt/lists/*

# Layer 2: extra system tools (not covered by metapackages above)
RUN apt update && \
    apt install -y \
        bsdextrautils \
        jq \
        iputils-ping \
        sshpass \
        ncat \
        rlwrap && \
    apt clean && \
    rm -rf /var/lib/apt/lists/*

# Layer 3: Node.js + opencode
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && \
    apt install -y nodejs && \
    npm install -g opencode-ai@1.14.50 && \
    apt clean && rm -rf /var/lib/apt/lists/*

# Layer 4: uv/uvx — modern Python tooling, replaces pip
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:$PATH"

# Python libraries via uv (replaces pip3 install --break-system-packages)
RUN uv pip install --system pwntools

# Layer 5: sudo for root
RUN echo 'root ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/nopasswd && \
    chmod 440 /etc/sudoers.d/nopasswd

# Layer 6: validate-json self-validation script
COPY validate-json.js /usr/local/bin/validate-json
RUN chmod +x /usr/local/bin/validate-json

# Layer 7: opencode configs
RUN mkdir -p /home/kali/workspace/.opencode && \
    echo '{"permission":{"*":{"*":"allow"}}}' > /home/kali/workspace/.opencode/opencode.json && \
    mkdir -p /root/.config/opencode
COPY opencode.json /root/.config/opencode/opencode.json

WORKDIR /home/kali/workspace
CMD ["sleep", "infinity"]
