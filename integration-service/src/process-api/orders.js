// ============================================================
// PHẦN CỦA HỢP: Process API - Orders (Logic tạo đơn hàng)
// Nhiệm vụ: Orchestration, chống trùng đơn, kiểm kho, phát event
// ============================================================
const crypto = require('crypto');
const systemApi = require('../system-api');
const messaging = require('../messaging');

// In-memory DB lưu trữ tạm thời (Thực tế nên dùng Redis/MongoDB)
const idempotencyKeys = new Map();
const orders = new Map();

async function checkStock(sku) {
  return await systemApi.getStock(sku);
}

function getOrder(orderId) {
  return orders.get(orderId);
}

async function createOrder({ customerId, items, idempotencyKey, correlationId }) {
  // Bước 1: Idempotency (Chống duplicate submission nếu user bấm submit nhiều lần)
  if (idempotencyKey && idempotencyKeys.has(idempotencyKey)) {
    const existingOrderId = idempotencyKeys.get(idempotencyKey);
    const existingOrder = orders.get(existingOrderId);
    if (existingOrder) {
      console.log(`[orders] Phat hien request trung lap, tra ve don cu: ${existingOrderId}`);
      return existingOrder;
    }
  }

  // Bước 2: Kiểm tra tồn kho đồng bộ (Bắt buộc phải check ngay để báo user)
  for (const it of items) {
    const stockInfo = await systemApi.getStock(it.sku);
    if (stockInfo.availableStock < it.quantity) {
      const e = new Error(`Khong du ton kho cho ${it.sku}`);
      e.code = 'INSUFFICIENT_STOCK'; 
      e.status = 409;
      e.details = { sku: it.sku, available: stockInfo.availableStock, requested: it.quantity };
      throw e;
    }
    // Gán giá tạm (thực tế sẽ lấy từ hệ thống PIM/Pricing)
    it.unitPrice = 150000; 
  }

  // Bước 3: Giữ hàng (Reserve Stock) trên WMS
  const orderId = 'ORD-' + crypto.randomBytes(6).toString('hex').toUpperCase();
  const reservations = [];
  try {
    for (const it of items) {
      const resData = await systemApi.reserveStock(it.sku, it.quantity, orderId);
      reservations.push(resData);
    }
  } catch (error) {
    // Logic Rollback nếu giang dở (Saga Pattern cơ bản)
    console.error(`[orders] Loi giu hang cho don ${orderId}, can rollback...`, error.message);
    throw error;
  }

  // Bước 4: Tính tổng tiền và lưu vào Database
  const totalAmount = items.reduce((sum, it) => sum + (it.unitPrice * it.quantity), 0);
  const order = {
    orderId, 
    customerId, 
    items, 
    totalAmount, 
    reservations,
    status: 'PROCESSING', 
    createdAt: new Date().toISOString(),
    correlationId
  };
  
  orders.set(orderId, order);
  if (idempotencyKey) {
    idempotencyKeys.set(idempotencyKey, orderId);
  }

  // Bước 5: Bắn Event cho Consumer xử lý nền (TMS, CRM) rồi trả response ngay
  try {
    await messaging.publish('order.created', {
      orderId, 
      customerId, 
      items, 
      totalAmount,
      address: '123 Nguyen Van Linh, Da Nang'
    }, correlationId);
  } catch (msgError) {
    console.warn(`[orders] Don hang tao thanh cong nhung phat event that bai:`, msgError.message);
    // Vẫn trả về order vì process chính đã xong, hệ thống monitor sẽ quét lại db để bù event sau
  }
  
  return order;
}

module.exports = { createOrder, checkStock, getOrder };