---
title: Estúdio
section: Fazendo música
summary: Gravem, arranjem e mixem músicas juntos em um canal de Estúdio de gravação, ao vivo ou no seu próprio tempo.
source: 13ae054b4cd0
---

Um canal de **Estúdio de gravação** é um espaço de trabalho musical dentro do seu servidor. Cada **projeto** é uma música, com seu próprio editor multipista, takes, comentários, versões e chat. Os integrantes da banda podem gravar juntos ao vivo, ou adicionar partes quando tiverem tempo.

![Um projeto aberto no estúdio](shot:studio)

## Começando um projeto

Abra um canal de Estúdio de gravação e clique em **Novo projeto**. Dê um nome e um andamento. Você precisa da permissão **Criar projetos**.

Já começou uma música em outro lugar? **Importar** abre arquivos `.dawproject` do Bitwig, Studio One, Cubase e outros, além dos arquivos `.parley-project` do próprio Parley.

## Gravando

1. Configure seu áudio no painel **Áudio**: sua saída e a **Latência de gravação**. Clique em **Medir** para seus takes ficarem alinhados com o tempo.
2. Adicione uma faixa: de **áudio** para um microfone ou instrumento, ou **MIDI** com um sintetizador, bateria ou sampler integrado.
3. Arme a faixa e aperte gravar. **Gravar a banda** grava todos na sessão a partir do cursor de reprodução; **Gravar sozinho** grava só você. Um take pode ter até 30 minutos.

Não tem teclado MIDI? Toque as notas com as teclas do computador: de <kbd>A</kbd> a <kbd>K</kbd> são as notas brancas, e <kbd>Z</kbd> e <kbd>X</kbd> mudam a oitava.

## Arranjando e editando

| Teclas | O que faz |
|---|---|
| <kbd>Space</kbd> | Tocar ou parar |
| <kbd>Home</kbd> | Voltar ao início |
| <kbd>L</kbd> | Ligar ou desligar o loop |
| <kbd>S</kbd> | Dividir o clipe no cursor de reprodução |
| <kbd>Ctrl</kbd>+<kbd>D</kbd> | Duplicar |
| <kbd>Q</kbd> | Quantizar (encaixar as notas na grade) |
| <kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Z</kbd> | Desfazer / refazer |
| <kbd>Tab</kbd> | Alternar entre o arranjo e o mixer |

Clique duas vezes em um clipe MIDI para abrir o **piano roll**. Também há metrônomo e contagem, marcadores, mudanças de andamento e pistas de automação para volume e efeitos.

No **mixer**, toda faixa tem volume, pan, solo, mute, efeitos e envios.

## Efeitos

Cada faixa, cada bus e o master têm um rack de efeitos: EQ, filtro, compressor, gate, limitador, reverb, delay, drive e chorus. Clique em **+ Efeito** para adicionar um. Os efeitos tocam de cima para baixo; passe o mouse sobre um para movê-lo ou removê-lo.

![Janelas de efeito com o EQ e o compressor de uma guitarra e um filtro de baixo, abertas lado a lado enquanto a música toca](shot:studio-effects)

Clique em um efeito para abrir a janela dele. Você pode abrir quantas janelas quiser e arrastá-las para qualquer lugar; clique em uma janela para trazê-la para a frente. Cada janela mostra o que o efeito faz:

- **EQ** e **filtro**: a curva de frequências sobre o espectro do som. Arraste os pontos da curva para moldá-la. No filtro, arraste para cima ou para baixo para mais ou menos ressonância, ou use a roda do mouse.
- **Compressor**, **gate** e **limitador**: o volume que entra comparado ao que sai, um ponto mostrando onde o seu som está agora, os últimos segundos de nível e o quanto está sendo abaixado.
- **Reverb**: o formato da cauda. **Delay**: cada eco sumindo. **Drive**: a curva de distorção, com o som antes e depois. **Chorus**: a varredura.

Enquanto a música toca, as visualizações e os medidores de **Entrada** e **Saída** se mexem com o som.

Para mudar uma configuração:

- Arraste um knob para cima ou para baixo. Segure <kbd>Shift</kbd> para um controle mais fino.
- Use a roda do mouse ou as setas do teclado.
- Digite um valor embaixo do knob, como `2.5k` ou `25%`.
- Clique duas vezes em um knob para voltar ao valor padrão.

O botão de liga/desliga na barra de título da janela desliga e liga o efeito. A seta redefine todas as configurações dele.

> Tip: Abra o mesmo efeito em duas faixas lado a lado, como o EQ da guitarra e o filtro do baixo, e toque a música. Você vê onde cada um fica e consegue abrir espaço para o outro.

### Exemplos

Estes começam com os valores padrão do efeito. Toque a música enquanto trabalha, de preferência com o **Loop** ligado, para as janelas mostrarem o seu som.

**Limpe os graves de uma guitarra ou de um vocal.** Adicione um **EQ**. Arraste o ponto **C** da curva para a direita até **Corte de graves** (Low cut) marcar cerca de `90 Hz`; o ronco abaixo disso some, e o espectro atrás da curva mostra o que você tirou. Arraste o ponto **M** até cerca de `2.5k` e suba alguns dB para trazer a parte para a frente.

**Deixe um vocal mais uniforme.** Adicione um **Compressor**. Ajuste **Razão** (Ratio) em `4:1` e depois abaixe o **Limiar** (Threshold) enquanto observa o ponto na curva: quando as palavras mais altas passam da dobra, o medidor **GR** mostra o quanto elas estão sendo abaixadas. Mire em uns 3 a 6 dB nas palavras mais altas e depois suba o **Makeup** mais ou menos na mesma quantidade, para a parte ficar tão alta quanto antes.

**Faça uma varredura de filtro.** Adicione um **Filter** a uma faixa de sintetizador ou de bateria e escolha **Passa-baixa**. Arraste devagar o ponto da curva da direita para a esquerda enquanto a música toca: o som fica mais escuro conforme o corte desce. Arraste o ponto para cima ou para baixo, ou role a roda do mouse sobre ele, para mudar a **Ressonância** (Resonance): mais ressonância dá um pico mais agudo e vibrante no corte. Para a varredura fazer parte da música, grave-a com uma [pista de automação](#arranging-and-editing).

**Acabe com o chiado de uma faixa ruidosa entre as notas.** Adicione um **Gate** em primeiro lugar no rack. Observe a luz: ela diz **OPEN** enquanto a parte toca e **CLOSED** nos intervalos. Suba o **Limiar** (Threshold) até ele fechar nos intervalos, mas continuar aberto nas notas mais baixas que você quer manter.

**Coloque uma parte em uma sala.** Adicione um **Reverb** e ajuste a **Mixagem** (Mix) em cerca de `20%`. Um **Decaimento** (Decay) mais longo dá um espaço maior; um **Timbre** (Tone) mais baixo deixa a cauda mais escura, para ela ficar atrás do som seco.

**Segure os picos da mixagem inteira.** Adicione um **Limiter** ao **Master** e deixe o **Teto** (Ceiling) em `-1 dB`. A janela mostra com que frequência os momentos mais altos são segurados; se ele estiver trabalhando o tempo todo, abaixe as faixas em vez disso.

## Tocando em banda

- **Banda**: cada pessoa é **Engenheiro** (pode mudar tudo) ou **Artista** (grava as próprias partes). **Proteger esta faixa** impede que os outros editem a sua parte.
- **Sessões**: um engenheiro clica em **Iniciar sessão** para trabalharem juntos ao vivo. Todos ouvem o que qualquer um toca.
- **Takes**: toda gravação é guardada. Escolha a melhor com **Usar o take**.
- **Comentários**: deixe recados em um ponto da música, como "a bateria arrasta aqui", e use **Resolver** quando estiver resolvido.
- **Versões**: use **Salvar versão** antes de grandes mudanças, e **Restaurar** se não gostar do rumo que as coisas tomaram.

Ouvintes que não estão na banda ainda podem tocar a música, acompanhar e comentar.

Perdeu a conexão? Continue trabalhando. Suas alterações são salvas e enviadas quando você voltar a ficar online.

## Trabalhando em outro lugar

Um projeto continua tocando, e um take continua gravando, quando você vai para um chat ou outro canal. Enquanto isso, um cartão acima do seu nome no canto inferior esquerdo mostra o projeto, se ele está tocando ou **Gravando**, e o tempo. Ele também aparece enquanto você está na sala de voz do projeto. A linha do projeto na lista de canais mostra barrinhas se mexendo enquanto toca e um ponto vermelho enquanto grava.

- Clique no nome do projeto no cartão para voltar a ele.
- Pare ou toque pelo cartão. O play continua de onde você parou.
- Pare o take pelo cartão, se você pudesse pará-lo no projeto.
- Terminou? Pare e clique em **✕** para fechar o cartão.

## Compartilhando o resultado

O painel **Exportar** pode:

- exportar a mixagem em WAV, FLAC ou MP3
- exportar **stems** (cada faixa separada, em um zip)
- **Publicar a mixagem em um canal** para todos ouvirem
- salvar o projeto como `.dawproject` para abrir em outro app de música
