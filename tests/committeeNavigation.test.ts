import { describe, expect, it } from 'vitest';
import { committeeLink, committeeNavigation } from '../src/services/committeeNavigation';
import { parseCommitteeInspection } from '../src/services/committeeInspection';

const id = 'owner-96548e7d19050d972007afd5654febc4';
describe('Acesso direto ao comitê', () => {
  it('abre a tarefa indicada sem perder outros parâmetros do site', () => {
    const url = committeeLink('https://frocia2.vercel.app/?lang=pt', id);
    expect(committeeNavigation(url)).toEqual({ openAdmin: true, candidateId: id });
    expect(new URL(url).searchParams.get('lang')).toBe('pt');
    expect(committeeNavigation(committeeLink(url))).toEqual({ openAdmin: true, candidateId: null });
  });
  it('não interpreta um parâmetro isolado ou um caminho inválido como tarefa', () => {
    expect(committeeNavigation('https://frocia2.vercel.app/?committee=' + id)).toEqual({ openAdmin: false, candidateId: null });
    expect(committeeNavigation('https://frocia2.vercel.app/?view=admin&tab=selfEvolution&committee=../other').candidateId).toBeNull();
    expect(() => committeeLink('https://frocia2.vercel.app/', '../other')).toThrow('inválido');
  });
  it('rejeita resposta HTML ou JSON sem decisão em vez de quebrar a tela', () => {
    for (const payload of ['<html>login</html>', {}, { reviews: [], gate: null }]) {
      expect(() => parseCommitteeInspection(payload)).toThrow('comitê inválido');
    }
  });
  it('tolera referências ausentes de parecer histórico sem esconder seu veto', () => {
    const result = parseCommitteeInspection({ commitSha: 'a'.repeat(40), gate: { status: 'blocked', approved: false, reason: 'Teste ausente.' },
      reviews: [{ id: 'old', role: 'qa', summary: 'Necessário teste de regressão.', verdict: 'changes_required', fileRefs: null }] });
    expect(result.reviews[0]).toMatchObject({ verdict: 'changes_required', fileRefs: [], evidenceRefs: [] });
    expect(result.gate.approved).toBe(false);
  });
  it('não transforma parecer malformado em aprovação', () => {
    expect(() => parseCommitteeInspection({ gate: { status: 'approved', approved: true, reason: 'ok' },
      reviews: [{ role: 'qa', summary: 'Sem veredito.' }] })).toThrow('parecer incompleto');
  });
});
