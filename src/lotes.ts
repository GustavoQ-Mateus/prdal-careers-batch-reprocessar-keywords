export interface Pedido {
  id: string;
  params: Record<string, unknown>;
}

export interface Resultado {
  id: string;
  resposta?: Record<string, unknown>;
  erro?: string;
}

export interface PortaLotes {
  processar(pedidos: Pedido[]): Promise<Resultado[]>;
}

type Buscar = typeof fetch;

export class LotesHttp implements PortaLotes {
  constructor(
    private readonly modo: 'sequencial' | 'anthropic' = process.env.LOTES_MODO === 'anthropic' ? 'anthropic' : 'sequencial',
    private readonly base = process.env.ANTHROPIC_BASE_URL || 'https://openrouter.ai/api',
    private readonly chave = process.env.ANTHROPIC_API_KEY || '',
    private readonly buscar: Buscar = fetch,
    private readonly concorrencia = Number(process.env.LOTES_CONCORRENCIA || 3),
    private readonly esperar: (ms: number) => Promise<void> = (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  ) {
    if (!chave) throw new Error('ANTHROPIC_API_KEY obrigatoria');
    if (modo === 'anthropic' && new URL(base).origin !== 'https://api.anthropic.com') throw new Error('lotes exigem base direta da Anthropic');
    if (!Number.isInteger(concorrencia) || concorrencia < 1 || concorrencia > 20) throw new Error('LOTES_CONCORRENCIA invalida');
  }

  private async pedir(caminho: string, init?: RequestInit): Promise<Response> {
    const credencial: Record<string, string> = new URL(this.base).origin === 'https://api.anthropic.com'
      ? { 'x-api-key': this.chave, 'anthropic-version': '2023-06-01' }
      : { Authorization: `Bearer ${this.chave}` };
    const resposta = await this.buscar(`${this.base.replace(/\/$/, '')}${caminho}`, {
      ...init,
      headers: { ...credencial, 'content-type': 'application/json' },
    });
    if (!resposta.ok) throw new Error(`provedor respondeu ${resposta.status}`);
    return resposta;
  }

  async processar(pedidos: Pedido[]): Promise<Resultado[]> {
    if (this.modo === 'anthropic') return this.processarLote(pedidos);
    const resultados: Resultado[] = new Array(pedidos.length);
    let proximo = 0;
    await Promise.all(Array.from({ length: Math.min(this.concorrencia, pedidos.length) }, async () => {
      while (proximo < pedidos.length) {
        const indice = proximo++;
        const pedido = pedidos[indice];
        try {
          const resposta = await this.pedir('/v1/messages', { method: 'POST', body: JSON.stringify(pedido.params) });
          resultados[indice] = { id: pedido.id, resposta: await resposta.json() as Record<string, unknown> };
        } catch (erro) {
          resultados[indice] = { id: pedido.id, erro: (erro as Error).message };
        }
      }
    }));
    return resultados;
  }

  private async processarLote(pedidos: Pedido[]): Promise<Resultado[]> {
    if (!pedidos.length) return [];
    const criado = await this.pedir('/v1/messages/batches', {
      method: 'POST',
      body: JSON.stringify({ requests: pedidos.map((pedido) => ({ custom_id: pedido.id, params: pedido.params })) }),
    });
    let lote = await criado.json() as { id: string; processing_status: string; results_url?: string };
    for (let tentativa = 0; lote.processing_status !== 'ended'; tentativa += 1) {
      if (tentativa >= 17460) throw new Error('lote nao terminou no prazo');
      await this.esperar(5000);
      const consulta = await this.pedir(`/v1/messages/batches/${encodeURIComponent(lote.id)}`);
      lote = await consulta.json() as typeof lote;
    }
    if (!lote.results_url) throw new Error('lote sem resultados');
    const url = new URL(lote.results_url);
    if (url.origin !== new URL(this.base).origin) throw new Error('url de resultados fora da Anthropic');
    const resposta = await this.buscar(url, { headers: { 'x-api-key': this.chave, 'anthropic-version': '2023-06-01' } });
    if (!resposta.ok) throw new Error(`resultados responderam ${resposta.status}`);
    const porId = new Map<string, Resultado>();
    for (const linha of (await resposta.text()).split('\n').filter(Boolean)) {
      const item = JSON.parse(linha) as { custom_id: string; result: { type: string; message?: Record<string, unknown>; error?: { message?: string } } };
      porId.set(item.custom_id, item.result.type === 'succeeded'
        ? { id: item.custom_id, resposta: item.result.message }
        : { id: item.custom_id, erro: item.result.error?.message || item.result.type });
    }
    return pedidos.map((pedido) => porId.get(pedido.id) || { id: pedido.id, erro: 'resultado ausente' });
  }
}
