// ============================================================
//  INTEGRATION SERVICE - diem khoi dong
//  Day la "lop keo dan" giua 4 he thong cua ABC Retail.
//
//  Cau truc 3 tang (API-led Connectivity):
//    src/system-api/      <- boc he thong cu, dich ten truong
//    src/process-api/     <- logic nghiep vu
//    src/experience-api/  <- dong goi cho tung loai client
//    src/messaging/       <- RabbitMQ: publish va consume
// ============================================================

const express = require('express');
const axios = require('axios'); // Da them thu vien axios de goi API AI
const systemApi = require('./system-api');
const messaging = require('./messaging');
const orders = require('./process-api/orders');
const consumers = require('./process-api/consumers');
const experience = require('./experience-api');

const app = express();
app.use(express.json());

// Ghi log moi request kem ma tuong quan do Kong gan vao
app.use((req, res, next) => {
  req.correlationId = req.headers['x-correlation-id'] || '-';
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} cid=${req.correlationId}`);
  next();
});

// Tra loi theo mot cau truc loi DUY NHAT cho moi endpoint
function sendError(res, err, correlationId) {
  const status = err.status || 500;
  res.status(status).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Loi khong xac dinh',
      details: err.details || {},
      correlationId
    }
  });
}

// ------------------------------------------------------------
//  /health - moi service deu phai co. Dashboard va Docker dung no.
// ------------------------------------------------------------
app.get('/health', (req, res) => {
  res.json({ status: 'UP', service: 'integration-service', time: new Date().toISOString() });
});

// ------------------------------------------------------------
//  SCENARIO 2 - Tra ton kho (dong bo)
//  GET /api/v1/products/{sku}/stock
//  Da chay duoc. Thu: http://localhost:8000/api/v1/products/SKU123/stock
// ------------------------------------------------------------
app.get('/api/v1/products/:sku/stock', async (req, res) => {
  try {
    const data = await orders.checkStock(req.params.sku);
    res.json(data);
  } catch (err) {
    sendError(res, err, req.correlationId);
  }
});

// ------------------------------------------------------------
//  SCENARIO 1 - Tao don hang (bat dong bo)
//  POST /api/v1/orders
//  TODO: hoan thien logic trong src/process-api/orders.js
// ------------------------------------------------------------
app.post('/api/v1/orders', async (req, res) => {
  try {
    const { customerId, items } = req.body;
    if (!customerId || !Array.isArray(items) || items.length === 0) {
      return sendError(res, {
        code: 'VALIDATION_ERROR',
        message: 'Can co customerId va it nhat mot item',
        status: 400
      }, req.correlationId);
    }

    const order = await orders.createOrder({
      customerId,
      items,
      idempotencyKey: req.headers['idempotency-key'],
      correlationId: req.correlationId
    });

    res.status(201).json(order);
  } catch (err) {
    sendError(res, err, req.correlationId);
  }
});

app.get('/api/v1/orders/:orderId', (req, res) => {
  const order = orders.getOrder(req.params.orderId);
  if (!order) {
    return sendError(res, { code: 'ORDER_NOT_FOUND', message: 'Khong tim thay don hang', status: 404 }, req.correlationId);
  }
  res.json(order);
});

// ------------------------------------------------------------
//  SCENARIO 5 - AI anh xa du lieu POS cu
//  POST /api/v1/ai/mapping
//  TODO: goi Ollama hoac OpenAI, kiem tra ket qua truoc khi tra ve
// ------------------------------------------------------------
const CANONICAL = { sku: 'string', name: 'string', quantity: 'integer', unitPrice: 'integer' };

app.post('/api/v1/ai/mapping', async (req, res) => {
  const legacy = req.body;
  const OLLAMA = process.env.OLLAMA_URL || 'http://host.docker.internal:11434';
  
  try {
    const { data } = await axios.post(`${OLLAMA}/api/chat`, {
      model: 'llama3.2:3b',
      format: 'json',
      stream: false,
      messages: [
        { role: 'system', content: 'Ban la cong cu chuyen doi du lieu. Chi tra ve JSON hop le, khong giai thich.' },
        { role: 'user', content: `Canonical Data Model: ${JSON.stringify(CANONICAL)}\nDu lieu POS cu: ${JSON.stringify(legacy)}\nChuyen doi sang Canonical Data Model.` }
      ]
    }, { timeout: 60000 });

    const ketQua = JSON.parse(data.message.content);
    const thieu = Object.keys(CANONICAL).filter(k => ketQua[k] === undefined);
    
    if (thieu.length) {
      return sendError(res, { 
        code: 'AI_INVALID_OUTPUT', 
        message: `AI tra ve thieu truong: ${thieu.join(', ')}`, 
        status: 422, 
        details: { thieu, raw: ketQua } 
      }, req.correlationId);
    }
    res.json({ input: legacy, output: ketQua });
  } catch (err) {
    sendError(res, { code: 'AI_UNAVAILABLE', message: 'Khong goi duoc dich vu AI', status: 503 }, req.correlationId);
  }
});

// ------------------------------------------------------------
//  Dashboard goi endpoint nay de ve man hinh giam sat
// ------------------------------------------------------------
app.get('/api/v1/dashboard/summary', async (req, res) => {
  try {
    res.json(await experience.dashboardSummary(messaging));
  } catch (err) {
    sendError(res, err, req.correlationId);
  }
});

app.use((req, res) => {
  sendError(res, { code: 'NOT_FOUND', message: `Khong co endpoint ${req.method} ${req.path}`, status: 404 }, req.correlationId);
});

// ------------------------------------------------------------
//  Khoi dong
// ------------------------------------------------------------
const PORT = Number(process.env.PORT || 4000);

async function start() {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[integration-service] dang chay o cong ${PORT}`);
  });

  // Ket noi RabbitMQ sau, de service van len duoc khi broker chua san sang
  try {
    await messaging.connect();
    await consumers.registerAll(messaging);
  } catch (err) {
    console.error('[integration-service] khong ket noi duoc RabbitMQ:', err.message);
    console.error('[integration-service] API dong bo van hoat dong binh thuong');
  }
}

start();