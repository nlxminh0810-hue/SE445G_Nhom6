// ============================================================
// PHẦN CỦA NGÂN: Message Consumers (Xử lý tác vụ chạy ngầm)
// Nhiệm vụ: Đảm bảo tiến trình tạo vận đơn, cộng điểm không block API
// ============================================================
const systemApi = require('../system-api');

// Map lưu ID các event đã xử lý thành công để tránh lặp (Idempotent Consumer)
const processedEvents = new Set(); 

async function registerAll(messaging) {
  
  // ------------------------------------------------------------------
  // Consumer 1: Hệ thống Vận tải (TMS) - Lắng nghe order.created
  // ------------------------------------------------------------------
  await messaging.consume('tms.order-created', 'order.created', async (data, event) => {
    const eventKey = `tms:${event.eventId}`;
    
    // Nếu event này từng chạy qua rồi thì bỏ qua
    if (processedEvents.has(eventKey)) {
      console.log(`[tms-consumer] Event ID ${event.eventId} da duoc xu ly, bo qua (Idempotency).`);
      return;
    }
    
    console.log(`[tms-consumer] Dang xu ly tao van don cho don hang: ${data.orderId}...`);
    const shipment = await systemApi.createShipment(data.orderId, data.address, data.items);
    
    processedEvents.add(eventKey);
    console.log(`[tms-consumer] Thanh cong! Ma van don: ${shipment.shipmentId} -> Tracking: ${shipment.trackingNo}`);
  });

  // ------------------------------------------------------------------
  // Consumer 2: Hệ thống Chăm sóc khách hàng (CRM) - Cộng điểm
  // ------------------------------------------------------------------
  await messaging.consume('crm.order-created', 'order.created', async (data, event) => {
    const eventKey = `crm:${event.eventId}`;
    
    if (processedEvents.has(eventKey)) {
      console.log(`[crm-consumer] Event ID ${event.eventId} da duoc xu ly, bo qua (Idempotency).`);
      return;
    }
    
    // Công thức tính điểm: Cứ 10.000 VNĐ = 1 điểm CRM
    const pointsToAdd = Math.floor(data.totalAmount / 10000);
    
    if (pointsToAdd > 0) {
      console.log(`[crm-consumer] Dang cong ${pointsToAdd} diem cho khach hang: ${data.customerId}...`);
      const crmRes = await systemApi.addLoyaltyPoints(data.customerId, pointsToAdd, data.orderId);
      
      processedEvents.add(eventKey);
      console.log(`[crm-consumer] Thanh cong! Khach ${data.customerId} co tong diem la: ${crmRes.totalPoints}, Hang: ${crmRes.tier}`);
    } else {
      console.log(`[crm-consumer] Don hang ${data.orderId} qua nho, khong du dieu kien cong diem.`);
      processedEvents.add(eventKey);
    }
  });
}

module.exports = { registerAll };