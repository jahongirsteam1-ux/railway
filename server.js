/**
 * TechStore — Avtomatik To'lov Tekshiruv Tizimi
 * CardXabar integratsiyasi bilan Telegraf bot
 *
 * Arxitektura:
 *  1. Express  — index.html ni serve qiladi (Mini App)
 *  2. Telegraf — foydalanuvchilarga xabar yuboradi
 *  3. Firebase — orders bazasini boshqaradi
 *  4. CardXabar listener — kanaldan tushum summasini o'qiydi
 */

'use strict';

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const express              = require('express');
const path                 = require('path');
const admin                = require('firebase-admin');

// ─────────────────────────────────────────────
// 1. ENV TEKSHIRUV
// ─────────────────────────────────────────────
const REQUIRED_ENV = [
  'BOT_TOKEN',
  'CARDXABAR_CHANNEL_ID',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_DATABASE_URL',
];

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`ENV topilmadi: ${key}`);
    process.exit(1);
  }
}

const BOT_TOKEN            = process.env.BOT_TOKEN;
const CARDXABAR_CHANNEL_ID = process.env.CARDXABAR_CHANNEL_ID;
const WEBAPP_URL           = process.env.WEBAPP_URL
                          || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || 'localhost:3000'}`;
const PORT                 = process.env.PORT || 3000;

// ─────────────────────────────────────────────
// 2. FIREBASE ADMIN INIT
// ─────────────────────────────────────────────
admin.initializeApp({
  credential: admin.credential.cert({
    projectId  : process.env.FIREBASE_PROJECT_ID,
    privateKey : process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  }),
  databaseURL: process.env.FIREBASE_DATABASE_URL,
});

const db = admin.database();
console.log('Firebase Admin ulandi:', process.env.FIREBASE_PROJECT_ID);

// ─────────────────────────────────────────────
// 3. EXPRESS SERVER
// ─────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname)));

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─────────────────────────────────────────────
// 4. UNIKAL SUMMA GENERATORI
//    GET /api/unique-amount?base=300000
// ─────────────────────────────────────────────
app.get('/api/unique-amount', async (req, res) => {
  try {
    const base = parseInt(req.query.base, 10);

    if (!base || base <= 0) {
      return res.status(400).json({ error: "base parametri noto'g'ri" });
    }

    const snap = await db.ref('orders')
      .orderByChild('status')
      .equalTo('pending')
      .once('value');

    const orders     = snap.val() || {};
    const usedExtras = new Set();

    for (const order of Object.values(orders)) {
      if (order.baseAmount === base && typeof order.extraSum === 'number') {
        usedExtras.add(order.extraSum);
      }
    }

    let extraSum = null;
    for (let i = 1; i <= 100; i++) {
      if (!usedExtras.has(i)) {
        extraSum = i;
        break;
      }
    }

    if (extraSum === null) {
      return res.status(503).json({
        error: "Hozir juda ko'p buyurtma kutmoqda. Biroz kutib, qayta urinib ko'ring.",
      });
    }

    return res.json({
      baseAmount  : base,
      extraSum    : extraSum,
      finalAmount : base + extraSum,
    });

  } catch (err) {
    console.error('unique-amount xatosi:', err);
    return res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─────────────────────────────────────────────
// 5. TELEGRAM BOT
// ─────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

bot.start((ctx) => {
  const name = ctx.from.first_name || 'Mehmon';
  return ctx.reply(
    `Salom, ${name}! 👋\n\nTechStore rasmiy botiga xush kelibsiz!\nEng yangi texnologiyalar va aksessuarlarni ko'rish uchun pastdagi tugmani bosing.`,
    Markup.inlineKeyboard([
      [Markup.button.webApp('🛍️ Do\'konni ochish', WEBAPP_URL)],
    ])
  );
});

bot.command('menu', (ctx) =>
  ctx.reply("Do'konni ochish:", Markup.inlineKeyboard([
    [Markup.button.webApp('TechStore', WEBAPP_URL)],
  ]))
);

bot.help((ctx) =>
  ctx.reply('/start — Boshlash\n/menu — Do\'kon\n/help — Yordam')
);

// Boshqa xabarlar
bot.on('message', (ctx) =>
  ctx.reply("Do'konni ochish uchun /start bosing:", Markup.inlineKeyboard([
    [Markup.button.webApp('TechStore', WEBAPP_URL)],
  ]))
);

// ─────────────────────────────────────────────
// 6. CARDXABAR REGEX PARSER
// ─────────────────────────────────────────────

/**
 * CardXabar xabar namunasi:
 *   "To'ldirish
 *    ...
 *    + 300.003,00 UZS
 *    Balans: 1 500 000,00 UZS"
 *
 * Faqat "+" belgisidan keyingi BIRINCHI summani olamiz.
 * "Balans:" dan keyingi raqamni olmaymiz.
 */
const CARDXABAR_REGEX = /\+\s*([\d\s.,]+?)\s*UZS/i;

/**
 * "300.003,00" yoki "300 003,00" => 300003
 */
function parseAmount(raw) {
  // Verguldan keyingi tiyin qismini olib tashlash
  const withoutTiyin = raw.replace(/,\d+$/, '').trim();
  // Barcha ajratgichlarni (nuqta, bo'shliq) tozalash
  const digitsOnly   = withoutTiyin.replace(/[\s.]/g, '');
  const num          = parseInt(digitsOnly, 10);
  return isNaN(num) ? null : num;
}

/**
 * Kanal xabarini qayta ishlash
 */
async function processChannelMessage(text) {
  if (!text) return;

  const match = text.match(CARDXABAR_REGEX);
  if (!match) return; // Tushum summasi yo'q

  const rawAmount   = match[1];
  const finalAmount = parseAmount(rawAmount);

  if (!finalAmount || finalAmount <= 0) {
    console.warn('Summa tahlil qilinmadi:', rawAmount);
    return;
  }

  console.log(`CardXabar tushumi: ${finalAmount} UZS`);
  await matchAndConfirmOrder(finalAmount);
}

// ─────────────────────────────────────────────
// 7. BUYURTMANI TOPIB TASDIQLASH
// ─────────────────────────────────────────────
async function matchAndConfirmOrder(finalAmount) {
  try {
    const snap = await db.ref('orders')
      .orderByChild('finalAmount')
      .equalTo(finalAmount)
      .once('value');

    const orders = snap.val();
    if (!orders) {
      console.log(`${finalAmount} UZS uchun pending buyurtma topilmadi`);
      return;
    }

    // Faqat "pending" statusli birinchi buyurtmani olish
    const pendingEntry = Object.entries(orders).find(
      ([, order]) => order.status === 'pending'
    );

    if (!pendingEntry) {
      console.log(`${finalAmount} UZS — buyurtma allaqachon tasdiqlangan`);
      return;
    }

    const [orderKey, order] = pendingEntry;

    // Statusni yangilash
    await db.ref(`orders/${orderKey}`).update({
      status     : 'confirmed',
      confirmedAt: admin.database.ServerValue.TIMESTAMP,
      confirmedBy: 'auto_cardxabar',
    });

    console.log(`Buyurtma tasdiqlandi: ${orderKey} | ${finalAmount} UZS | user: ${order.userId}`);

    // Foydalanuvchiga xabar yuborish
    if (order.userId) {
      await notifyUser(order.userId, order, orderKey);
    }

  } catch (err) {
    console.error('matchAndConfirmOrder xatosi:', err);
  }
}

// ─────────────────────────────────────────────
// 8. FOYDALANUVCHIGA XABAR YUBORISH
// ─────────────────────────────────────────────
async function notifyUser(userId, order, orderKey) {
  try {
    const productNames = Array.isArray(order.items)
      ? order.items.map((i) => i.name).join(', ')
      : (order.productName || 'Mahsulot');

    const amountFormatted = order.finalAmount
      ? order.finalAmount.toLocaleString('uz-UZ') + ' UZS'
      : '';

    const message =
      `🎉 To'lovingiz muvaffaqiyatli qabul qilindi va buyurtmangiz tasdiqlandi!\n\n` +
      `📦 Buyurtma raqami: #${orderKey}\n` +
      `🛒 Mahsulot: ${productNames}\n` +
      `💰 Summa: ${amountFormatted}\n\n` +
      `🚀 Admin siz bilan tez orada bog'lanadi va mahsulot yetkazib beriladi!\n\n` +
      `TechStore — Ishonchli xarid 🏆`;

    await bot.telegram.sendMessage(userId, message, {
      ...Markup.inlineKeyboard([
        [Markup.button.webApp("Do'konni ochish", WEBAPP_URL)],
      ]),
    });

    console.log(`Foydalanuvchiga xabar yuborildi: ${userId}`);

  } catch (err) {
    // Foydalanuvchi botni bloklagan bo'lishi mumkin
    console.warn(`Xabar yuborishda xato (userId: ${userId}):`, err.message);
  }
}

// ─────────────────────────────────────────────
// 9. KANAL XABARLARINI USHLASH
//    channel_post — kanal xabarlari uchun alohida handler
// ─────────────────────────────────────────────
bot.on('channel_post', async (ctx) => {
  const post = ctx.channelPost;

  // Faqat bizning CardXabar kanalidan
  const channelId = String(post.chat.id);
  const targetId  = String(CARDXABAR_CHANNEL_ID);

  if (channelId !== targetId) return;

  const text = post.text || post.caption || '';
  console.log(`Kanal xabari [${channelId}]:`, text.substring(0, 100));

  await processChannelMessage(text);
});

// ─────────────────────────────────────────────
// 10. QO'SHIMCHA API ENDPOINTLAR
// ─────────────────────────────────────────────

// POST /api/orders — Frontend dan buyurtma yaratish
app.post('/api/orders', async (req, res) => {
  try {
    const { userId, items, baseAmount, extraSum, finalAmount, phone, address } = req.body;

    if (!userId || !baseAmount || !finalAmount) {
      return res.status(400).json({ error: "Majburiy maydonlar to'ldirilmagan" });
    }

    const orderRef = db.ref('orders').push();
    await orderRef.set({
      userId,
      items       : items    || [],
      baseAmount,
      extraSum    : extraSum || 0,
      finalAmount,
      phone       : phone    || '',
      address     : address  || '',
      status      : 'pending',
      createdAt   : admin.database.ServerValue.TIMESTAMP,
      confirmedAt : null,
      confirmedBy : null,
    });

    return res.json({ success: true, orderKey: orderRef.key });

  } catch (err) {
    console.error('POST /api/orders xatosi:', err);
    return res.status(500).json({ error: 'Server xatosi' });
  }
});

// GET /api/orders/:orderKey — Buyurtma statusini tekshirish
app.get('/api/orders/:orderKey', async (req, res) => {
  try {
    const snap  = await db.ref(`orders/${req.params.orderKey}`).once('value');
    const order = snap.val();

    if (!order) {
      return res.status(404).json({ error: 'Buyurtma topilmadi' });
    }

    // userId ni yashirish
    const { userId: _hidden, ...safeOrder } = order;
    return res.json(safeOrder);

  } catch (err) {
    console.error('GET /api/orders xatosi:', err);
    return res.status(500).json({ error: 'Server xatosi' });
  }
});

// ─────────────────────────────────────────────
// 11. SERVER ISHGA TUSHIRISH
// ─────────────────────────────────────────────
app.listen(PORT, async () => {
  console.log('='.repeat(50));
  console.log(`Express server: http://localhost:${PORT}`);
  console.log(`Mini App URL  : ${WEBAPP_URL}`);
  console.log(`CardXabar kanal: ${CARDXABAR_CHANNEL_ID}`);
  console.log('='.repeat(50));

  try {
    const botInfo = await bot.telegram.getMe();
    console.log(`Bot ulandi: @${botInfo.username} (id: ${botInfo.id})`);

    await bot.launch({ dropPendingUpdates: true });
    console.log('Bot polling boshlandi — CardXabar kanalini tinglayapman...');

  } catch (err) {
    console.error('Bot ishga tushmadi:', err.message);
    process.exit(1);
  }
});

process.once('SIGINT',  () => { bot.stop('SIGINT');  });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });
