// ============================================================
// PHẦN CHUNG (hoặc HỢP): Experience API — Đóng gói dữ liệu cho UI
// ============================================================
const axios = require('axios');

async function dashboardSummary(messaging) {
  const services = [
    { name: 'wms', url: process.env.WMS_URL || 'http://localhost:4001' },
    { name: 'tms', url: process.env.TMS_URL || 'http://localhost:4002' },
    { name: 'crm', url: process.env.CRM_URL || 'http://localhost:4003' },
    { name: 'payment', url: process.env.PAYMENT_URL || 'http://localhost:4004' }
  ];

  // Goi kiem tra "health" cua cac he thong cung luc (chuan Node.js Asynchronous)
  const healthChecks = services.map(svc => 
    axios.get(`${svc.url}/health`, { timeout: 3000 })
      .then(() => ({ name: svc.name, status: 'UP', url: svc.url }))
      .catch(() => ({ name: svc.name, status: 'DOWN', url: svc.url }))
  );

  const results = await Promise.allSettled(healthChecks);
  
  const serviceStatus = {};
  results.forEach(result => {
    if (result.status === 'fulfilled') {
      const { name, ...rest } = result.value;
      serviceStatus[name] = rest;
    }
  });

  return {
    systemStatus: 'ACTIVE',
    uptime: process.uptime(),
    services: serviceStatus,
    metrics: {
      rabbitMqStatus: messaging ? 'CONNECTED' : 'DISCONNECTED',
      memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + ' MB'
    },
    timestamp: new Date().toISOString()
  };
}

module.exports = { dashboardSummary };