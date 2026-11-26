# Decisão: sandbox do Code Mode (XMCM-19)

**Decisão: `isolated-vm` (isolate V8 no mesmo processo, sem Node dentro).**
Estado: protótipo feito e a passar 35 testes de segurança; decidido antes do meio-dia de segunda, sem ativar o plano B.

## Opções

| | `node:vm` | `isolated-vm` | Processo filho sem rede |
| --- | --- | --- | --- |
| Isolamento | **Nenhum.** Um `this.constructor.constructor("return process")()` chega ao host. A documentação do Node diz que não é um mecanismo de segurança | Heap e contexto V8 próprios; não existem `process`, `require`, `fetch`, timers | Isolamento do sistema operativo, se bem configurado |
| Tempo limite | Só para código síncrono | Síncrono (`timeout`) + relógio de parede para o assíncrono | Matar o processo |
| Limite de memória | Não | Sim (`memoryLimit`), medido: termina e o host sobrevive | Depende de cgroups/`ulimit`; frágil no macOS/Windows |
| Chamar a API xray | Direto (perigoso) | Uma `Reference` por onde só passa JSON | IPC (serialização, mais código) |
| Arranque | ~0 | **2,6 ms** por execução (medido) | 40–80 ms por execução (Node novo) |
| Rede/ficheiros | Têm de ser removidos à mão | Não existem de origem | Têm de ser bloqueados com permissões (`--permission`) ou sandbox do SO |
| Dependência | Nenhuma | Módulo nativo (prebuilds para Node 22+; senão compila com node-gyp) | Nenhuma |

`node:vm` está fora por segurança. Do processo filho não fiz protótipo: o `isolated-vm`
cumpriu todos os critérios à primeira, por isso comparei-o só no papel (arranque e limites de
memória são estimativas, não medições). Fica como alternativa se o módulo nativo der problemas
numa máquina da equipa.

## Medições (Node 22.23, linux x64)

- 500 chamadas à API em paralelo (cada uma com 50 ms de espera): **55 ms** no total.
- 2000 chamadas em série: **105 ms**.
- `while (true) {}` com limite de 500 ms: terminado aos 502 ms.
- Memória a crescer sem fim com limite de 32 MB: terminado em 58 ms; o processo host continua a servir.

O cenário A são 1 chamada `execute` com ~25 chamadas à API; a sandbox não é o gargalo,
a rede para o Xray é.

## Como a fronteira funciona

- Dentro do isolate só há JavaScript base, um `console` capturado e o objeto `xray` (congelado).
- Cada função de `xray` chama uma única `Reference` do host com `(nome, argumentoJSON)` e
  devolve JSON em texto. Nenhum objeto, função ou protótipo do host atravessa.
- O host só aceita nomes presentes na lista de funções (`Object.hasOwn`), nunca nomes herdados.
- Tempo limite de parede de 120 s; passado esse tempo ou depois de qualquer erro, o isolate é
  destruído **e o host recusa novas chamadas à API**, para o código abandonado não continuar a escrever.
- Resultado limitado a 200 000 caracteres; console a 200 linhas.

## Riscos aceites

- **Módulo nativo.** Se a instalação falhar, `npm i` mostra o erro do node-gyp. Plano: processo
  filho (esta decisão revê-se) ou ferramentas clássicas (XMCM-27).
- **Mesmo processo.** Uma vulnerabilidade do V8 podia sair do isolate. Mitigações: só corre código
  gerado pelo nosso assistente, só ambientes de teste, sem segredos acessíveis no isolate, versões fixas e `npm audit`.
  Para código de terceiros não confiáveis seria preciso um processo/contentor à parte.
