// ============================================================
// PHẦN CỦA NGÂN: Messaging — Cấu hình RabbitMQ (Publish/Consume)
// ============================================================
const amqplib = require('amqplib');
const crypto = require('crypto');

let connection;
let channel;
const EXCHANGE = 'integration.events';
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

async function connect() {
  try {
    connection = await amqplib.connect(RABBITMQ_URL);
    channel = await connection.createChannel();
    
    // Cấu hình Exchange chính
    await channel.assertExchange(EXCHANGE, 'topic', { durable: true });
    
    // Cấu hình Exchange cho tin nhắn lỗi (Dead Letter Exchange)
    await channel.assertExchange(`${EXCHANGE}.dlx`, 'direct', { durable: true });
    
    console.log('[messaging] Ket noi RabbitMQ thanh cong!');

    // Xử lý khi mất kết nối đột ngột
    connection.on('error', (err) => {
      console.error('[messaging] Loi ket noi RabbitMQ:', err.message);
    });
    
    connection.on('close', () => {
      console.error('[messaging] RabbitMQ bi dong, dang thu ket noi lai...');
      setTimeout(connect, 5000); // Tu dong thu lai sau 5 giay
    });

  } catch (error) {
    console.error('[messaging] Khong the ket noi RabbitMQ:', error.message);
    setTimeout(connect, 5000);
  }
}

async function publish(routingKey, data, correlationId) {
  if (!channel) {
    console.error('[messaging] Chua ket noi den channel, khong the publish');
    return;
  }
  
  const event = {
    eventId: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    data
  };

  const payload = Buffer.from(JSON.stringify(event));
  
  channel.publish(EXCHANGE, routingKey, payload, {
    persistent: true,
    correlationId: correlationId || crypto.randomUUID(),
    messageId: event.eventId,
    contentType: 'application/json'
  });
  
  console.log(`[messaging] Da publish su kien [${routingKey}] - ID: ${event.eventId}`);
}

async function consume(queueName, routingKey, handler) {
  if (!channel) throw new Error('Chua ket noi RabbitMQ');
  
  // Cấu hình Queue có liên kết với Dead Letter (để đẩy tin nhắn lỗi sang)
  await channel.assertQueue(queueName, { 
    durable: true,
    deadLetterExchange: `${EXCHANGE}.dlx`,
    deadLetterRoutingKey: `${queueName}.dlq`
  });
  
  await channel.bindQueue(queueName, EXCHANGE, routingKey);
  
  channel.consume(queueName, async (msg) => {
    if (!msg) return;
    try {
      const event = JSON.parse(msg.content.toString());
      await handler(event.data, event);
      channel.ack(msg); // Xác nhận đã xử lý xong
    } catch (err) {
      console.error(`[messaging] Loi khi xu ly queue [${queueName}]:`, err.message);
      // Tham số: msg, reject (không requeue thẳng lại mà đẩy vào DLX)
      channel.nack(msg, false, false); 
    }
  });
}

module.exports = { connect, publish, consume };