import { describe, expect, it } from 'vitest';
import { validateGeneratedSiteFunctionality } from '../server/siteFactory/generatedSiteFunctionalGate.js';

const agendaPrompt = 'Cadastro e busca de pacientes, agendamento com status agendada, concluída e cancelada, tema claro e escuro, responsivo no celular. Os dados devem permanecer após atualizar.';

describe('gate funcional dos projetos gerados', () => {
  it('reprova a maquete estática que causou a falha em produção', () => {
    const result = validateGeneratedSiteFunctionality(
      agendaPrompt,
      '<!doctype html><html><head></head><body><button>Novo Agendamento</button><p>Ação realizada com sucesso!</p></body></html>'
    );

    expect(result.passed).toBe(false);
    expect(result.issues.join(' ')).toMatch(/JavaScript real/);
    expect(result.issues.join(' ')).toMatch(/localStorage/);
    expect(result.issues.join(' ')).toMatch(/busca funcional/);
  });

  it('aprova uma aplicação autônoma com interação, persistência, busca, tema e responsividade', () => {
    const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width"><style>@media(max-width:600px){main{display:block}}</style></head><body>
      <button id="theme">Tema escuro</button><input type="search" id="buscar"><form id="agenda"><input required><button>Agendar</button></form>
      <select><option>Agendada</option><option>Concluída</option><option>Cancelada</option></select>
      <script>const data=JSON.parse(localStorage.getItem('data')||'[]'); document.body.dataset.theme=localStorage.getItem('theme')||'light';
      theme.addEventListener('click',()=>document.body.classList.toggle('dark')); buscar.addEventListener('input',()=>data.filter(x=>x.includes(buscar.value)));
      agenda.addEventListener('submit',e=>{e.preventDefault();localStorage.setItem('data',JSON.stringify(data));});</script></body></html>`;

    expect(validateGeneratedSiteFunctionality(agendaPrompt, html)).toEqual({
      passed: true,
      issues: [],
    });
  });
});
