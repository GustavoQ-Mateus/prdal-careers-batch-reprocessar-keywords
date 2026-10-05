import type { Prisma, PrismaClient } from '@prisma/client';
import { Pedido, PortaLotes, Resultado } from './lotes';

export interface VagaPendente {
  id: string;
  descricao: string;
}

export interface Repositorio {
  listar(usuarioId?: string, apos?: string): Promise<VagaPendente[]>;
  gravar(id: string, keywords: unknown[]): Promise<void>;
  falhar(id: string, erro: string): Promise<void>;
}

export interface Preparador {
  preparar(vagas: VagaPendente[]): Promise<{ pedidos: Pedido[]; erros: Resultado[] }>;
  interpretar(resultados: Resultado[]): Promise<{ id: string; status: string; keywords: unknown[]; erro?: string | null }[]>;
}

export interface Relatorio {
  total: number;
  reprocessadas: number;
  erros: number;
}

export class PreparadorHttp implements Preparador {
  constructor(private readonly base = process.env.AI_SERVICE_URL || 'http://ai-service:8000', private readonly token = process.env.SERVICE_TOKEN || '', private readonly buscar: typeof fetch = fetch) {
    if (!token) throw new Error('SERVICE_TOKEN obrigatorio');
  }

  private async chamar(caminho: string, corpo: unknown): Promise<Record<string, unknown>> {
    const resposta = await this.buscar(`${this.base}${caminho}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Prdal-Servico': this.token },
      body: JSON.stringify(corpo),
    });
    if (!resposta.ok) throw new Error(`ai-service respondeu ${resposta.status}`);
    return await resposta.json() as Record<string, unknown>;
  }

  async preparar(vagas: VagaPendente[]): Promise<{ pedidos: Pedido[]; erros: Resultado[] }> {
    const resposta = await this.chamar('/keywords/lote/preparar', { vagas });
    return { pedidos: resposta.pedidos as Pedido[], erros: resposta.erros as Resultado[] };
  }

  async interpretar(resultados: Resultado[]): Promise<{ id: string; status: string; keywords: unknown[]; erro?: string | null }[]> {
    const resposta = await this.chamar('/keywords/lote/interpretar', { resultados });
    return resposta.itens as { id: string; status: string; keywords: unknown[]; erro?: string | null }[];
  }
}

export function repositorioPrisma(prisma: PrismaClient): Repositorio {
  return {
    async listar(usuarioId, apos) {
      return prisma.vaga.findMany({
        where: {
          estagio: 'ATIVA',
          ...(usuarioId ? { usuarioId } : {}),
          OR: [{ keywordsStatus: 'PENDENTE' }, { keywordsExtracao: { in: ['PENDENTE', 'ERRO'] } }],
        },
        select: { id: true, descricao: true },
        orderBy: { id: 'asc' },
        take: 100,
        ...(apos ? { cursor: { id: apos }, skip: 1 } : {}),
      });
    },
    async gravar(id, keywords) {
      await prisma.vaga.update({ where: { id }, data: { keywords: keywords as Prisma.InputJsonValue, keywordsStatus: 'VALIDAS', keywordsExtracao: 'PRONTAS', keywordsErro: null } });
    },
    async falhar(id, erro) {
      await prisma.vaga.update({ where: { id }, data: { keywordsStatus: 'PENDENTE', keywordsExtracao: 'ERRO', keywordsErro: erro.slice(0, 500) } });
    },
  };
}

export async function reprocessar(repositorio: Repositorio, preparador: Preparador, lotes: PortaLotes, usuarioId?: string): Promise<Relatorio> {
  const relatorio = { total: 0, reprocessadas: 0, erros: 0 };
  let apos: string | undefined;
  while (true) {
    const parte = await repositorio.listar(usuarioId, apos);
    if (!parte.length) break;
    apos = parte[parte.length - 1].id;
    relatorio.total += parte.length;
    let itens: { id: string; status: string; keywords: unknown[]; erro?: string | null }[];
    try {
      const { pedidos, erros } = await preparador.preparar(parte);
      const resultados = [...erros, ...await lotes.processar(pedidos)];
      itens = await preparador.interpretar(resultados);
    } catch (erro) {
      for (const vaga of parte) {
        await repositorio.falhar(vaga.id, (erro as Error).message);
        relatorio.erros += 1;
      }
      continue;
    }
    const porId = new Map(itens.map((item) => [item.id, item]));
    for (const vaga of parte) {
      const item = porId.get(vaga.id);
      if (item?.status === 'VALIDAS' && item.keywords.length) {
        await repositorio.gravar(vaga.id, item.keywords);
        relatorio.reprocessadas += 1;
      } else {
        await repositorio.falhar(vaga.id, item?.erro || 'resultado ausente');
        relatorio.erros += 1;
      }
    }
  }
  return relatorio;
}
