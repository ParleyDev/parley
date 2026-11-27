---
title: Apps, bots e assistentes de IA
section: Administrando um servidor
summary: Adicione bots ao seu servidor, use os comandos deles e conecte um assistente de IA à sua conta.
source: 33c7e9205c14
---

Os **Apps** adicionam recursos ao Parley. Um **bot** é um app que entra em um servidor como se fosse um membro: ele pode dar boas-vindas às pessoas, rodar jogos, tocar música ou postar novidades.

## Encontrando apps

Abra o **Diretório de apps** pelo Descobrir (**Explorar o Diretório de apps**) ou por **Configurações de usuário → Apps autorizados**. Busque ou navegue por categoria. O selo **Verificado** quer dizer que o Parley conferiu quem fez o app.

## Adicionando um bot ao seu servidor

1. Clique em **Adicionar ao servidor** no app, ou abra o link de convite que quem fez o bot passou para você.
2. Escolha um servidor em que você tenha a permissão **Gerenciar servidor**. Um link feito para um servidor específico já vem com ele escolhido.
3. Confira as permissões que ele pede. Desmarque as que ele não precisa.
4. Clique em **Autorizar**.

Depois clique em **Ir para o servidor**. Se você começou no site do próprio app, o Parley leva você de volta para lá.

O bot ganha um cargo próprio. Você pode mudar as permissões dele em **Configurações do servidor → Cargos**. Para remover um bot, use **Configurações do servidor → Integrações**, ou expulse-o como qualquer membro.

## Apps só para você

Alguns apps podem ser adicionados à sua própria conta com **Adicionar a Meus apps**. Aí você pode usá-los em qualquer lugar: em qualquer servidor ou DM. Eles também aparecem em **Apps** quando você clica com o botão direito em uma mensagem ou em uma pessoa.

## Usando comandos

Digite `/` no começo da caixa de mensagem. Os comandos do próprio Parley vêm primeiro, depois os comandos de todos os apps que você pode usar ali. Escolha um, preencha as opções e pressione <kbd>Enter</kbd>. Alguns apps abrem um formulário ou respondem só para você.

## Assistentes de IA

Você pode deixar um assistente de IA, como o Claude, o ChatGPT ou o Cursor, ler e enviar mensagens por você. Pergunte coisas como "o que eu perdi?" ou "responda para o Sam que vou me atrasar".

1. Abra **Configurações de usuário → Apps autorizados** e copie o endereço em **Assistentes de IA (MCP)**.
2. No seu assistente, adicione esse endereço como conector personalizado (pode se chamar *servidor MCP remoto*).
3. O Parley abre uma página perguntando o que o assistente pode fazer: **Ler**, **Notificações**, **Enviar mensagens** ou **Gerenciar servidores**. Escolha só o que você precisa e aprove.

> Heads up: Tudo o que o assistente enviar aparece com o seu nome. Com **Gerenciar servidores** ele poderia excluir mensagens ou remover pessoas, então só permita isso se for mesmo a sua intenção.

Para interromper, clique em **Desconectar** ao lado do assistente em **Apps autorizados**.

## Ferramentas para admins

Algumas ferramentas que trabalham na sua instância, como o Profile Studio para criar cosméticos de perfil, entram do mesmo jeito. Quando você entra pela ferramenta, o Parley abre uma página pedindo para permitir que ela possa **Gerenciar cosméticos**: adicionar cosméticos à instância e alterar os que já existem. Só funciona se a sua conta puder gerenciar a instância, e a ferramenta nunca vê sua senha.

> Heads up: Tudo o que ela adicionar ou alterar aparece para todo mundo na hora. Só permita ferramentas em que você confia.

Para interromper, clique em **Desconectar** ao lado da ferramenta em **Apps autorizados**.

## Criando o seu

Quer criar um bot? Crie um app em **Configurações de usuário → Aplicativos** e leia [a documentação para desenvolvedores](https://app.runparley.com/developers).
