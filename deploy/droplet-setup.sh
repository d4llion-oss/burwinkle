#!/usr/bin/env bash
# One-shot setup for a fresh Ubuntu 24.04 Droplet. Run as root:
#   curl -fsSL <raw url of this file> | bash    (or copy it over and run it)
# Installs Docker, opens the firewall, and prepares /opt/burwinkle.
set -euo pipefail

echo "==> Installing Docker"
apt-get update -y
apt-get install -y ca-certificates curl gnupg ufw
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
systemctl enable --now docker

echo "==> Firewall: allow SSH, HTTP, HTTPS"
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "==> App directory"
mkdir -p /opt/burwinkle
echo
echo "Done. Next:"
echo "  1. Copy the Burwinkle folder to /opt/burwinkle (scp or git clone)."
echo "  2. cd /opt/burwinkle && cp .env.example .env && nano .env"
echo "  3. docker compose up -d --build"
echo "  4. docker compose exec app npm run seed   (optional example stories)"
