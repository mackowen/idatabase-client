# Persistência interna — Campanha 0004

`@idb/persistence` é o único ponto de acesso ao SQLite interno do aplicativo. Não depende do workspace `packages/database-adapters/sqlite` (SQLite externo) nem exporta `DatabaseSync`, SQL, connection handles ou paths pela API pública.

## Driver e runtime

Usa o módulo embutido `node:sqlite` do Node. Não há dependência npm nem addon nativo adicional. `DatabaseSync` executa sincronicamente; transações aceitam callbacks síncronos e a fila única serializa todas as escritas. Operações devem permanecer pequenas e limitadas; uma chamada SQLite longa bloqueia o event loop. A API Node está em Release Candidate e precisa ser revalidada após upgrade de Node.

## Armazenamento

Por padrão usa `$HOME/.local/share/idatabase-client/idatabase.sqlite`. `IDB_DATA_DIR` ou `openInternalStore({ dataDirectory })` aceita apenas caminho absoluto para testes/host. Diretório privado `0700`, arquivo DB `0600`; paths com componente symlink ou arquivo não regular são recusados. O DB não fica relativo ao cwd. WAL sidecars ficam dentro do diretório privado.

## API pequena

- `openInternalStore()` cria/abre, valida versão e integridade, configura PRAGMAs, aplica migrations conhecidas e registra o início.
- `getState()`/`getStatus()` consultam estado mínimo não sensível; `checkIntegrity()` valida `integrity_check`, `foreign_key_check`, WAL e foreign keys efetivas.
- `recordStartup()` e `writeTransaction()` passam pelo coordenador serial único. A transação pública só recebe operações de domínio tipadas; nenhum SQL arbitrário.
- `checkpoint()` executa checkpoint WAL PASSIVE pela fila. `close()` para novas escritas, espera operações já aceitas, tenta checkpoint e fecha.
- Migrações incrementais guardam version/id/checksum e `applied_at`; falha transacional é revertida. Schema futuro/desconhecido ou checksum alterado causa erro tipado sem reset/recreate.

Não armazenar credenciais aqui. Não usar esta camada para bancos SQLite externos. Nenhum dado real é incluído nos testes.
