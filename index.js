const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const conversationState = new Map();

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    const text = msg.message.conversation || 
                 msg.message.extendedTextMessage?.text || '';

    await handleMessage(sock, from, text);
  });

  console.log('✅ Bot WhatsApp ativo!');
}

async function handleMessage(sock, from, text) {
  const state = conversationState.get(from) || { step: 0 };

  if (state.step === 0) {
    conversationState.set(from, { step: 1 });
    await sock.sendMessage(from, { 
      text: 'Olá! Por favor indique a matrícula da viatura:' 
    });
  } else if (state.step === 1) {
    conversationState.set(from, { 
      step: 2, 
      matricula: text.toUpperCase() 
    });
    await sock.sendMessage(from, { 
      text: 'Obrigado! Agora indique os quilómetros:' 
    });
  } else if (state.step === 2) {
    const kms = parseInt(text.replace(/\D/g, ''));

    if (isNaN(kms)) {
      await sock.sendMessage(from, { 
        text: 'Por favor indique um número válido de quilómetros.' 
      });
      return;
    }

    const { error } = await supabase.from('viaturas').upsert({
      matricula: state.matricula,
      kms,
      telefone: from,
      updated_at: new Date().toISOString()
    });

    await sock.sendMessage(from, { 
      text: error 
        ? '❌ Erro ao guardar dados. Tente novamente.' 
        : `✅ Dados guardados com sucesso!\nMatrícula: ${state.matricula}\nQuilómetros: ${kms}`
    });

    conversationState.delete(from);
  }
}

startBot().catch(console.error);
