# 🚗 Bot WhatsApp - Registo de Quilómetros

Bot automático para registar quilómetros de viaturas via WhatsApp.

## 🎯 Funcionalidades

- Envia mensagem semanal automática a colaboradores
- Pergunta matrícula e quilómetros
- Guarda dados no Supabase
- Validação de inputs

## 📋 Pré-requisitos

- Conta Supabase
- Conta Render (para deploy)

## 🗄️ Estrutura Supabase

### Tabela: `viaturas`
```sql
CREATE TABLE viaturas (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  matricula VARCHAR(20) UNIQUE NOT NULL,
  kms INTEGER NOT NULL,
  telefone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### Tabela: `colaboradores`
```sql
CREATE TABLE colaboradores (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  nome VARCHAR(100),
  telefone VARCHAR(20) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## ⚙️ Configuração

1. Deploy no Render
2. Adicionar variáveis de ambiente:
   - `SUPABASE_URL`
   - `SUPABASE_KEY`
3. Ver logs para scanear QR Code
4. Adicionar colaboradores na tabela `colaboradores`

## 📅 Agendamento

Por padrão envia toda **segunda-feira às 9h**.

Para alterar, edite `index.js`:
```js
const CONFIG = {
  sendDay: 1, // 0=Dom, 1=Seg, 2=Ter, 3=Qua, 4=Qui, 5=Sex, 6=Sáb
  sendHour: 9,
  sendMinute: 0
};
```

## 📝 Fluxo de Conversa
