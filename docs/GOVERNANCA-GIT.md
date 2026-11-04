# Governança Git e publicação de campanhas

Esta política é normativa e permanente para todas as campanhas do iDataBase Client Avançado. Deve ser consultada pelo Codex antes de iniciar ou fechar qualquer campanha. As instruções locais em `AGENTS.md` obrigam prompts futuros executados dentro deste projeto a seguir esta política.

## Repositórios oficiais

- Código: `https://github.com/mackowen/idatabase-client`
- Histórico: `https://github.com/mackowen/idatabase-client-historico`

## Rotina obrigatória de fechamento

1. Concluir a implementação e as validações previstas para a campanha; registrar resultados reais, inclusive limitações.
2. Atualizar registros, resumos, matrizes, auditorias, checkpoints e evidências aplicáveis. A obrigação vale também para campanhas PARTIAL, FAIL ou BLOCKED quando houver registros a preservar.
3. Verificar branch, HEAD, worktree, remotos e estado do remoto histórico antes de sincronizar. Confirmar identidade do repositório e revisar o diff/conteúdo para excluir segredos, tokens, senhas, dados pessoais e evidências sensíveis.
4. Fazer commit local das atualizações no repositório de histórico. Preservar todos os commits locais e remotos.
5. Integrar e publicar somente após confirmar que a atualização é segura e não descarta commits. Nunca usar `git push --force`, reescrever histórico ou descartar commits.
6. Fazer push para `mackowen/idatabase-client-historico`; nunca fazer push automático do repositório de código.
7. Verificar diretamente no GitHub que o SHA remoto publicado corresponde ao HEAD local esperado.
8. Registrar no relatório final branch, HEAD, commit e link direto do commit publicado.

## Bloqueios

Se o remoto tiver commits não previstos, houver divergência/conflito, identidade inesperada, falha de autenticação ou risco de publicar dados sensíveis, interromper a publicação. Preservar o estado local/remoto, não contornar o bloqueio por meio de outro destino ou credencial não autorizada e reportar BLOCKED/PARTIAL com evidência sanitizada. Uma publicação só pode ser declarada concluída após verificação remota do SHA.

## Política do repositório de código

O repositório `idatabase-client` pode receber commits locais quando autorizados pela campanha, mas nunca deve ser publicado automaticamente. A política de publicação recorrente aplica-se exclusivamente ao repositório oficial de histórico.
