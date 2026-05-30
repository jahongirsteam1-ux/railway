const http = require('http');
const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const admin = require('firebase-admin');

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const CARDXABAR_CHANNEL_ID = Number(process.env.CARDXABAR_CHANNEL_ID); // Masalan: -100...

// 1. FIREBASE ADMIN PANELNI INIZIALIZATSIYA QILISH
// Railway'da xavfsiz ishlash uchun Firebase maxfiy kalitlarini Environment Variables'dan olamiz
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n') : undefined
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL
  });
}
const db = admin.database();

// 2. TELEGRAM BOTNI ISHGA TUSHIRISH
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// 3. 1 DAN 100 GACHA UNIKAL SO'M QO'SHISH ALGORITMI
// Foydalanuvchi buyurtma bermoqchi bo'lganda ushbu funksiya chaqiriladi
async function generateUniqueAmount(baseAmount) {
  const ordersRef = db.ref('orders');
  
  // Hozirgi kunda to'lov kutayotgan (pending) barcha buyurtmalarni tekshiramiz
  const snapshot = await ordersRef.orderByChild('status').equalTo('pending').once('value');
  const activeOrders = snapshot.val() || {};
  
  const busyExtraSums = new Set();
  for (let key in activeOrders) {
    if (activeOrders[key].baseAmount === baseAmount) {
      busyExtraSums.add(activeOrders[key].extraSum);
    }
  }

  // 1 so'mdan 100 so'mgacha bo'lgan raqamlarni navbat bilan tekshiramiz
  for (let extra = 1; extra <= 100; extra++) {
    if (!busyExtraSums.has(extra)) {
      return {
        finalAmount: baseAmount + extra,
        extraSum: extra
      };
    }
  }
  
  // Agar 100 ta joy ham band bo'lsa (juda kam holatda), 101 dan boshlab qo'shadi
  return { finalAmount: baseAmount + 101, extraSum: 101 };
}

// 4. KANALGA KELGAN CHEKNI TEKSHIRISH (CardXabar Bot ulangan kanal)
bot.on('channel_post', async (msg) => {
  // Faqat biz belgilagan maxsus kanal xabarlarini tekshiramiz
  if (msg.chat.id !== CARDXABAR_CHANNEL_ID) return;

  const text = msg.text || msg.caption;
  if (!text) return;

  try {
    // FAQAT "+" belgisidan keyin kelgan TUSHUM summasini qidiramiz (pastdagi Balans summasiga chalg'imaydi)
    const match = text.match(/\+\s*([\d\.,\s]+)\s*UZS/);
    
    if (match) {
      // Matndagi nuqta va verfyllarni o'chirib, toza raqam holatiga keltiramiz
      // Masalan: "300.005,00" -> 300005
      const cleanAmountStr = match.group ? match.group(1) : match[1];
      const incomingAmount = parseFloat(cleanAmountStr.replace(/\./g, '').replace(',', '.'));

      console.log(`Kanalga yangi tushum aniqlandi: ${incomingAmount} UZS`);

      // Firebase'dan aynan shu jami summaga ega va kutilayotgan buyurtmani qidiramiz
      const ordersRef = db.ref('orders');
      const snapshot = await ordersRef.orderByChild('finalAmount').equalTo(incomingAmount).once('value');
      const orders = snapshot.val();

      if (orders) {
        for (let orderId in orders) {
          if (orders[orderId].status === 'pending') {
            
            // 1. Buyurtmani avtomatik ravishda tasdiqlangan (confirmed) holatga o'tkazamiz
            await ordersRef.child(orderId).update({
              status: 'confirmed',
              confirmedAt: admin.database.ServerValue.TIMESTAMP
            });

            console.log(`Buyurtma №${orderId} muvaffaqiyatli avtomatik tasdiqlandi!`);

            // 2. Xaridorga bot orqali muvaffaqiyatli to'lov xabarini yuboramiz
            const userId = orders[orderId].userId;
            if (userId) {
              await bot.sendMessage(userId, `🎉 To'lovingiz qabul qilindi!\n\nBuyurtmangiz (№${orderId}) avtomatik ravishda tasdiqlandi. Tez orada mahsulot yetkaziladi.`);
            }
            break; 
          }
        }
      } else {
        console.log(`Tushum summasi (${incomingAmount}) bo'yicha hech qanday aktiv buyurtma topilmadi.`);
      }
    }
  } catch (error) {
    console.error("Chekni tekshirishda xatolik yuz berdi:", error);
  }
});

// WEB APP SAHIFASINI INTERNETGA CHIQARISH (Mavjud kod qismi)
const server = http.createServer((req, res) => {
  // Foydalanuvchi Mini App do'konini ochganda index.html yuklanadi
  const filePath = path.join(__dirname, 'index.html');

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`TechStore Web Server va Bot muvaffaqiyatli ishga tushdi (Port: ${PORT})`);
});
