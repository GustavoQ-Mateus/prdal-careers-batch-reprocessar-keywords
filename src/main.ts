import { PrismaClient } from '@prisma/client';
import { writeFile } from 'node:fs/promises';
import { LotesHttp } from './lotes';
import { PreparadorHttp, reprocessar, repositorioPrisma } from './reprocessar';

async function executar() {
  const indice = process.argv.indexOf('--usuario-id');
  const usuarioId = indice >= 0 ? process.argv[indice + 1] : undefined;
  if (indice >= 0 && !usuarioId) throw new Error('--usuario-id exige um valor');
  const prisma = new PrismaClient();
  try {
    const relatorio = await reprocessar(repositorioPrisma(prisma), new PreparadorHttp(), new LotesHttp(), usuarioId);
    const texto = JSON.stringify(relatorio, null, 2);
    process.stdout.write(`${texto}\n`);
    if (process.env.RELATORIO_ARQUIVO) await writeFile(process.env.RELATORIO_ARQUIVO, texto);
    process.exitCode = relatorio.erros ? 2 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) executar().catch((erro) => {
  process.stderr.write(`${JSON.stringify({ nivel: 'error', servico: 'reprocessar-keywords', mensagem: (erro as Error).message })}\n`);
  process.exitCode = 1;
});
