# EvoConnect - Painel de Reconexão de WhatsApp para Evolution API

O **EvoConnect** é uma solução completa e multi-tenant desenvolvida para agências, empresas de SaaS e consultores que utilizam a **Evolution API** (v1.x ou v2.x). 

Permite que cada cliente acesse um portal exclusivo para visualizar o status do seu WhatsApp e reconectá-lo via **QR Code** ou **Código de Pareamento** sem expor a sua chave de API Global.

---

## 🚀 Funcionalidades Principais

* **🔒 Multi-Tenant & Segurança**: Cada cliente possui um token exclusivo de acesso (`?token=...`) e só tem visibilidade da sua própria instância.
* **⚡ Suporte Multi-Versão (Evolution API v1 e v2)**: Conecta com múltiplos servidores da Evolution API rodando no seu Portainer ou VPS.
* **📢 Alertas Automáticos por WhatsApp**: Envio automático de notificação no WhatsApp do cliente via sua **Instância Master** quando a conexão do cliente cai (`status: close`).
* **🎨 Personalização White-Label**: Defina o nome da sua marca, logo, favicon e cores primárias no painel.
* **📱 Interface Responsiva & Modern Design**: Layout elegante com dark mode, glassmorphism e animações.

---

## 📦 Como Executar o Projeto

### 1. Instalar as dependências
```bash
npm install
```

### 2. Iniciar o servidor
```bash
npm start
```
O servidor estará rodando em: `http://localhost:3000`

---

## 🛠️ Links do Sistema

- **Painel Administrativo**: `http://localhost:3000/admin.html` (Senha padrão: `admin`)
- **Portal do Cliente (Exemplo)**: `http://localhost:3000/?token=token-silva-883921`

---

## 📄 Licença
MIT
