# TechStore — Railway Deployment

## Fayllar
- `index.html` — asosiy ilova
- `server.js` — Node.js server
- `package.json` — loyiha konfiguratsiyasi

## Railway ga yuklash

### 1-usul: GitHub orqali (tavsiya etiladi)

1. GitHub da yangi repository yarating
2. Ushbu fayllarni yuklang:
   ```
   git init
   git add .
   git commit -m "TechStore deploy"
   git push origin main
   ```
3. [railway.app](https://railway.app) ga kiring
4. **New Project → Deploy from GitHub repo** tanlang
5. Repository tanlang → avtomatik deploy bo'ladi
6. **Settings → Networking → Generate Domain** bosing
7. URL ni oling (masalan: `techstore-xxx.up.railway.app`)

### 2-usul: Railway CLI orqali

```bash
npm install -g @railway/cli
railway login
railway init
railway up
```

## Telegram Bot ga ulash

BotFather da:
```
/setmenubutton
# Botingizni tanlang
# URL: https://your-app.up.railway.app
# Button text: TechStore
```

Yoki Web App sifatida:
```
/newapp
# URL: https://your-app.up.railway.app
```
