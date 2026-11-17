// ============================================================
// PHẦN CỦA MINH: System API — Dịch tên trường và gọi HTTP
// Nhiệm vụ: Bọc các hệ thống cũ, xử lý lỗi 404/503/409 chuẩn xác
// ============================================================
const axios = require('axios');

class SystemApiError extends Error {
  constructor(code, message, status, details) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    this.name = 'SystemApiError';
  }
}

// Cấu hình timeout mặc định để không treo hệ thống
const client = axios.create({ timeout: 5000 });

async function getStock(sku) {
  try {
    const { data } = await client.get(`${process.env.WMS_URL}/api/v1/wms/inventory/${sku}`);
    // Dịch từ tiếng Việt của hệ thống WMS cũ sang chuẩn Canonical
    return {
      sku: data.ma_hang,
      name: data.ten_hang,
      availableStock: data.kha_dung,
      warehouseId: data.kho
    };
  } catch (err) {
    if (err.response?.status === 404) {
      throw new SystemApiError('SKU_NOT_FOUND', `Khong tim thay san pham ${sku} trong WMS`, 404, { sku });
    }
    throw new SystemApiError('WMS_UNAVAILABLE', 'He thong WMS hien khong phan hoi', 503, { sku, error: err.message });
  }
}

async function reserveStock(sku, qty, orderId) {
  try {
    const { data } = await client.post(`${process.env.WMS_URL}/api/v1/wms/reservations`, { sku, qty, orderId });
    return { reservationId: data.reservationId, sku: data.sku, qty: data.qty };
  } catch (err) {
    if (err.response?.status === 409) {
      const d = err.response.data;
      throw new SystemApiError('INSUFFICIENT_STOCK', `Khong du ton kho cho ${sku}`, 409, { sku, available: d.kha_dung, requested: qty });
    }
    if (err.response?.status === 404) {
      throw new SystemApiError('SKU_NOT_FOUND', `Khong tim thay san pham ${sku} de giu hang`, 404, { sku });
    }
    throw new SystemApiError('WMS_UNAVAILABLE', 'Loi mang khi goi WMS giu hang', 503, { sku, error: err.message });
  }
}

async function createShipment(orderId, address, items) {
  try {
    const { data } = await client.post(`${process.env.TMS_URL}/api/v1/tms/shipments`, { orderId, address, items });
    return { shipmentId: data.shipmentId, trackingNo: data.trackingNo, status: data.status };
  } catch (err) {
    throw new SystemApiError('TMS_UNAVAILABLE', 'He thong Van tai (TMS) khong phan hoi', 503, { orderId });
  }
}

async function addLoyaltyPoints(customerId, points, orderId) {
  try {
    const { data } = await client.put(`${process.env.CRM_URL}/api/v1/crm/customers/${customerId}/points`, { points, orderId });
    return { customerId: data.khach_hang, totalPoints: data.diem_hien_tai, tier: data.hang_thanh_vien };
  } catch (err) {
    throw new SystemApiError('CRM_UNAVAILABLE', 'He thong CRM khong phan hoi, khong the cong diem', 503, { customerId });
  }
}

async function charge(orderId, amount) {
  try {
    const { data } = await client.post(`${process.env.PAYMENT_URL}/api/v1/payments`, { orderId, amount });
    return { paymentId: data.paymentId, status: data.status };
  } catch (err) {
    if (err.response?.status === 402) {
      throw new SystemApiError('PAYMENT_DECLINED', 'Giao dich thanh toan bi tu choi', 402, { orderId });
    }
    throw new SystemApiError('PAYMENT_UNAVAILABLE', 'Cổng thanh toan khong the ket noi', 503, { orderId });
  }
}

module.exports = { getStock, reserveStock, createShipment, addLoyaltyPoints, charge, SystemApiError };