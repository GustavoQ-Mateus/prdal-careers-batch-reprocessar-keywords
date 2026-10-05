const assert = require('node:assert/strict');
const test = require('node:test');
const { LotesHttp } = require('../dist/lotes');
const { reprocessar } = require('../dist/reprocessar');

const resposta = (corpo) => ({ ok: true, json: async () => corpo, text: async () => corpo });
const pedidos = [{ id: 'v1', params: { model: 'm' } }, { id: 'v2', params: { model: 'm' } }];

test('modo sequencial limita concorrencia e preserva falha por vaga', async () => {
  let ativas = 0;
  let maximo = 0;
  const buscar = async (_url, init) => {
    assert.equal(init.headers.Authorization, 'Bearer chave');
    ativas += 1;
    maximo = Math.max(maximo, ativas);
    const corpo = JSON.parse(init.body);
    await new Promise((resolver) => setTimeout(resolver, 1));
    ativas -= 1;
    if (corpo.model === 'falha') throw new Error('indisponivel');
    return resposta({ stop_reason: 'end_turn', content: [] });
  };
  const lotes = new LotesHttp('sequencial', 'https://openrouter.ai/api', 'chave', buscar, 1);
  const resultados = await lotes.processar([{ id: 'v1', params: { model: 'ok' } }, { id: 'v2', params: { model: 'falha' } }]);
  assert.equal(maximo, 1);
  assert.equal(resultados[0].id, 'v1');
  assert.equal(resultados[1].erro, 'indisponivel');
});

test('modo anthropic cria lote, consulta e le resultados simulados', async () => {
  const chamadas = [];
  const buscar = async (url, init) => {
    chamadas.push([String(url), init?.method]);
    assert.equal(init.headers['x-api-key'], 'chave');
    if (String(url).endsWith('/batches') && init?.method === 'POST') return resposta({ id: 'b1', processing_status: 'in_progress' });
    if (String(url).endsWith('/batches/b1')) return resposta({ id: 'b1', processing_status: 'ended', results_url: 'https://api.anthropic.com/resultados' });
    return resposta(pedidos.map((pedido) => JSON.stringify({ custom_id: pedido.id, result: { type: 'succeeded', message: { stop_reason: 'end_turn' } } })).join('\n'));
  };
  const lotes = new LotesHttp('anthropic', 'https://api.anthropic.com', 'chave', buscar, 2, async () => {});
  const resultados = await lotes.processar(pedidos);
  assert.deepEqual(resultados.map((item) => item.id), ['v1', 'v2']);
  assert.equal(chamadas.length, 3);
  assert.throws(() => new LotesHttp('anthropic', 'https://openrouter.ai/api', 'chave', buscar));
});

test('reprocessamento grava acertos e erros por vaga', async () => {
  const gravadas = [];
  const erros = [];
  const repo = { listar: async (_usuario, apos) => apos ? [] : [{ id: 'v1' }, { id: 'v2' }], gravar: async (id) => gravadas.push(id), falhar: async (id) => erros.push(id) };
  const preparador = { preparar: async () => ({ pedidos, erros: [] }), interpretar: async () => [{ id: 'v1', status: 'VALIDAS', keywords: [{ termo: 'TS' }] }, { id: 'v2', status: 'PENDENTE', keywords: [], erro: 'falha' }] };
  assert.deepEqual(await reprocessar(repo, preparador, { processar: async () => [] }), { total: 2, reprocessadas: 1, erros: 1 });
  assert.deepEqual(gravadas, ['v1']);
  assert.deepEqual(erros, ['v2']);
});
