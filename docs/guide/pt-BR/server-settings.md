---
title: Configurando um servidor
section: Administrando um servidor
summary: Nome, ícone e banner, convites, canais, emojis e figurinhas, boas-vindas e integração, modelos e mais.
source: 2fcd60f75ded
---

Abra o menu do servidor clicando no nome dele e depois em **Configurações do servidor**. Você só vê as páginas que tem permissão para alterar. O dono vê tudo. Elas abrem na mesma janela das Configurações de usuário; digite na caixa de busca no topo da lista para encontrar uma página.

![Configurações do servidor, na página Perfil do servidor](shot:server-settings)

## Nome, ícone e banner

Em **Perfil do servidor**:

- **Ícone**: uma imagem quadrada de até 8 MB.
- **Nome do servidor**: até 100 caracteres. **Descrição**: até 300.
- **Banner do servidor**: a imagem no topo da lista de canais. É recortada em 16:9; 1920×1080 é o ideal. GIF, APNG e WebP animados continuam animados.
- **Canal de mensagens do sistema**: onde o Parley dá as boas-vindas aos novos membros. Se quiser, ele convida os membros a acenar dando oi.
- **Regras do servidor**: até 4.000 caracteres. Marque **Os membros devem aceitar as regras antes de conversar** para que quem chega concorde primeiro.
- **Configurações de notificação padrão** para novos membros, e se os membros podem **agendar mensagens**.

Depois de escolher uma imagem, arraste e dê zoom para enquadrá-la. Para reenquadrar depois, clique em **Ajustar**.

Também aqui:

- **Tema do servidor**: dê ao servidor suas próprias cores. Os membros podem escolher vê-las.
- **Tag de Servidor**: uma tag curta com emblema que os membros podem usar ao lado do nome.
- **Análises**: quantas pessoas entram e ficam, o quanto o servidor está movimentado e quais canais são os mais populares.

## Convidando pessoas

Clique em **Convidar pessoas** no menu do servidor para ter um link para compartilhar. Em **Convites**, nas Configurações do servidor, você pode criar convites personalizados:

- **Expira após**: de 30 minutos a 30 dias, ou nunca.
- **Número máximo de usos**: de 1 a 100, ou sem limite.
- **Conceder associação temporária**: as pessoas saem automaticamente quando se desconectam, a menos que tenham recebido um cargo.

Todos os convites ativos ficam listados, com **Revogar** para cancelar um. Servidores públicos listados no Descobrir também podem ter um **link personalizado**.

**Acesso**: para aprovar pessoas manualmente, ative **Analise os novos membros antes de poderem conversar** e escreva algumas perguntas. Os pedidos esperam você clicar em **Aprovar** ou **Recusar**.

## Canais e categorias

- **Criar canal** fica no menu do servidor, ou clique no **+** ao lado de uma categoria. Veja os tipos em [Canais](channels#kinds-of-channel).
- Arraste canais e categorias para reorganizá-los.
- Clique com o botão direito em um canal e escolha **Editar canal** para:
  - o tópico e o **Modo lento**
  - as configurações de **Restrição de idade** e **Spoiler**
  - em canais de voz: o **limite de usuários**, a qualidade de vídeo e áudio e a **criptografia de ponta a ponta**
  - as **Tags** do fórum
  - **Permissões**: veja [Cargos e permissões](roles-and-permissions#channel-permissions)

## Emojis, figurinhas e sons

| | Limite | Arquivos |
|---|---|---|
| **Emoji** | 100 por servidor | PNG, JPEG, GIF ou WebP com menos de 512 KB. Nomes de 2 a 32 letras, números ou `_`. |
| **Figurinhas** | 60 por servidor | Menos de 1 MB. 320×320 pixels funciona melhor. |
| **Painel de sons** | 48 por servidor | MP3, OGG, WAV, WebM ou M4A com menos de 512 KB (uns 5 segundos). |

Os membros podem usar seus emojis personalizados em qualquer servidor em que estejam.

## Dando boas-vindas aos novos membros

- **Tela de boas-vindas**: uma saudação com até 5 canais sugeridos, mostrada quando alguém entra.
- **Integração**: perguntas para quem acabou de chegar ("O que trouxe você aqui?"). Cada resposta pode dar cargos e canais, para que as pessoas vejam o que importa para elas. Marque perguntas como **Obrigatório**, ou permita várias respostas.
- **Regras**: definidas no Perfil do servidor. Os membros clicam em **Eu concordo** antes de poder postar.

## Comunidades dentro do seu servidor

Em um servidor grande, agrupe canais em [comunidades](channels#communities). Cada uma ganha sua própria página e seus responsáveis.

- Crie uma com o **+** ao lado de **Comunidades** na lista de canais.
- Abra a página dela e clique em **Editar**. Você pode definir:
  - o ícone, o nome e a descrição
  - um endereço na web
  - uma seção **Sobre** e **Links**
  - quem cuida dela e os canais dela
- **Adicionar imagem de cabeçalho** dá um banner à página:
  - Imagens largas, com 1600 pixels ou mais, funcionam melhor.
  - Clique em **Ajustar** para escolher **Preencher** ou **Ajustar**, alinhar com a grade de alinhamento e dar zoom.
  - As prévias mostram como fica em um celular, em um notebook e em uma tela larga.
- **Excluir comunidade** fica no topo da barra de edição. Exclui também os canais da comunidade e as mensagens deles.

## Sendo encontrado

- **Descoberta**: liste o servidor no Descobrir com uma categoria, uma descrição e um banner. Um admin analisa antes.
- **Widget**: uma caixa para incorporar no seu site, mostrando quem está online, com um botão **Entrar**.
- **Emblema**: um selo ao vivo de "Venha para cá" para um README ou site.

## Modelos de servidor

**Configurações do servidor → Modelo de servidor** compartilha a configuração do seu servidor (cargos, categorias, canais, permissões e algumas configurações) para que outras pessoas possam criar um servidor igualzinho. Mensagens, membros e emojis nunca são copiados.

- **Baixar arquivo do modelo** salva o servidor como ele está agora em um arquivo `.json`. Guarde como backup da sua configuração ou envie para alguém. Não precisa de link.
- **Compartilhar um link**: dê um título e uma descrição ao modelo e clique em **Gerar modelo**. O link continua o mesmo; clique em **Sincronizar modelo** depois de mudar o servidor para que o link traga a configuração nova. **Excluir modelo** desativa o link.

Qualquer pessoa pode criar um servidor a partir de um arquivo ou link de modelo com **Adicionar um servidor → Usar um modelo**, em qualquer servidor Parley. Veja [Começando a partir de um modelo](joining-servers#starting-from-a-template).

Quem abre um link de modelo vê o que ele configura, e pode criar um servidor a partir dele ou baixá-lo como arquivo.

## Passando adiante ou encerrando

Estas opções ficam no fim da lista, só para o dono:

- **Transferir posse** passa o servidor para outro membro.
- **Excluir servidor**: digite o nome do servidor e sua senha para confirmar. Mudou de ideia? Você tem **7 dias** para restaurá-lo em **Configurações de usuário → Conta**.
