---
title: Moderação e segurança
section: Administrando um servidor
summary: Mantenha seu servidor amigável com AutoMod, castigos, banimentos, denúncias, proteção contra raids e o registro de auditoria.
source: 902efa01e18b
---

## Lidando com alguém

Clique com o botão direito em uma pessoa (ou toque e segure no celular) para ver estas opções:

| Opção | O que acontece |
|---|---|
| **Aplicar castigo** | A pessoa pode ler, mas não pode postar, reagir nem entrar na voz por um período de 60 segundos a uma semana. **Remover castigo** encerra antes. |
| **Expulsar** | Remove a pessoa. Ela pode voltar com um novo convite. |
| **Banir** | Remove a pessoa e impede que ela volte. Você também pode excluir as mensagens dela dos últimos dias, até 7. |
| **Visão de moderador** | O histórico da pessoa no seu servidor: advertências, castigos e notas. Você pode **Advertir** a pessoa, ou colocá-la em **Quarentena** enquanto investiga algo. |

Sempre informe um motivo. Ele fica guardado no registro de auditoria, para o resto da equipe saber o que aconteceu.

Desfaça banimentos em **Configurações do servidor → Banimentos**. Membros banidos podem apelar, se o servidor permitir. As apelações ficam ali esperando você aceitar ou negar.

Para limpar uma enxurrada de spam, digite `/purge 50` para excluir as últimas 50 mensagens, ou `/purge 50 @someone` para excluir só as dessa pessoa (até 100 de uma vez).

## AutoMod

**Configurações do servidor → AutoMod** pega problemas automaticamente, mesmo quando não tem nenhum moderador por perto. As regras podem:

- **Bloquear palavras**: uma lista de palavras ou frases. Use `*` como curinga.
- **Bloquear spam de menções**: mensagens que chamam gente demais de uma vez.
- **Bloquear links**: links para qualquer site, menos os que você permitir.
- **Filtrar apelidos** que quebram suas regras.

Para cada regra, escolha o que acontece:

- bloquear a mensagem, com uma mensagem sua para quem enviou, se quiser
- enviar um alerta para um canal dos moderadores
- aplicar castigo à pessoa

Você também pode isentar cargos ou canais, como um canal onde os moderadores discutem palavrões. Quem pode gerenciar o servidor nunca é filtrado.

## Configuração de segurança

**Configurações do servidor → Configuração de segurança** tem os interruptores principais:

- **Nível de verificação**: o que alguém novo precisa antes de poder postar. **Baixo** exige um e-mail confirmado. **Médio** também exige uma conta no Parley com mais de 5 minutos. **Alto** também exige 10 minutos no seu servidor. Membros com qualquer cargo pulam isso.
- **Proteção contra raids**: percebe uma chegada repentina de contas novas e alerta seus moderadores.
- **Pausar convites** e **Pausar DMs entre membros**: freios de emergência durante uma raid.
- **Filtro de imagens explícitas**: analisa as imagens postadas no servidor.
- **Autenticação em duas etapas para moderadores**: os moderadores precisam ter a 2FA ativada ou uma chave de acesso adicionada, para que uma senha roubada não possa ser usada contra o servidor. Qualquer uma das duas vale, e você mesmo precisa de uma para ativar isso.
- **Resumos com IA**: ative ou desative o botão Resumos.

## Denúncias

Quando os membros usam **Denunciar mensagem** ou **Denunciar usuário** e marcam a opção de avisar também os moderadores deste servidor, a denúncia cai em **Configurações do servidor → Denúncias**. Use **Ir** para vê-la no contexto, e depois **Resolver** ou **Dispensar**.

Denúncias sobre a segurança de uma criança ou sobre imagens íntimas compartilhadas sem consentimento nunca aparecem aqui. Elas vão apenas para a equipe que roda o seu servidor Parley.

## O registro de auditoria

O **Registro de auditoria** guarda quem mudou o quê: cargos, canais, banimentos, expulsões, castigos, mensagens excluídas e configurações. Filtre por pessoa ou por tipo de ação. É o primeiro lugar para olhar quando algo muda e ninguém sabe por quê.

## Denunciando ao Parley

Algumas coisas vão além de um servidor, como ameaças, conteúdo ilegal ou spam em vários servidores. Toda denúncia vai para os admins que rodam o seu servidor Parley. Marcar a opção também a envia para os moderadores daquele servidor.

Para denunciar, clique com o botão direito em uma mensagem e escolha **Denunciar mensagem**, ou clique com o botão direito em uma pessoa e escolha **Denunciar usuário**. Escolha o que está errado, acrescente o que puder ajudar e escolha **Enviar denúncia**.

Alguns motivos são analisados primeiro: **Ameaça de violência**, **Alguém pode se machucar**, **Imagens íntimas compartilhadas sem consentimento** e a maioria das opções em **Uma criança está em risco**. Denúncias sobre a segurança de uma criança ou sobre imagens íntimas vão apenas para a equipe que roda o seu servidor Parley, nunca para os moderadores de um servidor, por isso a opção de avisá-los não aparece nesses casos.

O que você denuncia é copiado no momento do envio: a mensagem, os arquivos anexados a ela e, em um canal de servidor, o que foi dito logo antes e logo depois. Excluir a mensagem depois não remove a cópia.

> Heads up: Se você encontrar imagens ou vídeos sexuais de uma criança, não salve, não faça captura de tela e não encaminhe, nem mesmo como prova. Denuncie a mensagem e deixe-a onde está. Sua denúncia guarda o que é necessário.

> Note: Se alguém estiver em perigo agora, ligue primeiro para o número de emergência local e depois denuncie.

Você pode enviar até 10 denúncias por hora. Os motivos analisados primeiro têm um limite próprio, maior.
