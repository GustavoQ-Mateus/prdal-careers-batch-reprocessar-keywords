# reprocessar-keywords

Job de reprocessamento de keywords por lotes ou pelo serviço de IA. Implementa a `spec-v1.11.0`.

## Instalação, testes e execução

Execute na raiz desta unidade. Não são necessários arquivos do monorepo. Requer Node.js 22 e Git para instalar os contratos quando aplicável.

```text
npm ci
npm test
npm run build
npm start
```

Defina DATABASE_URL para um banco migrado pela API. LOTES_MODO=sequencial usa AI_SERVICE_URL e SERVICE_TOKEN; o modo de lotes usa ANTHROPIC_API_KEY e ANTHROPIC_BASE_URL. Os testes usam clientes falsos e não chamam o modelo.

## Imagem

```text
docker build -t prdal-reprocessar-keywords .
```

O contexto é somente esta pasta. A imagem final executa sem root e não inclui dependências de desenvolvimento nem configurações de agentes. Injete as variáveis com --env-file em um arquivo local fora do controle de versão.

## Variáveis de ambiente

As variáveis opcionais usam os padrões definidos no código; configure explicitamente os destinos de banco e serviços no seu ambiente.

`AI_SERVICE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_SESSION_TOKEN`, `DATABASE_URL`, `LOTES_CONCORRENCIA`, `LOTES_MODO`, `RELATORIO_ARQUIVO`, `SERVICE_TOKEN`.
