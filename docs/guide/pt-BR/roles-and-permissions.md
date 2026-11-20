---
title: Cargos e permissões
section: Administrando um servidor
summary: Dê cargos às pessoas, decida quem pode fazer o quê e torne canais privados.
source: 1d7dad25cdb6
---

**Cargos** são rótulos que você dá aos membros, como *Moderador*, *Artista* ou *Novato*. Cada cargo vem com **permissões** que decidem o que os membros dele podem fazer. Um cargo também pode ter uma cor e um ícone mostrados ao lado do nome das pessoas.

Todos no servidor têm automaticamente o cargo **@everyone**. As permissões dele são o que todo mundo pode fazer.

![A página Cargos nas Configurações do servidor](shot:roles)

## Criando um cargo

1. Abra **Configurações do servidor → Cargos** e clique em **Criar cargo**.
2. Dê um nome e uma cor. Se quiser:
   - dê um **Ícone do cargo** (um emoji ou uma imagem pequena)
   - **Exibir membros do cargo separadamente dos membros online** na lista de membros
   - **Permitir que qualquer pessoa @mencione este cargo**
   - **Permitir que os membros escolham este cargo**
3. Ative as permissões que ele deve ter.
4. Adicione pessoas na aba **Membros**, ou clique com o botão direito em alguém na lista de membros e escolha os cargos.

**Duplicar cargo** copia um cargo, o que ajuda a criar um parecido.

## Qual cargo vale mais

Os cargos ficam listados em ordem, e os que estão mais acima têm prioridade sobre os de baixo. Arraste-os, ou use **Mover para cima** e **Mover para baixo**.

- As pessoas só podem gerenciar cargos abaixo do cargo mais alto delas.
- Quando os cargos discordam sobre uma cor, vale a cor do cargo mais alto.

**Ver servidor como cargo** mostra exatamente o que um membro com aquele cargo vê, para você conferir sua configuração.

## Permissões

As permissões são agrupadas em Geral, Associação, Texto, Voz e Estúdio. Algumas das mais importantes:

| Permissão | Permite que as pessoas… |
|---|---|
| **Administrador** | Façam tudo e ignorem todas as restrições de canal. Dê com cuidado. |
| **Gerenciar servidor** | Mudem o nome, o ícone e as configurações do servidor. |
| **Gerenciar cargos** | Criem e atribuam cargos abaixo do seu. |
| **Gerenciar canais** | Criem, editem e excluam canais. |
| **Expulsar membros / Banir membros / Aplicar castigo em membros** | Moderem pessoas. Veja [Moderação](moderation). |
| **Gerenciar mensagens** | Excluam e fixem mensagens de qualquer pessoa. |
| **Mencionar @everyone** | Chamem o servidor inteiro. |
| **Criar convite** | Convidem pessoas novas. |
| **Gerenciar expressões** | Adicionem emojis, figurinhas e sons. |
| **Gerenciar eventos** | Agendem eventos. |
| **Ver registro de auditoria** | Vejam quem mudou o quê. |

> Tip: Comece com o **@everyone** podendo ler e conversar. Depois adicione um cargo de *Moderador* com Expulsar, Aplicar castigo e Gerenciar mensagens. Pouca gente precisa de Administrador.

## Permissões do canal

Para tornar um canal privado, ou mudar o que as pessoas podem fazer em um canal:

1. Clique com o botão direito no canal, escolha **Editar canal** e depois **Permissões**.
2. Ative **Canal privado** para ocultá-lo de todos, menos dos cargos e das pessoas que você adicionar.
3. Ou use **Adicionar cargo ou membro** e defina cada permissão como **Permitir** (✓), **Negar** (✗) ou **Herdar** (/, a configuração geral do servidor).

As categorias também têm permissões. Um canal igual à sua categoria mostra **Sincronizado**; **Sincronizar agora** deixa o canal igual de novo depois que você o alterou.

## A lista de membros

**Configurações do servidor → Membros** lista todo mundo. Busque, filtre por cargo, veja como cada pessoa entrou e dê ou tire cargos. Você também pode selecionar várias pessoas de uma vez para expulsar ou banir.

## Cargos vinculados

Um cargo vinculado é dado automaticamente a quem conectou uma conta, por exemplo os inscritos de um canal da Twitch. Configure isso em **Integrações**.
