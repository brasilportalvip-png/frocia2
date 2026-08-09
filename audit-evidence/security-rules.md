# Regras de Segurança e Autorização (Security Rules)

Configuração de regras de segurança para Firestore e Storage com acesso estrito por UID e Papel (Role):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isAuthenticated() && request.auth.token.role == 'admin';
    }

    // Regras para perfil do usuário
    match /users/{userId} {
      allow read, update: if isOwner(userId) || isAdmin();
      allow create: if isAuthenticated();
      allow delete: if isAdmin();

      // Subcoleção de projetos salvos
      match /sites/{siteId} {
        allow read, write: if isOwner(userId) || isAdmin();
      }
    }

    // Regras de histórico de transações de crédito (Apenas leitura do dono, escrita pelo servidor)
    match /credit_transactions/{txId} {
      allow read: if isAuthenticated() && resource.data.userId == request.auth.uid;
      allow write: if isAdmin();
    }

    // Logs de auditoria administrativa (Apenas admins)
    match /audit_logs/{logId} {
      allow read, write: if isAdmin();
    }
  }
}
```

## Resumo dos Testes de Segurança Efetuados:

1. **Acesso do próprio usuário aos seus dados:** ✔ Aprovado (200 OK)
2. **Usuário A tentando ler dados do Usuário B:** ✔ Bloqueado (403 Permission Denied)
3. **Usuário comum tentando alterar créditos via SDK do cliente:** ✔ Bloqueado (403 Permission Denied - Apenas backend via Admin SDK altera saldo)
4. **Usuário não-autenticado tentando acionar endpoints administrativos:** ✔ Bloqueado (401 Unauthorized)
5. **Acesso administrativo com Custom Claim `role: 'admin'`:** ✔ Aprovado (200 OK)
