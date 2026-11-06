#!/usr/bin/env bash
# Isolamento de rede do worker sem depender de servico externo.
#
# - O worker roda na rede Docker "frocia-egress" (sem IPv6).
# - O firewall do runner (DOCKER-USER/INPUT) descarta todo trafego da rede que
#   tente sair dela ou falar com o proprio runner, exceto respostas de conexoes
#   iniciadas pelo runner (porta publicada do worker).
# - A unica saida e o container "frocia-egress-proxy", que tambem esta ligado a
#   rede padrao e so abre tuneis HTTPS para a allowlist de worker/egress-allowlist.mjs.
#
# Uso: sudo bash scripts/worker-egress-firewall.sh up <imagem-do-worker>
#      Depois inicie o worker com: $(bash scripts/worker-egress-firewall.sh worker-args)
set -euo pipefail

NETWORK="${FROC_EGRESS_NETWORK:-frocia-egress}"
SUBNET="${FROC_EGRESS_SUBNET:-172.30.0.0/24}"
PROXY_NAME="${FROC_EGRESS_PROXY_NAME:-frocia-egress-proxy}"
PROXY_IP="${FROC_EGRESS_PROXY_IP:-172.30.0.2}"
WORKER_IP="${FROC_EGRESS_WORKER_IP:-172.30.0.10}"
PROXY_URL="http://${PROXY_IP}:3128"
NO_PROXY_LIST="localhost,127.0.0.1,::1"

worker_args() {
  printf '%s\n' \
    --network "$NETWORK" --ip "$WORKER_IP" \
    -e "HTTPS_PROXY=$PROXY_URL" -e "https_proxy=$PROXY_URL" \
    -e "HTTP_PROXY=$PROXY_URL" -e "http_proxy=$PROXY_URL" \
    -e "NO_PROXY=$NO_PROXY_LIST" -e "no_proxy=$NO_PROXY_LIST" \
    -e "NODE_USE_ENV_PROXY=1"
}

apply_firewall() {
  local bridge="$1"
  # Remove regras antigas desta rede para a etapa poder ser repetida.
  while iptables -D DOCKER-USER -s "$SUBNET" ! -d "$SUBNET" -j DROP 2>/dev/null; do :; done
  while iptables -D INPUT -i "$bridge" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; do :; done
  while iptables -D INPUT -i "$bridge" -j DROP 2>/dev/null; do :; done

  # Qualquer pacote da rede do worker com destino fora dela e descartado.
  iptables -I DOCKER-USER 1 -s "$SUBNET" ! -d "$SUBNET" -j DROP
  # O worker tambem nao fala com servicos do runner; apenas responde ao runner.
  iptables -I INPUT 1 -i "$bridge" -j DROP
  iptables -I INPUT 1 -i "$bridge" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  # Sem IPv6 na rede; bloqueio extra caso o Docker habilite no futuro.
  if command -v ip6tables >/dev/null 2>&1; then
    ip6tables -I INPUT 1 -i "$bridge" -j DROP 2>/dev/null || true
    ip6tables -I FORWARD 1 -i "$bridge" -j DROP 2>/dev/null || true
  fi
}

up() {
  local image="${1:?informe a imagem do worker}"
  docker network inspect "$NETWORK" >/dev/null 2>&1 || \
    docker network create --driver bridge --subnet "$SUBNET" \
      --opt com.docker.network.bridge.name=br-frocia-egr "$NETWORK" >/dev/null
  local bridge
  bridge="$(docker network inspect -f '{{index .Options "com.docker.network.bridge.name"}}' "$NETWORK")"
  [ -n "$bridge" ] || bridge="br-$(docker network inspect -f '{{.Id}}' "$NETWORK" | cut -c1-12)"

  apply_firewall "$bridge"

  docker rm -f "$PROXY_NAME" >/dev/null 2>&1 || true
  docker run -d --name "$PROXY_NAME" \
    --read-only --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 128 --memory 256m --cpus 0.5 \
    --user 10001:10001 --entrypoint node \
    "$image" /worker/egress-proxy.mjs >/dev/null
  docker network connect --ip "$PROXY_IP" "$NETWORK" "$PROXY_NAME"

  for _ in $(seq 1 20); do
    if docker exec "$PROXY_NAME" node -e "fetch('http://127.0.0.1:3128/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      echo "Proxy de saida pronto em ${PROXY_URL} (rede ${NETWORK}, ponte ${bridge})."
      iptables -S DOCKER-USER | grep -- "$SUBNET" || true
      return 0
    fi
    sleep 1
  done
  docker logs "$PROXY_NAME" || true
  echo "::error::Proxy de saida nao iniciou."
  return 1
}

case "${1:-}" in
  up) shift; up "$@" ;;
  worker-args) worker_args ;;
  proxy-url) echo "$PROXY_URL" ;;
  logs) docker logs "$PROXY_NAME" 2>&1 | tail -n "${2:-200}" ;;
  *) echo "uso: $0 up <imagem> | worker-args | proxy-url | logs [linhas]" >&2; exit 2 ;;
esac
