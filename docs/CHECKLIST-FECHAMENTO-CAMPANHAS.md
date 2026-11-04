# Checklist obrigatório de fechamento de campanhas

Aplicar em todas as campanhas, inclusive PARTIAL, FAIL e BLOCKED quando houver registros/evidências a preservar. Não marcar publicação como concluída sem conferir o GitHub.

- [ ] Implementação e validações previstas concluídas; resultados reais e limitações registrados.
- [ ] Registros, resumo, matrizes, auditoria, checkpoints e evidências aplicáveis atualizados.
- [ ] Revisão de diff e de conteúdo concluída; nenhum segredo, dado pessoal desnecessário ou evidência sensível incluído.
- [ ] Branch, HEAD, worktree, remotos e identidade do remoto oficial conferidos.
- [ ] Estado do remoto histórico verificado; divergências e commits desconhecidos preservados, sem sobrescrita.
- [ ] Commit local criado no repositório de histórico.
- [ ] Push normal somente para `mackowen/idatabase-client-historico`; nunca publicar o repositório de código.
- [ ] SHA remoto conferido no GitHub e igual ao HEAD local publicado.
- [ ] Relatório registra resultado, branch, SHA local/remoto, link direto do commit e eventuais bloqueios.

Se autenticação falhar ou qualquer verificação não puder ser comprovada, interromper a publicação e reportar BLOCKED/PARTIAL. Nunca usar force push nem reescrever/apagar histórico.
