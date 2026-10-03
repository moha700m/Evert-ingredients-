# Arabic Telegram Store Bot

بوت متجر عربي على Telegram + Vercel يقرأ منتجات Canboso/CipherForge، يترجم الاسم والوصف للعربية، ويجهز الدفع عبر Telegram Stars.

## النشر

- الأسرار تحفظ في Vercel Environment Variables فقط.
- ابدأ مع `ENABLE_LIVE_PURCHASES=false`.
- بعد إضافة أو تعديل Environment Variables في Vercel، نفّذ Redeploy للإنتاج حتى تُحمّل القيم الجديدة.
- بعد النشر نفّذ `/api/setup?secret=YOUR_SETUP_SECRET` لربط Webhook.
- افحص `/api/debug-products?secret=YOUR_SETUP_SECRET` قبل تفعيل البيع الحقيقي.

## متغيرات أساسية

راجع `.env.example` لكل الإعدادات المطلوبة.

## الأمان

لا تضع Bot Token أو API Key في GitHub. عند فشل شراء المورد بعد دفع Stars، يحاول البوت تنفيذ `refundStarPayment` تلقائيًا.
