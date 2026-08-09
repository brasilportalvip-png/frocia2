# Modelagem de Dados e Esquema do Firestore

Abaixo estão descritas as coleções e subcoleções do banco de dados no Firestore para a Froc.IA:

## Coleção `users`
**Caminho:** `users/{userId}`

```json
{
  "uid": "usr-88920",
  "email": "carlos.silva@froc.ia",
  "displayName": "Carlos Silva",
  "role": "admin",
  "creditsRemaining": 450,
  "createdAt": "2026-08-01T10:00:00.000Z",
  "updatedAt": "2026-08-05T13:40:00.000Z"
}
```

## Subcoleção `sites` (Projetos do Usuário)
**Caminho:** `users/{userId}/sites/{siteId}`

```json
{
  "id": "site-9910",
  "title": "Landing Page SaaS Froc.IA",
  "prompt": "Crie um site moderno roxo e dourado",
  "category": "Landing Page SaaS",
  "colorPalette": "Cyber Purple & Gold",
  "tone": "Profissional",
  "html": "<!DOCTYPE html>...",
  "isFavorite": true,
  "createdAt": 1785930000000,
  "updatedAt": 1785930200000
}
```

## Coleção `credit_transactions` (Histórico de Créditos & Transações)
**Caminho:** `credit_transactions/{txId}`

```json
{
  "id": "tx-10023",
  "userId": "usr-88920",
  "type": "CONSUMPTION",
  "amount": 2,
  "operation": "Geração de Site IA",
  "idempotencyKey": "idem-9988221",
  "timestamp": "2026-08-05T13:40:12.000Z"
}
```

## Coleção `audit_logs` (Registro Administrativo)
**Caminho:** `audit_logs/{logId}`

```json
{
  "id": "audit-178593021",
  "performedBy": "admin@froc.ia",
  "action": "GRANT_CREDITS",
  "targetUser": "cliente@exemplo.com",
  "details": { "amount": 250 },
  "timestamp": "2026-08-05T13:50:00.000Z"
}
```
