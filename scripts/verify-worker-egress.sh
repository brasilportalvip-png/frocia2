#!/usr/bin/env bash
# Prova que o worker so alcanca a internet pelo proxy e so para destinos liberados.
# Uso: bash scripts/verify-worker-egress.sh <container-do-worker>
set -uo pipefail

CONTAINER="${1:?informe o container do worker}"
failures=0

# fetch dentro do container como usuario da sandbox; sai 0 se houve resposta HTTP.
probe() {
  local mode="$1" url="$2" timeout_ms="${3:-10000}"
  local env_args=()
  if [ "$mode" = direct ]; then
    env_args=(-e NODE_USE_ENV_PROXY=0 -e HTTPS_PROXY= -e https_proxy= -e HTTP_PROXY= -e http_proxy=)
  fi
  docker exec "${env_args[@]}" --user 10001:10001 "$CONTAINER" node -e "
    fetch('${url}', { signal: AbortSignal.timeout(${timeout_ms}) })
      .then(r => { console.log('  resposta HTTP', r.status); process.exit(0); })
      .catch(e => { console.log('  sem conexao:', e.cause?.code || e.cause?.message || e.name); process.exit(1); })"
}

expect_ok() {
  echo "Deve conectar ($1): $2"
  if probe "$1" "$2"; then echo "  OK"; else echo "::error::Destino liberado inacessivel: $2"; failures=$((failures + 1)); fi
}

expect_blocked() {
  echo "Deve bloquear ($1): $2"
  if probe "$1" "$2" 8000; then echo "::error::FALHA: worker conseguiu acessar destino nao autorizado ($1): $2"; failures=$((failures + 1)); else echo "  OK, bloqueado"; fi
}

echo "== Saida permitida pelo proxy =="
expect_ok proxy https://generativelanguage.googleapis.com
expect_ok proxy https://registry.npmjs.org/

echo "== Destinos fora da allowlist =="
expect_blocked proxy https://example.com
expect_blocked proxy http://example.com
expect_blocked proxy https://1.1.1.1

echo "== Conexao direta, sem proxy (firewall) =="
expect_blocked direct https://generativelanguage.googleapis.com
expect_blocked direct https://example.com
expect_blocked direct https://1.1.1.1
expect_blocked direct http://169.254.169.254/

if [ "$failures" -ne 0 ]; then
  echo "FALHA: isolamento de rede do worker incorreto (${failures} verificacao(oes))."
  exit 1
fi
echo "Isolamento de rede do worker confirmado."
