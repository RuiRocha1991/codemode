# Demonstração: cenários A e B em local e staging (XMCM-30)

Duração: ~10 min. Quem: Rui (dono).

## Antes (5 min)
- [ ] `npm ci && npm run build`; `npm run check` verde
- [ ] `XRAY_ENV=local npm run introspect` → contrato confirmado
- [ ] `claude mcp list` mostra `xray-local` e `xray-staging` ligados
- [ ] Projeto DEMO com ≥ 200 testes e as versões v1.0, v1.1, v2.0 no Jira
- [ ] Limpar de demos anteriores: «chama xray.cleanup em DEMO»

## Guião
1. **Ambiente** — «Em que ambiente estás?» → `local`. (Mostra que cada instância está presa ao seu ambiente.)
2. **O problema** — mostrar uma pasta/plano criados à mão e quanto custa montar 200 testes assim.
3. **Cenário A em local** — pedir em linguagem natural; apontar que é **uma** chamada `execute` (e as `apiCalls`).
   Abrir o Xray e ver a árvore. Pedir a verificação.
4. **Cenário B em local** — idem; abrir um Test Plan e a pasta `/…/v1.0/Cucumber`.
5. **Staging** — repetir A e B em `xray-staging` (mesmo código, outro ambiente).
6. **Limpeza** — «apaga os dados de teste»: `xray.cleanup` (primeiro `dryRun: true`). Mostrar o projeto como estava.
7. **Segurança** — pedir que o código leia `process.env`: falha. Mostrar que produção não arranca (`XRAY_ENV=prod-us`).

## Registo
| Data | Ambiente | Cenário | 1 execute? | Duração | Verificação | Problemas |
| --- | --- | --- | --- | --- | --- | --- |
| | | | | | | |

Dono: Rui Rocha — _confirmar na demonstração_.
