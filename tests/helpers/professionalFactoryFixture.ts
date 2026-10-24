import { CREATION_AGENTS } from "../../shared/advancedAgentCatalog.js";
import { parseBundle } from "../../server/siteFactory/professionalContract.js";
export function fixtureBundle() {
  return parseBundle(
    JSON.stringify({
      title: "Calculadora de serviços",
      description: "Orçamento funcional com cálculo de serviços.",
      productType: "website",
      files: [
        {
          path: "index.html",
          content:
            '<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Calcule o orçamento do serviço"><title>Calculadora de serviços</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>',
        },
        {
          path: "src/main.tsx",
          content: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {total} from './pricing';function App(){const [quantity,setQuantity]=useState(1);return <main style={{maxWidth:700,margin:'auto',padding:24,fontFamily:'system-ui'}}><h1>Calculadora de serviços</h1><label>Quantidade<input type="number" min="1" value={quantity} onChange={e=>setQuantity(Number(e.target.value))}/></label><p data-testid="total">Total: {total(quantity)}</p><nav><a href="/legal/privacy.html">Privacidade</a> · <a href="/legal/terms.html">Termos</a> · <a href="/legal/cookies.html">Cookies</a></nav></main>}window.FrocConfigReady.then(()=>createRoot(document.getElementById('root')!).render(<App/>));`,
        },
        {
          path: "src/pricing.ts",
          content:
            'export function total(quantity:number){if(!Number.isSafeInteger(quantity)||quantity<1)throw new Error("Quantidade inválida");return quantity*50;}',
        },
        {
          path: "tests/pricing.test.ts",
          content:
            'import {expect,it} from "vitest";import {total} from "../src/pricing";it("calcula o orçamento",()=>{expect(total(2)).toBe(100)});it("recusa quantidades inválidas",()=>{expect(()=>total(-1)).toThrow();expect(()=>total(1.2)).toThrow()});',
        },
      ],
      publicPages: ["/"],
      variables: [],
      requirements: [
        {
          id: "quote",
          description: "Calcular o orçamento conforme a quantidade informada.",
          files: ["src/main.tsx", "src/pricing.ts"],
          journeyIds: ["quote-total"],
        },
      ],
      journeys: [
        {
          id: "quote-total",
          name: "Alterar quantidade e verificar orçamento",
          path: "/",
          environment: "both",
          authenticated: false,
          steps: [
            { action: "fill", by: "label", locator: "Quantidade", value: "2" },
            {
              action: "expect-text",
              by: "testid",
              locator: "total",
              value: "100",
            },
          ],
        },
      ],
      integrations: [],
      payments: { required: false, provider: "none", currency: "BRL" },
      legal: {
        privacy:
          "Este projeto permite calcular orçamentos sem criar uma conta ou armazenar os valores do cálculo no servidor. O contato informado pelo responsável pode ser usado para solicitar esclarecimentos sobre o tratamento de dados. Os registros técnicos do provedor de hospedagem devem ser mantidos apenas pelo prazo necessário para segurança e operação.",
        terms:
          "O orçamento calculado informa a relação entre quantidade e preço do serviço e não formaliza uma contratação. O responsável deve informar as condições comerciais reais antes de aceitar um pedido. O usuário deve utilizar o serviço conforme sua finalidade e poderá entrar em contato pelo canal publicado para esclarecer dúvidas ou solicitar suporte.",
        cookies:
          "O projeto utiliza armazenamento local para preservar a escolha de consentimento. Cookies e scripts opcionais de análise ou marketing somente podem ser carregados após autorização. A escolha pode ser alterada pelo botão Cookies disponível na página.",
      },
    }),
  );
}
export function stageReport(stage: string) {
  return {
    contributions: CREATION_AGENTS.filter((a) => a.stage === stage).map(
      (a) => ({
        agentId: a.id,
        decisions: [
          "Implementar o orçamento com validação de quantidade e os critérios de " +
            a.name,
        ],
        tests: ["Validar o fluxo de cálculo e o erro de quantidade inválida."],
      }),
    ),
  };
}
