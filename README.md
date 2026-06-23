# Dashboard de Capacitação — CEPDEC/ES

Dashboard estático que consulta automaticamente a planilha pública do Google Sheets e apresenta os indicadores de capacitação.

## Estrutura

- `index.html`: estrutura da página.
- `css/styles.css`: estilos e responsividade.
- `js/app.js`: consulta da planilha, filtros, indicadores e gráficos.
- `img/`: distintivos usados no cabeçalho.
- `.github/workflows/pages.yml`: publicação automática no GitHub Pages.

## Atualização dos dados

A página consulta a versão CSV publicada da planilha ao abrir, ao clicar em **Atualizar agora** e automaticamente a cada 5 minutos. Uma nova consulta também é feita quando a aba volta a ficar visível após esse intervalo. Não é necessário gerar ou enviar arquivos Excel para o repositório.

## Execução local

Sirva a pasta com um servidor HTTP local, por exemplo:

```bash
python -m http.server 8000
```

Depois acesse `http://localhost:8000`.

## GitHub Pages

O workflow publica o conteúdo da branch `development`. Nas configurações do repositório, em **Settings → Pages → Build and deployment**, selecione **GitHub Actions** como fonte.
